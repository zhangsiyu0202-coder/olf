/*
 * File: paper-notes.js
 * Module: packages/runtime-store (论文私有笔记仓储)
 *
 * Responsibility:
 *   - 持久化项目维度的论文阅读笔记，为右侧 My Notes 标签提供增删改查能力。
 *   - 保证笔记可绑定论文锚点，支持后续从笔记回跳 PDF/文本锚点。
 *
 * Runtime Logic Overview:
 *   1. 用户在阅读器右栏创建或编辑笔记，本仓储负责落盘。
 *   2. 阅读页加载时按项目 + 论文 ID 拉取笔记清单。
 *   3. API 层通过统一函数执行 CRUD，不让前端感知底层存储结构。
 *
 * Dependencies:
 *   - node:crypto
 *   - packages/runtime-store/storage/metadata-store
 *   - packages/shared/paper-refs
 *   - packages/shared/paths
 *
 * Last Updated:
 *   - 2026-03-11 by Codex - 新增论文私有笔记仓储
 */

import crypto from "node:crypto";
import { ensureMetadataStorage, getMetadataStore } from "./storage/metadata-store.js";
import { normalizePaperReference, splitPaperReference } from "../../shared/src/paper-refs.js";
import { getPaperNotesManifestPath } from "../../shared/src/paths.js";

function getPaperNotesNamespace(projectId) {
  return `paper-notes:${projectId}`;
}

function normalizePaperNote(record) {
  const identity = splitPaperReference(record?.paperId ?? "");
  const nowIso = new Date().toISOString();
  return {
    id: String(record?.id ?? crypto.randomUUID()),
    projectId: String(record?.projectId ?? ""),
    paperId: identity.paperId,
    title: String(record?.title ?? "未命名笔记"),
    text: String(record?.text ?? ""),
    anchorId: record?.anchorId ? String(record.anchorId) : null,
    pageNumber:
      typeof record?.pageNumber === "number" && Number.isFinite(record.pageNumber)
        ? Math.max(1, Math.floor(record.pageNumber))
        : null,
    contextText: record?.contextText ? String(record.contextText) : null,
    createdByUserId: record?.createdByUserId ? String(record.createdByUserId) : null,
    createdByName: record?.createdByName ? String(record.createdByName) : null,
    createdAt: String(record?.createdAt ?? nowIso),
    updatedAt: String(record?.updatedAt ?? nowIso),
  };
}

async function readProjectPaperNotes(projectId) {
  const store = await getMetadataStore();
  const records = await store.readManifest({
    namespace: getPaperNotesNamespace(projectId),
    filePath: getPaperNotesManifestPath(projectId),
    fallbackValue: [],
  });
  return records.map(normalizePaperNote);
}

async function writeProjectPaperNotes(projectId, records) {
  const store = await getMetadataStore();
  await store.writeManifest({
    namespace: getPaperNotesNamespace(projectId),
    filePath: getPaperNotesManifestPath(projectId),
    value: records.map(normalizePaperNote),
  });
}

export async function ensurePaperNoteStorage() {
  await ensureMetadataStorage();
}

export async function listProjectPaperNotes(projectId, paperId) {
  await ensurePaperNoteStorage();
  const normalizedPaperId = normalizePaperReference(paperId);
  const legacyPaperId = splitPaperReference(paperId).legacyId;
  const records = await readProjectPaperNotes(projectId);
  return records
    .filter((record) => record.paperId === normalizedPaperId || record.paperId === legacyPaperId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function createProjectPaperNote(projectId, payload) {
  await ensurePaperNoteStorage();
  const currentRecords = await readProjectPaperNotes(projectId);
  const nextRecord = normalizePaperNote({
    id: crypto.randomUUID(),
    projectId,
    paperId: normalizePaperReference(payload.paperId),
    title: payload.title,
    text: payload.text,
    anchorId: payload.anchorId ?? null,
    pageNumber: payload.pageNumber ?? null,
    contextText: payload.contextText ?? null,
    createdByUserId: payload.createdByUserId ?? null,
    createdByName: payload.createdByName ?? null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await writeProjectPaperNotes(projectId, [...currentRecords, nextRecord]);
  return nextRecord;
}

export async function updateProjectPaperNote(projectId, paperId, noteId, patch) {
  await ensurePaperNoteStorage();
  const normalizedPaperId = normalizePaperReference(paperId);
  const legacyPaperId = splitPaperReference(paperId).legacyId;
  const currentRecords = await readProjectPaperNotes(projectId);
  let targetRecord = null;
  const nextRecords = currentRecords.map((record) => {
    if ((record.paperId !== normalizedPaperId && record.paperId !== legacyPaperId) || record.id !== String(noteId)) {
      return record;
    }
    targetRecord = normalizePaperNote({
      ...record,
      ...patch,
      id: record.id,
      projectId: record.projectId,
      paperId: record.paperId,
      updatedAt: new Date().toISOString(),
    });
    return targetRecord;
  });

  if (!targetRecord) {
    throw new Error("论文笔记不存在");
  }

  await writeProjectPaperNotes(projectId, nextRecords);
  return targetRecord;
}

export async function deleteProjectPaperNote(projectId, paperId, noteId) {
  await ensurePaperNoteStorage();
  const normalizedPaperId = normalizePaperReference(paperId);
  const legacyPaperId = splitPaperReference(paperId).legacyId;
  const currentRecords = await readProjectPaperNotes(projectId);
  const targetRecord =
    currentRecords.find(
      (record) =>
        (record.paperId === normalizedPaperId || record.paperId === legacyPaperId) && record.id === String(noteId),
    ) ?? null;

  if (!targetRecord) {
    throw new Error("论文笔记不存在");
  }

  const nextRecords = currentRecords.filter(
    (record) =>
      !((record.paperId === normalizedPaperId || record.paperId === legacyPaperId) && record.id === String(noteId)),
  );
  await writeProjectPaperNotes(projectId, nextRecords);
  return targetRecord;
}

/*
 * Code Review:
 * - 笔记仓储按项目隔离，避免“全局报告共享”与“项目私有阅读笔记”语义混淆。
 * - 笔记数据统一保留 anchorId/pageNumber 字段，后续可无缝增加“从笔记回跳阅读位置”而不改存储模型。
 * - CRUD 均基于统一 paperId 规范化，兼容旧记录时不会出现读取不到同一篇论文笔记的问题。
 */
