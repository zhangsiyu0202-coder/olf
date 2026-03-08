/*
 * File: version-events.js
 * Module: packages/runtime-store (版本事件仓储)
 *
 * Responsibility:
 *   - 记录项目层的关键版本事件，为后续版本回放和时间线面板提供索引。
 *   - 将文件操作、快照、恢复和编译里程碑集中成统一事件流。
 *
 * Dependencies:
 *   - ./storage/platform-database
 *
 * Last Updated:
 *   - 2026-03-08 by Codex - 初始化版本事件仓储
 */

import { ensurePlatformSchema } from "./storage/platform-database.js";

async function getVersionEventDatabase() {
  try {
    return await ensurePlatformSchema();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes("平台数据库未配置")) {
      return null;
    }

    throw error;
  }
}

export async function appendVersionEvent(event) {
  const database = await getVersionEventDatabase();

  if (!database) {
    return false;
  }

  await database.query(
    `
      INSERT INTO version_events (
        project_id,
        actor_user_id,
        file_path,
        event_type,
        snapshot_id,
        payload
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
    `,
    [
      event.projectId,
      event.actorUserId ?? null,
      event.filePath ?? null,
      event.eventType,
      event.snapshotId ?? null,
      JSON.stringify(event.payload ?? {}),
    ],
  );

  return true;
}

export async function listVersionEvents(projectId, limit = 100) {
  const database = await getVersionEventDatabase();

  if (!database) {
    return [];
  }

  const result = await database.query(
    `
      SELECT
        id,
        project_id AS "projectId",
        actor_user_id AS "actorUserId",
        file_path AS "filePath",
        event_type AS "eventType",
        snapshot_id AS "snapshotId",
        payload,
        created_at AS "createdAt"
      FROM version_events
      WHERE project_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `,
    [projectId, limit],
  );

  return result.rows;
}

/*
 * Code Review:
 * - 版本事件仓储和快照索引是互补关系：前者提供时间线入口，后者提供实际恢复载体。
 * - 先用追加型事件流保证实现简单，后续若要做真正回放，可在不破坏接口的前提下补更多事件类型和游标。
 * - 这里不直接读取项目文件内容，避免版本系统和文件存储强耦合。
 * - 若平台数据库未启用，事件流会自动降级为空实现，保证基础文件模式仍能跑通主链路。
 */
