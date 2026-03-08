/*
 * File: auth.js
 * Module: packages/runtime-store (认证仓储)
 *
 * Responsibility:
 *   - 为正式登录体系提供用户和会话的结构化持久化。
 *   - 把认证相关 PostgreSQL 查询集中在仓储层，避免 API 直接操作数据库。
 *
 * Dependencies:
 *   - ./storage/platform-database
 *
 * Last Updated:
 *   - 2026-03-08 by Codex - 初始化正式认证仓储
 */

import { ensurePlatformSchema } from "./storage/platform-database.js";

function normalizeAuthUser(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastLoginAt: row.lastLoginAt,
  };
}

function normalizeAuthSession(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    userId: row.userId,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
  };
}

export async function createAuthUser({ email, passwordHash, displayName }) {
  const database = await ensurePlatformSchema();
  const result = await database.query(
    `
      INSERT INTO auth_users (email, password_hash, display_name)
      VALUES ($1, $2, $3)
      RETURNING
        id,
        email,
        display_name AS "displayName",
        status,
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        last_login_at AS "lastLoginAt"
    `,
    [email, passwordHash, displayName],
  );

  return normalizeAuthUser(result.rows[0] ?? null);
}

export async function getAuthUserByEmail(email) {
  const database = await ensurePlatformSchema();
  const result = await database.query(
    `
      SELECT
        id,
        email,
        password_hash AS "passwordHash",
        display_name AS "displayName",
        status,
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        last_login_at AS "lastLoginAt"
      FROM auth_users
      WHERE email = $1
      LIMIT 1
    `,
    [email],
  );

  return result.rows[0] ?? null;
}

export async function getAuthUserById(userId) {
  const database = await ensurePlatformSchema();
  const result = await database.query(
    `
      SELECT
        id,
        email,
        display_name AS "displayName",
        status,
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        last_login_at AS "lastLoginAt"
      FROM auth_users
      WHERE id = $1
      LIMIT 1
    `,
    [userId],
  );

  return normalizeAuthUser(result.rows[0] ?? null);
}

export async function touchAuthUserLogin(userId) {
  const database = await ensurePlatformSchema();
  await database.query(
    `
      UPDATE auth_users
      SET last_login_at = NOW(), updated_at = NOW()
      WHERE id = $1
    `,
    [userId],
  );
}

export async function createAuthSession({
  userId,
  sessionTokenHash,
  expiresAt,
  ipAddress = null,
  userAgent = null,
}) {
  const database = await ensurePlatformSchema();
  const result = await database.query(
    `
      INSERT INTO auth_sessions (
        user_id,
        session_token_hash,
        expires_at,
        ip_address,
        user_agent
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING
        id,
        user_id AS "userId",
        created_at AS "createdAt",
        expires_at AS "expiresAt",
        revoked_at AS "revokedAt",
        ip_address AS "ipAddress",
        user_agent AS "userAgent"
    `,
    [userId, sessionTokenHash, expiresAt, ipAddress, userAgent],
  );

  return normalizeAuthSession(result.rows[0] ?? null);
}

export async function getAuthSessionByTokenHash(sessionTokenHash) {
  const database = await ensurePlatformSchema();
  const result = await database.query(
    `
      SELECT
        s.id,
        s.user_id AS "userId",
        s.created_at AS "createdAt",
        s.expires_at AS "expiresAt",
        s.revoked_at AS "revokedAt",
        s.ip_address AS "ipAddress",
        s.user_agent AS "userAgent",
        u.id AS "authUserId",
        u.email,
        u.display_name AS "displayName",
        u.status,
        u.created_at AS "userCreatedAt",
        u.updated_at AS "userUpdatedAt",
        u.last_login_at AS "userLastLoginAt"
      FROM auth_sessions s
      JOIN auth_users u ON u.id = s.user_id
      WHERE s.session_token_hash = $1
      LIMIT 1
    `,
    [sessionTokenHash],
  );

  const row = result.rows[0] ?? null;

  if (!row) {
    return null;
  }

  return {
    session: normalizeAuthSession(row),
    user: normalizeAuthUser({
      id: row.authUserId,
      email: row.email,
      displayName: row.displayName,
      status: row.status,
      createdAt: row.userCreatedAt,
      updatedAt: row.userUpdatedAt,
      lastLoginAt: row.userLastLoginAt,
    }),
  };
}

export async function revokeAuthSession(sessionId) {
  const database = await ensurePlatformSchema();
  await database.query(
    `
      UPDATE auth_sessions
      SET revoked_at = NOW()
      WHERE id = $1
    `,
    [sessionId],
  );
}

/*
 * Code Review:
 * - 认证仓储把密码哈希和会话 token 哈希都作为不可逆字符串持久化，避免 API 层直接接触底层表结构。
 * - 会话查询一次性 join 用户，能减少每次鉴权的额外查询次数，适合当前单体 API 阶段。
 * - 当前仓储还没有实现密码重置、邮箱验证和会话列表管理，这些应作为认证子模块继续追加，而不是污染现有接口。
 */
