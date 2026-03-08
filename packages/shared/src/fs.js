/*
 * File: fs.js
 * Module: packages/shared (文件系统工具)
 *
 * Responsibility:
 *   - 提供跨模块复用的文件系统基础能力，包括 JSON 读写、目录复制、路径校验和目录树扫描。
 *   - 把容易重复且容易出错的底层 I/O 细节从业务层剥离出来。
 *
 * Runtime Logic Overview:
 *   1. 运行时持久层通过本文件初始化目录并维护 JSON 元数据。
 *   2. API 服务通过本文件安全地读写项目文件。
 *   3. Worker 通过本文件复制项目快照到编译工作目录。
 *
 * Key Data Flow:
 *   - 输入：文件路径、目录路径、JSON 对象、文本内容。
 *   - 输出：序列化后的文件内容、目录树结构、安全解析后的绝对路径。
 *
 * Future Extension:
 *   - 可继续加入文件锁、哈希计算、对象存储适配层共用工具。
 *   - 若后续引入更严格的并发控制，可在此统一增强底层写入策略。
 *
 * Dependencies:
 *   - node:fs/promises
 *   - node:path
 *
 * Last Updated:
 *   - 2026-03-08 by Codex - 为文件化元数据写入补齐原子落盘，降低并发读到半截 JSON 的风险
 */

import fs from "node:fs/promises";
import path from "node:path";

export async function ensureDir(targetPath) {
  await fs.mkdir(targetPath, { recursive: true });
}

export async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function readJson(targetPath, fallbackValue) {
  if (!(await fileExists(targetPath))) {
    return fallbackValue;
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const raw = await fs.readFile(targetPath, "utf8");
      return JSON.parse(raw);
    } catch (error) {
      const parseFailed = error instanceof SyntaxError;

      if (!parseFailed || attempt > 0) {
        throw error;
      }

      await new Promise((resolve) => {
        setTimeout(resolve, 25);
      });
    }
  }

  return fallbackValue;
}

async function writeFileAtomically(targetPath, content, encoding = null) {
  await ensureDir(path.dirname(targetPath));
  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  try {
    if (encoding) {
      await fs.writeFile(tempPath, content, encoding);
    } else {
      await fs.writeFile(tempPath, content);
    }

    await fs.rename(tempPath, targetPath);
  } finally {
    await fs.unlink(tempPath).catch(() => undefined);
  }
}

export async function writeJson(targetPath, value) {
  await writeFileAtomically(targetPath, JSON.stringify(value, null, 2), "utf8");
}

export async function readText(targetPath) {
  return fs.readFile(targetPath, "utf8");
}

export async function readBinary(targetPath) {
  return fs.readFile(targetPath);
}

export async function writeText(targetPath, content) {
  await writeFileAtomically(targetPath, content, "utf8");
}

export async function writeBinary(targetPath, content) {
  await writeFileAtomically(targetPath, content);
}

export async function removePath(targetPath) {
  await fs.rm(targetPath, { recursive: true, force: true });
}

export async function emptyDirectory(targetPath) {
  await ensureDir(targetPath);
  const entryNames = await fs.readdir(targetPath);

  for (const entryName of entryNames) {
    await removePath(path.join(targetPath, entryName));
  }
}

export function sanitizeRelativePath(inputPath) {
  const normalized = inputPath.replaceAll("\\", "/").trim();

  if (!normalized) {
    throw new Error("路径不能为空");
  }

  if (normalized.startsWith("/") || normalized.includes("..")) {
    throw new Error("路径非法，不能越出项目目录");
  }

  return normalized;
}

export function resolveInside(rootPath, relativePath) {
  const safeRelativePath = sanitizeRelativePath(relativePath);
  const resolvedPath = path.resolve(rootPath, safeRelativePath);

  if (!resolvedPath.startsWith(rootPath)) {
    throw new Error("路径非法，解析结果超出根目录");
  }

  return resolvedPath;
}

export async function copyDirectory(sourceDir, targetDir) {
  await ensureDir(targetDir);
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, targetPath);
      continue;
    }

    await ensureDir(path.dirname(targetPath));
    await fs.copyFile(sourcePath, targetPath);
  }
}

export async function listDirectoryTree(rootDir, currentDir = rootDir) {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  const children = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = path.join(currentDir, entry.name);
    const relativePath = path.relative(rootDir, absolutePath).replaceAll(path.sep, "/");

    if (entry.isDirectory()) {
      children.push({
        type: "directory",
        name: entry.name,
        path: relativePath,
        children: await listDirectoryTree(rootDir, absolutePath),
      });
      continue;
    }

    children.push({
      type: "file",
      name: entry.name,
      path: relativePath,
    });
  }

  return children;
}

/*
 * Code Review:
 * - 当前工具函数仍保持轻量，但 JSON / 文本 / 二进制写入已改为“临时文件 + rename”的原子落盘，优先解决文件化元数据在并发场景下被读到半截内容的问题。
 * - `resolveInside` 与 `sanitizeRelativePath` 是关键安全边界，所有项目文件操作都应经过它们。
 * - `readJson` 只做一次极短重试，用来吸收极少数文件系统瞬态；如果未来仍有高并发写压力，应继续往仓储层和数据库层收敛，而不是在这里无限重试。
 * - 目录树扫描默认全量递归，后续项目规模变大时可在此加入分页或懒加载策略。
 */
