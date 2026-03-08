/*
 * File: audit.js
 * Module: packages/runtime-store (审计仓储)
 *
 * Responsibility:
 *   - 为平台化阶段的认证、组织、项目和编译操作记录统一审计日志。
 *   - 提供查询项目/组织维度审计事件的最小读取接口，支撑后续审计面板和版本回放。
 *
 * Dependencies:
 *   - ./storage/platform-database
 *
 * Last Updated:
 *   - 2026-03-08 by Codex - 初始化平台化阶段审计日志仓储
 */

import { ensurePlatformSchema } from "./storage/platform-database.js";

async function getAuditDatabase() {
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

export async function appendAuditLog(entry) {
  const database = await getAuditDatabase();

  if (!database) {
    return false;
  }

  await database.query(
    `
      INSERT INTO audit_logs (
        actor_user_id,
        project_id,
        organization_id,
        team_id,
        action,
        target_type,
        target_id,
        payload
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
    `,
    [
      entry.actorUserId ?? null,
      entry.projectId ?? null,
      entry.organizationId ?? null,
      entry.teamId ?? null,
      entry.action,
      entry.targetType,
      entry.targetId ?? null,
      JSON.stringify(entry.payload ?? {}),
    ],
  );

  return true;
}

export async function listAuditLogs({ projectId = null, organizationId = null, limit = 100 } = {}) {
  const database = await getAuditDatabase();

  if (!database) {
    return [];
  }

  const conditions = [];
  const params = [];

  if (projectId) {
    params.push(projectId);
    conditions.push(`project_id = $${params.length}`);
  }

  if (organizationId) {
    params.push(organizationId);
    conditions.push(`organization_id = $${params.length}`);
  }

  params.push(limit);

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await database.query(
    `
      SELECT
        id,
        actor_user_id AS "actorUserId",
        project_id AS "projectId",
        organization_id AS "organizationId",
        team_id AS "teamId",
        action,
        target_type AS "targetType",
        target_id AS "targetId",
        payload,
        created_at AS "createdAt"
      FROM audit_logs
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${params.length}
    `,
    params,
  );

  return result.rows;
}

/*
 * Code Review:
 * - 审计仓储保持 append/list 两个核心动作，先建立稳定入口，再逐步扩展过滤和回放能力。
 * - 这里不尝试在数据库层表达复杂权限语义，调用方仍需先做访问控制，再读取审计记录。
 * - `payload` 保持 JSONB，可支撑不同模块逐步追加事件字段，而不需要频繁改表。
 * - 若当前进程未启用平台数据库，审计接口会自动降级为空实现，避免拖垮文件模式和基础烟雾测试。
 */
