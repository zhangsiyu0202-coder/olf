/*
 * File: paper-reports.js
 * Module: packages/runtime-store (论文报告仓储)
 *
 * Responsibility:
 *   - 持久化全局论文维度的结构化报告缓存，不按项目重复存储同一篇论文报告。
 *   - 为 API 与报告 worker 提供统一的读取和更新入口，避免各层自己拼 JSON 结构。
 *
 * Runtime Logic Overview:
 *   1. 报告 worker 生成报告后写入本仓储。
 *   2. API 查询报告状态时先读取本仓储判断是否命中可用缓存。
 *   3. 缓存以 canonicalPaperId 为键，保证跨项目复用同一篇论文报告。
 *
 * Dependencies:
 *   - node:crypto
 *   - packages/runtime-store/storage/metadata-store
 *   - packages/shared/paper-refs
 *   - packages/shared/paths
 *
 * Last Updated:
 *   - 2026-03-11 by Codex - 新增论文报告全局缓存仓储
 */

import crypto from "node:crypto";
import { ensureMetadataStorage, getMetadataStore } from "./storage/metadata-store.js";
import { normalizePaperReference } from "../../shared/src/paper-refs.js";
import { getPaperReportRecordPath } from "../../shared/src/paths.js";

const paperReportsNamespace = "paper-reports";
const reportStatuses = new Set(["ready", "degraded"]);

function normalizeReportSection(section, index) {
  return {
    id: String(section?.id ?? `section-${index + 1}`),
    title: String(section?.title ?? `Section ${index + 1}`),
    content: String(section?.content ?? ""),
    anchorIds: Array.isArray(section?.anchorIds) ? section.anchorIds.map((item) => String(item)) : [],
    confidence:
      section?.confidence === "high" || section?.confidence === "medium" || section?.confidence === "low"
        ? section.confidence
        : "medium",
  };
}

function normalizeReportAnchor(anchor, index) {
  return {
    id: String(anchor?.id ?? `anchor-${index + 1}`),
    chunkId: String(anchor?.chunkId ?? ""),
    excerpt: String(anchor?.excerpt ?? ""),
    pageNumber:
      typeof anchor?.pageNumber === "number" && Number.isFinite(anchor.pageNumber)
        ? Math.max(1, Math.floor(anchor.pageNumber))
        : null,
    score:
      typeof anchor?.score === "number" && Number.isFinite(anchor.score)
        ? Math.max(0, Math.min(1, anchor.score))
        : null,
  };
}

function normalizeConstraints(constraints) {
  return {
    passed: Boolean(constraints?.passed),
    score:
      typeof constraints?.score === "number" && Number.isFinite(constraints.score)
        ? Math.max(0, Math.min(1, constraints.score))
        : 0,
    failedRules: Array.isArray(constraints?.failedRules) ? constraints.failedRules.map((item) => String(item)) : [],
  };
}

function normalizePaperReportRecord(record) {
  const canonicalPaperId = normalizePaperReference(record?.canonicalPaperId ?? record?.paperId ?? "");
  const generatedAt = String(record?.generatedAt ?? new Date().toISOString());
  const updatedAt = String(record?.updatedAt ?? generatedAt);
  return {
    reportId: String(record?.reportId ?? crypto.randomUUID()),
    canonicalPaperId,
    paperId: String(record?.paperId ?? canonicalPaperId),
    sourcePaperId: record?.sourcePaperId ? String(record.sourcePaperId) : null,
    title: String(record?.title ?? "Untitled"),
    summary: String(record?.summary ?? ""),
    sections: Array.isArray(record?.sections)
      ? record.sections.map((item, index) => normalizeReportSection(item, index))
      : [],
    anchors: Array.isArray(record?.anchors)
      ? record.anchors.map((item, index) => normalizeReportAnchor(item, index))
      : [],
    markdown: String(record?.markdown ?? ""),
    constraints: normalizeConstraints(record?.constraints),
    status: reportStatuses.has(String(record?.status ?? "")) ? String(record.status) : "ready",
    model: String(record?.model ?? "unknown"),
    engine: String(record?.engine ?? "dspy"),
    generatedAt,
    expiresAt: record?.expiresAt ? String(record.expiresAt) : null,
    updatedAt,
  };
}

export async function ensurePaperReportStorage() {
  await ensureMetadataStorage();
}

export async function getPaperReport(canonicalPaperId) {
  await ensurePaperReportStorage();
  const normalizedCanonicalPaperId = normalizePaperReference(canonicalPaperId);
  const store = await getMetadataStore();
  const record = await store.readRecord({
    namespace: paperReportsNamespace,
    key: normalizedCanonicalPaperId,
    filePath: getPaperReportRecordPath(normalizedCanonicalPaperId),
    fallbackValue: null,
  });
  return record ? normalizePaperReportRecord(record) : null;
}

export async function upsertPaperReport(canonicalPaperId, payload) {
  await ensurePaperReportStorage();
  const normalizedCanonicalPaperId = normalizePaperReference(canonicalPaperId);
  const record = normalizePaperReportRecord({
    ...payload,
    canonicalPaperId: normalizedCanonicalPaperId,
    updatedAt: new Date().toISOString(),
  });
  const store = await getMetadataStore();
  await store.writeRecord({
    namespace: paperReportsNamespace,
    key: normalizedCanonicalPaperId,
    filePath: getPaperReportRecordPath(normalizedCanonicalPaperId),
    value: record,
  });
  return record;
}

/*
 * Code Review:
 * - 报告缓存用 canonicalPaperId 做键，满足“跨项目共享同一篇论文报告”的产品语义，避免项目维度重复生成。
 * - 结构化 sections/anchors/constraints 在仓储层统一归一化，能防止上游模型输出轻微抖动直接污染前端渲染。
 * - 仓储只负责持久化，不做 TTL 判定和任务调度，保持职责单一，后续替换后端存储时风险更低。
 */
