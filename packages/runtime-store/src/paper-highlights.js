/*
 * File: paper-highlights.js
 * Module: packages/runtime-store (论文摘录仓储)
 *
 * Responsibility:
 *   - 持久化项目内论文 PDF 摘录、高亮位置和简短备注。
 *   - 为论文阅读模块提供稳定的“创建/读取摘录”入口，不让前端直接操心底层存储。
 *
 * Runtime Logic Overview:
 *   1. 论文阅读面板选中 PDF 文本后，通过 API 调用本仓储创建摘录。
 *   2. 阅读面板打开某篇论文时，从本仓储加载该论文的全部摘录。
 *   3. 摘录记录按项目和论文 ID 维度隔离，避免不同项目互相污染。
 *
 * Dependencies:
 *   - node:crypto
 *   - node:path
 *   - packages/runtime-store/storage/metadata-store
 *   - packages/shared/paper-refs
 *   - packages/shared/paths
 *
 * Last Updated:
 *   - 2026-03-09 by Codex - 为论文高亮新增 kind 字段并兼容旧记录推断
 */

import crypto from "node:crypto";
import path from "node:path";
import { normalizePaperReference, splitPaperReference } from "../../shared/src/paper-refs.js";
import { runtimeDataRoot } from "../../shared/src/paths.js";
import { ensureMetadataStorage, getMetadataStore } from "./storage/metadata-store.js";

const paperHighlightsRootPath = path.join(runtimeDataRoot, "paper-highlights");

function getPaperHighlightsNamespace(projectId) {
  return `paper-highlights:${projectId}`;
}

function getPaperHighlightsManifestPath(projectId) {
  return path.join(paperHighlightsRootPath, `${projectId}.json`);
}

function normalizeRect(rect) {
  return {
    x1: Number(rect?.x1 ?? 0),
    y1: Number(rect?.y1 ?? 0),
    x2: Number(rect?.x2 ?? 0),
    y2: Number(rect?.y2 ?? 0),
    width: Number(rect?.width ?? 0),
    height: Number(rect?.height ?? 0),
    pageNumber: Number(rect?.pageNumber ?? 1),
  };
}

function normalizeHighlightPosition(position) {
  return {
    boundingRect: normalizeRect(position?.boundingRect),
    rects: Array.isArray(position?.rects) ? position.rects.map(normalizeRect) : [],
    pageNumber: Number(position?.pageNumber ?? position?.boundingRect?.pageNumber ?? 1),
    usePdfCoordinates: Boolean(position?.usePdfCoordinates),
  };
}

function normalizePaperHighlight(record) {
  const identity = splitPaperReference(record.paperId ?? "");
  const normalizedCommentText = String(record.comment?.text ?? "");
  return {
    id: record.id ?? crypto.randomUUID(),
    projectId: record.projectId,
    paperId: identity.paperId,
    kind:
      record.kind === "highlight" || record.kind === "comment"
        ? record.kind
        : normalizedCommentText.trim()
          ? "comment"
          : "highlight",
    content: {
      text: String(record.content?.text ?? ""),
      image: record.content?.image ? String(record.content.image) : undefined,
    },
    comment: {
      text: normalizedCommentText,
      emoji: String(record.comment?.emoji ?? ""),
    },
    position: normalizeHighlightPosition(record.position),
    authorUserId: String(record.authorUserId ?? ""),
    authorName: String(record.authorName ?? "未知成员"),
    createdAt: record.createdAt ?? new Date().toISOString(),
  };
}

async function readPaperHighlights(projectId) {
  const store = await getMetadataStore();
  const records = await store.readManifest({
    namespace: getPaperHighlightsNamespace(projectId),
    filePath: getPaperHighlightsManifestPath(projectId),
    fallbackValue: [],
  });

  return records.map(normalizePaperHighlight);
}

async function writePaperHighlights(projectId, records) {
  const store = await getMetadataStore();
  await store.writeManifest({
    namespace: getPaperHighlightsNamespace(projectId),
    filePath: getPaperHighlightsManifestPath(projectId),
    value: records.map(normalizePaperHighlight),
  });
}

export async function ensurePaperHighlightStorage() {
  await ensureMetadataStorage();
}

export async function listProjectPaperHighlights(projectId, paperId) {
  await ensurePaperHighlightStorage();
  const records = await readPaperHighlights(projectId);
  const normalizedPaperId = normalizePaperReference(paperId);
  const legacyPaperId = splitPaperReference(paperId).legacyId;

  return records
    .filter((record) => record.paperId === normalizedPaperId || record.paperId === legacyPaperId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export async function createProjectPaperHighlight(projectId, payload) {
  await ensurePaperHighlightStorage();
  const record = normalizePaperHighlight({
    id: crypto.randomUUID(),
    projectId,
    paperId: normalizePaperReference(payload.paperId),
    kind: payload.kind,
    content: payload.content,
    comment: payload.comment,
    position: payload.position,
    authorUserId: payload.authorUserId,
    authorName: payload.authorName,
    createdAt: new Date().toISOString(),
  });
  const existing = await readPaperHighlights(projectId);
  await writePaperHighlights(projectId, [...existing, record]);
  return record;
}

export async function updateProjectPaperHighlight(projectId, paperId, highlightId, payload) {
  await ensurePaperHighlightStorage();
  const existing = await readPaperHighlights(projectId);
  const normalizedPaperId = normalizePaperReference(paperId);
  const legacyPaperId = splitPaperReference(paperId).legacyId;
  let matchedRecord = null;
  const nextRecords = existing.map((record) => {
    if ((record.paperId !== normalizedPaperId && record.paperId !== legacyPaperId) || record.id !== highlightId) {
      return record;
    }

    matchedRecord = normalizePaperHighlight({
      ...record,
      kind: payload.kind ?? record.kind,
      comment: {
        ...record.comment,
        ...(payload.comment ?? {}),
      },
      content: {
        ...record.content,
        ...(payload.content ?? {}),
      },
    });
    return matchedRecord;
  });

  if (!matchedRecord) {
    throw new Error("论文摘录不存在");
  }

  await writePaperHighlights(projectId, nextRecords);
  return matchedRecord;
}

export async function deleteProjectPaperHighlight(projectId, paperId, highlightId) {
  await ensurePaperHighlightStorage();
  const existing = await readPaperHighlights(projectId);
  const normalizedPaperId = normalizePaperReference(paperId);
  const legacyPaperId = splitPaperReference(paperId).legacyId;
  const targetRecord =
    existing.find(
      (record) =>
        (record.paperId === normalizedPaperId || record.paperId === legacyPaperId) && record.id === highlightId,
    ) ?? null;

  if (!targetRecord) {
    throw new Error("论文摘录不存在");
  }

  await writePaperHighlights(
    projectId,
    existing.filter(
      (record) =>
        !((record.paperId === normalizedPaperId || record.paperId === legacyPaperId) && record.id === highlightId),
    ),
  );
  return targetRecord;
}

/*
 * Code Review:
 * - 当前摘录存储保持“每项目一份清单”的简单模型，先保证产品可用而不是过早上复杂索引。
 * - 论文摘录已跟随统一论文标识升级，避免历史 bare arXiv ID 和新多源 `paperId` 混用后查不回摘录。
 * - 位置数据直接按 `react-pdf-highlighter` 的缩放坐标存储，避免前后端各自做一套坐标转换。
 * - 若后续需要删除、编辑或按页过滤，可继续在本模块扩展，而不把逻辑散落到 API 或前端。
 */
