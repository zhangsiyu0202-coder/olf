/*
 * File: metadata-store.js
 * Module: packages/runtime-store (元数据存储门面)
 *
 * Responsibility:
 *   - 为 `runtime-store` 提供统一的元数据读写接口，并把 `file` / `postgres` 后端差异收敛在本模块内。
 *   - 让上层仓储只表达“命名空间、键和值”，而不是自己感知 JSON 文件或 SQL 表结构。
 *   - 为编译任务、多 worker 和后续平台服务提供原子更新能力。
 *
 * Runtime Logic Overview:
 *   1. 首次访问时根据环境变量选择 `file` 或 `postgres` 后端。
 *   2. `file` 后端继续复用当前 JSON 文件布局，保证现有运行数据可直接读取。
 *   3. `postgres` 后端统一写入 `storage_kv` 表，以 `namespace + key` 组织记录，并支持 compare-and-swap。
 *
 * Key Data Flow:
 *   - 输入：命名空间、记录键、文件路径、JSON 值。
 *   - 输出：已持久化的对象、记录列表、删除结果和原子更新结果。
 *
 * Future Extension:
 *   - 可继续加入事务、乐观锁和批量读写接口。
 *   - 若后续切到正式对象存储和数据库集群，只需要在这里扩展新的后端适配器。
 *
 * Dependencies:
 *   - node:fs/promises
 *   - node:path
 *   - packages/shared/fs
 *   - pg
 *
 * Last Updated:
 *   - 2026-03-08 by Codex - 为多 worker 任务领取新增原子记录更新能力
 */

import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir, fileExists, readJson, removePath, writeJson } from "../../../shared/src/fs.js";

const storageBackend = (process.env.RUNTIME_METADATA_BACKEND ?? "file").trim().toLowerCase();
let cachedStore = null;

async function createFileStore() {
  async function withFileLock(lockPath, action) {
    await ensureDir(path.dirname(lockPath));
    let handle = null;

    while (!handle) {
      try {
        handle = await fs.open(lockPath, "wx");
      } catch (error) {
        if (error?.code !== "EEXIST") {
          throw error;
        }

        await new Promise((resolve) => {
          setTimeout(resolve, 20);
        });
      }
    }

    try {
      return await action();
    } finally {
      await handle.close().catch(() => undefined);
      await fs.unlink(lockPath).catch(() => undefined);
    }
  }

  return {
    backend: "file",
    async ensureReady() {
      return true;
    },
    async readManifest({ filePath, fallbackValue }) {
      return readJson(filePath, fallbackValue);
    },
    async writeManifest({ filePath, value }) {
      await writeJson(filePath, value);
      return value;
    },
    async readRecord({ filePath, fallbackValue }) {
      return readJson(filePath, fallbackValue);
    },
    async writeRecord({ filePath, value }) {
      await writeJson(filePath, value);
      return value;
    },
    async deleteRecord({ filePath }) {
      await removePath(filePath);
    },
    async patchRecordAtomically({ filePath, fallbackValue = null, transform }) {
      const lockPath = `${filePath}.lock`;

      return withFileLock(lockPath, async () => {
        const currentValue = await readJson(filePath, fallbackValue);
        const nextValue = transform(currentValue);

        if (nextValue === undefined) {
          return {
            updated: false,
            value: currentValue,
          };
        }

        await writeJson(filePath, nextValue);
        return {
          updated: true,
          value: nextValue,
        };
      });
    },
    async listRecordValues({ directoryPath, fileNameFilter = (name) => name.endsWith(".json"), fallbackValue = [] }) {
      if (!(await fileExists(directoryPath))) {
        return fallbackValue;
      }

      const entryNames = await fs.readdir(directoryPath);
      const records = [];

      for (const entryName of entryNames.filter(fileNameFilter)) {
        const value = await readJson(path.join(directoryPath, entryName), null);

        if (value !== null) {
          records.push(value);
        }
      }

      return records;
    },
  };
}

async function createPostgresStore() {
  const { Pool } = await import("pg");
  const connectionString = process.env.RUNTIME_POSTGRES_URL ?? process.env.DATABASE_URL ?? "";

  if (!connectionString.trim()) {
    throw new Error("已启用 postgres 元数据后端，但未配置 RUNTIME_POSTGRES_URL 或 DATABASE_URL");
  }

  const pool = new Pool({
    connectionString,
  });

  async function ensureSchema() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS storage_kv (
        namespace TEXT NOT NULL,
        record_key TEXT NOT NULL,
        value JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (namespace, record_key)
      )
    `);
  }

  return {
    backend: "postgres",
    async ensureReady() {
      await ensureSchema();
    },
    async readManifest({ namespace, fallbackValue }) {
      await ensureSchema();
      const result = await pool.query(
        "SELECT value FROM storage_kv WHERE namespace = $1 AND record_key = $2 LIMIT 1",
        [namespace, "__manifest__"],
      );
      return result.rows[0]?.value ?? fallbackValue;
    },
    async writeManifest({ namespace, value }) {
      await ensureSchema();
      await pool.query(
        `
          INSERT INTO storage_kv (namespace, record_key, value, updated_at)
          VALUES ($1, $2, $3::jsonb, NOW())
          ON CONFLICT (namespace, record_key)
          DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
        `,
        [namespace, "__manifest__", JSON.stringify(value)],
      );
      return value;
    },
    async readRecord({ namespace, key, fallbackValue }) {
      await ensureSchema();
      const result = await pool.query(
        "SELECT value FROM storage_kv WHERE namespace = $1 AND record_key = $2 LIMIT 1",
        [namespace, key],
      );
      return result.rows[0]?.value ?? fallbackValue;
    },
    async writeRecord({ namespace, key, value }) {
      await ensureSchema();
      await pool.query(
        `
          INSERT INTO storage_kv (namespace, record_key, value, updated_at)
          VALUES ($1, $2, $3::jsonb, NOW())
          ON CONFLICT (namespace, record_key)
          DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
        `,
        [namespace, key, JSON.stringify(value)],
      );
      return value;
    },
    async deleteRecord({ namespace, key }) {
      await ensureSchema();
      await pool.query("DELETE FROM storage_kv WHERE namespace = $1 AND record_key = $2", [namespace, key]);
    },
    async patchRecordAtomically({ namespace, key, fallbackValue = null, transform }) {
      await ensureSchema();

      for (let attempt = 0; attempt < 10; attempt += 1) {
        const currentResult = await pool.query(
          "SELECT value FROM storage_kv WHERE namespace = $1 AND record_key = $2 LIMIT 1",
          [namespace, key],
        );
        const currentValue = currentResult.rows[0]?.value ?? fallbackValue;
        const nextValue = transform(currentValue);

        if (nextValue === undefined) {
          return {
            updated: false,
            value: currentValue,
          };
        }

        if (currentResult.rows[0]) {
          const updateResult = await pool.query(
            `
              UPDATE storage_kv
              SET value = $3::jsonb, updated_at = NOW()
              WHERE namespace = $1
                AND record_key = $2
                AND value = $4::jsonb
              RETURNING value
            `,
            [namespace, key, JSON.stringify(nextValue), JSON.stringify(currentValue)],
          );

          if (updateResult.rowCount > 0) {
            return {
              updated: true,
              value: updateResult.rows[0].value,
            };
          }

          continue;
        }

        const insertResult = await pool.query(
          `
            INSERT INTO storage_kv (namespace, record_key, value, updated_at)
            VALUES ($1, $2, $3::jsonb, NOW())
            ON CONFLICT DO NOTHING
            RETURNING value
          `,
          [namespace, key, JSON.stringify(nextValue)],
        );

        if (insertResult.rowCount > 0) {
          return {
            updated: true,
            value: insertResult.rows[0].value,
          };
        }
      }

      throw new Error(`原子更新 storage_kv 失败：${namespace}/${key}`);
    },
    async listRecordValues({ namespace, fallbackValue = [] }) {
      await ensureSchema();
      const result = await pool.query(
        "SELECT value FROM storage_kv WHERE namespace = $1 ORDER BY updated_at DESC",
        [namespace],
      );
      return result.rows.length > 0 ? result.rows.map((row) => row.value) : fallbackValue;
    },
  };
}

async function createMetadataStore() {
  if (storageBackend === "postgres") {
    return createPostgresStore();
  }

  return createFileStore();
}

export async function getMetadataStore() {
  if (!cachedStore) {
    cachedStore = await createMetadataStore();
    await cachedStore.ensureReady();
  }

  return cachedStore;
}

export async function ensureMetadataStorage() {
  const store = await getMetadataStore();
  await store.ensureReady();
  return store.backend;
}

export function getMetadataBackendName() {
  return storageBackend;
}

/*
 * Code Review:
 * - 该门面刻意保持为“键值 + 清单”级别，而不是一开始就抽成复杂 ORM，符合当前阶段的 KISS 要求。
 * - `file` 后端继续兼容现有路径布局，保证升级后无需先做一次全量数据迁移才能跑起来。
 * - `postgres` 后端统一落到 `storage_kv`，虽然不算最终高性能形态，但足以让所有仓储先在同一持久层抽象上运行。
 * - 新增的原子更新接口专门服务任务领取和并发状态变更，避免把 compare-and-swap 逻辑散落到各个仓储里。
 */
