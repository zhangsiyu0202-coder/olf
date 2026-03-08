/*
 * File: blob-store.js
 * Module: packages/runtime-store (对象存储门面)
 *
 * Responsibility:
 *   - 为运行时二进制和文本对象提供统一存储接口，并支持 `file` 与 `s3` 两种后端。
 *   - 在 `s3` 模式下维持“本地缓存 + 远端对象存储”双写结构，避免上层模块感知 S3 细节。
 *   - 让项目文件、协作状态、快照归档和编译产物都收敛到同一 blob 边界。
 *
 * Runtime Logic Overview:
 *   1. 上层仍然传入绝对路径，本模块负责映射为本地路径与对象存储 key。
 *   2. 写入时先落本地缓存，再同步到 S3/MinIO。
 *   3. 读取时优先使用本地缓存，不存在时再从 S3 回填到本地。
 *
 * Dependencies:
 *   - node:path
 *   - @aws-sdk/client-s3
 *   - packages/shared/fs
 *   - packages/shared/paths
 *
 * Last Updated:
 *   - 2026-03-08 by Codex - 接入 S3/MinIO 兼容对象存储并保留本地缓存
 */

import path from "node:path";
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  ensureDir,
  fileExists,
  readBinary,
  readText,
  removePath,
  writeBinary,
  writeText,
} from "../../../shared/src/fs.js";
import { runtimeRoot } from "../../../shared/src/paths.js";

const blobBackend = (process.env.RUNTIME_BLOB_BACKEND ?? "file").trim().toLowerCase();
const s3Bucket = String(process.env.RUNTIME_BLOB_S3_BUCKET ?? "overleaf-runtime").trim();
const s3Region = String(process.env.RUNTIME_BLOB_S3_REGION ?? "us-east-1").trim();
const s3Endpoint = String(process.env.RUNTIME_BLOB_S3_ENDPOINT ?? "").trim();
const s3ForcePathStyle = (process.env.RUNTIME_BLOB_S3_FORCE_PATH_STYLE ?? "1").trim() !== "0";
const s3AccessKeyId = String(
  process.env.RUNTIME_BLOB_S3_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID ?? "",
).trim();
const s3SecretAccessKey = String(
  process.env.RUNTIME_BLOB_S3_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY ?? "",
).trim();
let cachedS3Client = null;

function normalizeBlobRelativePath(targetPath) {
  const relativePath = path.relative(runtimeRoot, targetPath).replaceAll(path.sep, "/");

  if (!relativePath || relativePath.startsWith("..")) {
    throw new Error("对象存储路径非法，必须位于 runtimeRoot 内");
  }

  return relativePath;
}

function createS3Client() {
  if (!s3Endpoint) {
    throw new Error("已启用 s3 对象存储后端，但未配置 RUNTIME_BLOB_S3_ENDPOINT");
  }

  if (!s3AccessKeyId || !s3SecretAccessKey) {
    throw new Error("已启用 s3 对象存储后端，但未配置访问密钥");
  }

  return new S3Client({
    region: s3Region,
    endpoint: s3Endpoint,
    forcePathStyle: s3ForcePathStyle,
    credentials: {
      accessKeyId: s3AccessKeyId,
      secretAccessKey: s3SecretAccessKey,
    },
  });
}

function getS3Client() {
  if (!cachedS3Client) {
    cachedS3Client = createS3Client();
  }

  return cachedS3Client;
}

async function streamToBuffer(stream) {
  const chunks = [];

  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

async function ensureBucketAccess() {
  if (blobBackend !== "s3") {
    return;
  }

  const client = getS3Client();
  await client.send(
    new HeadObjectCommand({
      Bucket: s3Bucket,
      Key: "__healthcheck__",
    }),
  ).catch((error) => {
    if (error?.$metadata?.httpStatusCode === 404 || error?.name === "NotFound") {
      return;
    }

    if (error?.$metadata?.httpStatusCode === 403) {
      throw new Error("对象存储已配置，但当前凭证无权访问 bucket");
    }

    if (error?.$metadata?.httpStatusCode === 400 || error?.name === "NoSuchBucket") {
      throw new Error(`对象存储 bucket 不存在：${s3Bucket}`);
    }

    throw error;
  });
}

async function uploadLocalFile(targetPath, body, contentType) {
  if (blobBackend !== "s3") {
    return;
  }

  const client = getS3Client();
  await client.send(
    new PutObjectCommand({
      Bucket: s3Bucket,
      Key: normalizeBlobRelativePath(targetPath),
      Body: body,
      ContentType: contentType,
    }),
  );
}

async function downloadRemoteFile(targetPath) {
  const client = getS3Client();
  const response = await client.send(
    new GetObjectCommand({
      Bucket: s3Bucket,
      Key: normalizeBlobRelativePath(targetPath),
    }),
  );

  if (!response.Body) {
    throw new Error("对象存储返回空内容");
  }

  const buffer = await streamToBuffer(response.Body);
  await writeBinary(targetPath, buffer);
  return buffer;
}

async function remoteObjectExists(targetPath) {
  if (blobBackend !== "s3") {
    return false;
  }

  const client = getS3Client();
  const key = normalizeBlobRelativePath(targetPath);

  try {
    await client.send(
      new HeadObjectCommand({
        Bucket: s3Bucket,
        Key: key,
      }),
    );
    return true;
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 404 || error?.name === "NotFound") {
      return false;
    }

    throw error;
  }
}

async function deleteRemotePrefix(targetPath) {
  if (blobBackend !== "s3") {
    return;
  }

  const client = getS3Client();
  const baseKey = normalizeBlobRelativePath(targetPath);
  const keys = [baseKey];
  let continuationToken = undefined;

  while (true) {
    const result = await client.send(
      new ListObjectsV2Command({
        Bucket: s3Bucket,
        Prefix: `${baseKey}/`,
        ContinuationToken: continuationToken,
      }),
    );

    for (const object of result.Contents ?? []) {
      if (object.Key) {
        keys.push(object.Key);
      }
    }

    if (!result.IsTruncated) {
      break;
    }

    continuationToken = result.NextContinuationToken;
  }

  const uniqueKeys = [...new Set(keys)];

  if (uniqueKeys.length === 1) {
    await client.send(
      new DeleteObjectCommand({
        Bucket: s3Bucket,
        Key: uniqueKeys[0],
      }),
    );
    return;
  }

  await client.send(
    new DeleteObjectsCommand({
      Bucket: s3Bucket,
      Delete: {
        Objects: uniqueKeys.map((key) => ({ Key: key })),
        Quiet: true,
      },
    }),
  );
}

export async function ensureBlobStorage() {
  if (blobBackend === "s3") {
    await ensureBucketAccess();
  }

  return blobBackend;
}

export function getBlobBackendName() {
  return blobBackend;
}

export async function writeTextBlob(targetPath, content) {
  await writeText(targetPath, content);
  await uploadLocalFile(targetPath, Buffer.from(content, "utf8"), "text/plain; charset=utf-8");
}

export async function readTextBlob(targetPath) {
  if (await fileExists(targetPath)) {
    return readText(targetPath);
  }

  if (blobBackend !== "s3") {
    return readText(targetPath);
  }

  const buffer = await downloadRemoteFile(targetPath);
  return buffer.toString("utf8");
}

export async function writeBinaryBlob(targetPath, content) {
  await writeBinary(targetPath, content);
  await uploadLocalFile(targetPath, content, "application/octet-stream");
}

export async function readBinaryBlob(targetPath) {
  if (await fileExists(targetPath)) {
    return readBinary(targetPath);
  }

  if (blobBackend !== "s3") {
    return readBinary(targetPath);
  }

  return downloadRemoteFile(targetPath);
}

export async function blobExists(targetPath) {
  if (await fileExists(targetPath)) {
    return true;
  }

  return remoteObjectExists(targetPath);
}

export async function removeBlob(targetPath) {
  await removePath(targetPath);
  await deleteRemotePrefix(targetPath);
}

export async function ensureBlobDirectory(targetPath) {
  await ensureDir(targetPath);
}

/*
 * Code Review:
 * - `s3` 后端故意采用“本地缓存 + 远端同步”而不是让上层直接改成流式对象 API，这样能保住现有项目树、快照和编译代码路径不变。
 * - 当前实现假设同一运行节点保留本地缓存目录；若未来要做无状态 API/Worker，再把目录回填和缓存失效策略继续强化。
 * - 删除逻辑同时处理“单文件对象”和“目录前缀”，能兼容项目目录、快照包和协作状态这三类 blob 形态。
 */
