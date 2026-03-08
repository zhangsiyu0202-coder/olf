/*
 * File: migrate-storage.js
 * Module: scripts (存储迁移脚本)
 *
 * Responsibility:
 *   - 把当前文件后端中的运行时元数据迁移到 PostgreSQL 元数据后端。
 *   - 迁移范围聚焦元数据：项目、用户、邀请、AI 对话、编译任务与快照索引。
 *   - 不搬运项目文件、快照归档和协作二进制状态，因为这些当前仍走本地对象存储适配器。
 *
 * Runtime Logic Overview:
 *   1. 从现有 `.runtime` JSON 文件和任务目录中读取元数据。
 *   2. 切换到 `postgres` 元数据后端。
 *   3. 将各命名空间重新写入 `storage_kv`。
 *
 * Dependencies:
 *   - packages/runtime-store/storage/metadata-store
 *   - packages/shared/fs
 *   - packages/shared/paths
 *
 * Last Updated:
 *   - 2026-03-07 by Codex - 新增文件后端到 PostgreSQL 的元数据迁移脚本
 */

import fs from "node:fs/promises";
import path from "node:path";
import { readJson } from "../packages/shared/src/fs.js";
import {
  getSnapshotMetadataPath,
  runtimeDataRoot,
  runtimeJobsRoot,
} from "../packages/shared/src/paths.js";

const manifests = [
  { namespace: "projects", filePath: path.join(runtimeDataRoot, "projects.json") },
  { namespace: "users", filePath: path.join(runtimeDataRoot, "users.json") },
  { namespace: "project-invitations", filePath: path.join(runtimeDataRoot, "project-invitations.json") },
  { namespace: "ai-conversations", filePath: path.join(runtimeDataRoot, "ai-conversations.json") },
];

async function migrateManifest(store, namespace, filePath) {
  const payload = await readJson(filePath, null);

  if (payload === null) {
    return 0;
  }

  await store.writeManifest({
    namespace,
    value: payload,
  });
  return Array.isArray(payload) ? payload.length : 1;
}

async function migrateJobRecords(store) {
  try {
    const entryNames = await fs.readdir(runtimeJobsRoot);
    let count = 0;

    for (const entryName of entryNames.filter((name) => name.endsWith(".json"))) {
      const job = await readJson(path.join(runtimeJobsRoot, entryName), null);

      if (!job?.id) {
        continue;
      }

      await store.writeRecord({
        namespace: "compile-jobs",
        key: job.id,
        value: job,
      });
      count += 1;
    }

    return count;
  } catch {
    return 0;
  }
}

async function migrateSnapshotManifests(store) {
  const projects = await readJson(path.join(runtimeDataRoot, "projects.json"), []);
  let count = 0;

  for (const project of projects) {
    if (!project?.id) {
      continue;
    }

    const snapshotManifest = await readJson(getSnapshotMetadataPath(project.id), null);

    if (snapshotManifest === null) {
      continue;
    }

    await store.writeManifest({
      namespace: `project-snapshots:${project.id}`,
      value: snapshotManifest,
    });
    count += Array.isArray(snapshotManifest) ? snapshotManifest.length : 1;
  }

  return count;
}

async function main() {
  if (!(process.env.RUNTIME_POSTGRES_URL ?? process.env.DATABASE_URL ?? "").trim()) {
    throw new Error("请先配置 RUNTIME_POSTGRES_URL 或 DATABASE_URL");
  }

  process.env.RUNTIME_METADATA_BACKEND = "postgres";
  const { getMetadataStore } = await import("../packages/runtime-store/src/storage/metadata-store.js");
  const store = await getMetadataStore();
  const summary = {};

  for (const manifest of manifests) {
    summary[manifest.namespace] = await migrateManifest(store, manifest.namespace, manifest.filePath);
  }

  summary.compileJobs = await migrateJobRecords(store);
  summary.projectSnapshots = await migrateSnapshotManifests(store);

  console.log("Storage migration completed.");
  console.log(JSON.stringify(summary, null, 2));
}

await main();

/*
 * Code Review:
 * - 该脚本只迁移元数据，不迁移二进制和项目目录，避免在当前阶段把对象存储迁移和数据库迁移耦合在一起。
 * - 迁移脚本以“重放写入”为主，不做复杂去重和冲突合并，默认假设切换时机由人工控制。
 * - 若后续引入正式迁移体系，应保留本脚本作为一次性导入工具，而不是让业务进程自行隐式迁移生产数据。
 */
