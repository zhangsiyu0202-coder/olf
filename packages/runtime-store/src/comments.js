/*
 * File: comments.js
 * Module: packages/runtime-store (评论与批注仓储)
 *
 * Responsibility:
 *   - 为项目评论、批注、回复和解决状态提供统一持久化入口。
 *   - 以 `fileId` 作为稳定锚点，让文件移动或重命名后评论仍能映射回同一文档。
 *
 * Runtime Logic Overview:
 *   1. API 通过本仓储创建项目评论，附带文件锚点、选区位置和作者信息。
 *   2. 读取时可按项目或文件维度过滤评论。
 *   3. 回复和解决状态都在同一份评论清单里演进，避免分散成多张弱关联表。
 *
 * Dependencies:
 *   - node:crypto
 *   - node:path
 *   - packages/runtime-store/storage/metadata-store
 *
 * Last Updated:
 *   - 2026-03-08 by Codex - 初始化基于 fileId 的评论与批注仓储
 */

import crypto from "node:crypto";
import path from "node:path";
import { runtimeDataRoot } from "../../shared/src/paths.js";
import { ensureMetadataStorage, getMetadataStore } from "./storage/metadata-store.js";

const commentsRootPath = path.join(runtimeDataRoot, "comments");

function getCommentsNamespace(projectId) {
  return `project-comments:${projectId}`;
}

function getCommentsManifestPath(projectId) {
  return path.join(commentsRootPath, `${projectId}.json`);
}

function normalizeCommentReply(reply, fallbackCreatedAt) {
  return {
    id: reply.id ?? crypto.randomUUID(),
    authorUserId: reply.authorUserId,
    authorName: reply.authorName ?? "未知成员",
    content: String(reply.content ?? "").trim(),
    createdAt: reply.createdAt ?? fallbackCreatedAt ?? new Date().toISOString(),
  };
}

function normalizeProjectComment(comment) {
  return {
    id: comment.id ?? crypto.randomUUID(),
    projectId: comment.projectId,
    fileId: comment.fileId,
    filePath: comment.filePath,
    excerpt: comment.excerpt ?? "",
    selectionText: comment.selectionText ?? "",
    lineStart: Number(comment.lineStart ?? 1),
    lineEnd: Number(comment.lineEnd ?? comment.lineStart ?? 1),
    columnStart: Number(comment.columnStart ?? 1),
    columnEnd: Number(comment.columnEnd ?? comment.columnStart ?? 1),
    content: String(comment.content ?? "").trim(),
    authorUserId: comment.authorUserId,
    authorName: comment.authorName ?? "未知成员",
    resolvedAt: comment.resolvedAt ?? null,
    resolvedByUserId: comment.resolvedByUserId ?? null,
    createdAt: comment.createdAt ?? new Date().toISOString(),
    updatedAt: comment.updatedAt ?? comment.createdAt ?? new Date().toISOString(),
    replies: Array.isArray(comment.replies)
      ? comment.replies.map((reply) => normalizeCommentReply(reply, comment.createdAt))
      : [],
  };
}

async function readComments(projectId) {
  const store = await getMetadataStore();
  const comments = await store.readManifest({
    namespace: getCommentsNamespace(projectId),
    filePath: getCommentsManifestPath(projectId),
    fallbackValue: [],
  });

  return comments.map(normalizeProjectComment);
}

async function writeComments(projectId, comments) {
  const store = await getMetadataStore();
  await store.writeManifest({
    namespace: getCommentsNamespace(projectId),
    filePath: getCommentsManifestPath(projectId),
    value: comments.map(normalizeProjectComment),
  });
}

export async function ensureCommentStorage() {
  await ensureMetadataStorage();
}

export async function listProjectComments(projectId, { fileId = null, includeResolved = true } = {}) {
  await ensureCommentStorage();
  const comments = await readComments(projectId);

  return comments
    .filter((comment) => (fileId ? comment.fileId === fileId : true))
    .filter((comment) => (includeResolved ? true : !comment.resolvedAt))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export async function createProjectComment(projectId, payload) {
  await ensureCommentStorage();
  const createdAt = new Date().toISOString();
  const comment = normalizeProjectComment({
    id: crypto.randomUUID(),
    projectId,
    fileId: payload.fileId,
    filePath: payload.filePath,
    excerpt: payload.excerpt ?? "",
    selectionText: payload.selectionText ?? "",
    lineStart: payload.lineStart,
    lineEnd: payload.lineEnd,
    columnStart: payload.columnStart,
    columnEnd: payload.columnEnd,
    content: payload.content,
    authorUserId: payload.authorUserId,
    authorName: payload.authorName,
    createdAt,
    updatedAt: createdAt,
    replies: [],
  });
  const existingComments = await readComments(projectId);
  await writeComments(projectId, [...existingComments, comment]);
  return comment;
}

export async function replyProjectComment(projectId, commentId, payload) {
  const existingComments = await readComments(projectId);
  let matchedComment = null;
  const updatedComments = existingComments.map((comment) => {
    if (comment.id !== commentId) {
      return comment;
    }

    matchedComment = normalizeProjectComment({
      ...comment,
      updatedAt: new Date().toISOString(),
      replies: [
        ...comment.replies,
        {
          id: crypto.randomUUID(),
          authorUserId: payload.authorUserId,
          authorName: payload.authorName,
          content: payload.content,
          createdAt: new Date().toISOString(),
        },
      ],
    });
    return matchedComment;
  });

  if (!matchedComment) {
    throw new Error("评论不存在");
  }

  await writeComments(projectId, updatedComments);
  return matchedComment;
}

export async function resolveProjectComment(projectId, commentId, actorUserId) {
  const existingComments = await readComments(projectId);
  let matchedComment = null;
  const updatedComments = existingComments.map((comment) => {
    if (comment.id !== commentId) {
      return comment;
    }

    matchedComment = normalizeProjectComment({
      ...comment,
      resolvedAt: comment.resolvedAt ? null : new Date().toISOString(),
      resolvedByUserId: comment.resolvedAt ? null : actorUserId,
      updatedAt: new Date().toISOString(),
    });
    return matchedComment;
  });

  if (!matchedComment) {
    throw new Error("评论不存在");
  }

  await writeComments(projectId, updatedComments);
  return matchedComment;
}

/*
 * Code Review:
 * - 评论仓储当前采用“每项目一份清单”的简单模型，优先保证批注、回复和解决状态在一个原子单元里演进。
 * - `fileId + filePath` 双存储是刻意为之：`fileId` 负责稳定绑定，`filePath` 负责时间线和 UI 展示。
 * - 若后续评论量明显增大，应优先把本模块迁到 PostgreSQL，而不是让 API 或前端各自拼一套缓存。
 */
