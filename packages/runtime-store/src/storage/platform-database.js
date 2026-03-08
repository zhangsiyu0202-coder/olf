/*
 * File: platform-database.js
 * Module: packages/runtime-store (平台数据库)
 *
 * Responsibility:
 *   - 为正式登录、组织团队、审计与版本回放提供统一 PostgreSQL 连接和 schema 初始化。
 *   - 把平台化阶段新增的结构化表收敛在同一入口，避免认证、组织和审计各自管理数据库生命周期。
 *
 * Runtime Logic Overview:
 *   1. 首次访问时读取 `RUNTIME_POSTGRES_URL` 或 `DATABASE_URL` 创建连接池。
 *   2. `ensurePlatformSchema` 负责初始化认证、组织、审计和版本事件等核心表。
 *   3. 上层仓储通过 `getPlatformDatabase` 复用同一连接池执行结构化查询。
 *
 * Dependencies:
 *   - pg
 *
 * Last Updated:
 *   - 2026-03-08 by Codex - 初始化平台化阶段 PostgreSQL 结构化 schema
 */

let cachedDatabase = null;

async function createPlatformDatabase() {
  const { Pool } = await import("pg");
  const connectionString = process.env.RUNTIME_POSTGRES_URL ?? process.env.DATABASE_URL ?? "";

  if (!connectionString.trim()) {
    throw new Error("平台数据库未配置，请先设置 RUNTIME_POSTGRES_URL 或 DATABASE_URL");
  }

  const pool = new Pool({
    connectionString,
  });

  return {
    pool,
    async query(text, params = []) {
      return pool.query(text, params);
    },
  };
}

export async function getPlatformDatabase() {
  if (!cachedDatabase) {
    cachedDatabase = await createPlatformDatabase();
  }

  return cachedDatabase;
}

export async function ensurePlatformSchema() {
  const database = await getPlatformDatabase();

  await database.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE IF NOT EXISTS auth_users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_login_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
      session_token_hash TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      ip_address TEXT,
      user_agent TEXT
    );

    CREATE TABLE IF NOT EXISTS organizations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      owner_user_id UUID NOT NULL REFERENCES auth_users(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS organization_memberships (
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (organization_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS teams (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (organization_id, slug)
    );

    CREATE TABLE IF NOT EXISTS team_memberships (
      team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (team_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      actor_user_id UUID REFERENCES auth_users(id) ON DELETE SET NULL,
      project_id TEXT,
      organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
      team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS version_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id TEXT NOT NULL,
      actor_user_id UUID REFERENCES auth_users(id) ON DELETE SET NULL,
      file_path TEXT,
      event_type TEXT NOT NULL,
      snapshot_id TEXT,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON auth_sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_org_memberships_user_id ON organization_memberships(user_id);
    CREATE INDEX IF NOT EXISTS idx_team_memberships_user_id ON team_memberships(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_project_id ON audit_logs(project_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_user_id ON audit_logs(actor_user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_version_events_project_id ON version_events(project_id);
    CREATE INDEX IF NOT EXISTS idx_version_events_created_at ON version_events(created_at DESC);
  `);

  return database;
}

/*
 * Code Review:
 * - 这里没有直接引入 ORM，而是把 schema 初始化和连接池管理收敛为一个很薄的入口，避免平台化阶段一开始又引入新的重量级抽象。
 * - `auth_users`、`auth_sessions`、`organizations`、`teams`、`audit_logs` 和 `version_events` 是后续平台能力的公共底座，放在一起初始化能减少迁移顺序问题。
 * - 当前项目元数据仍保留在既有仓储中，后续迁移到结构化表时应优先通过仓储层逐步切换，而不是直接让 API 绕过现有边界。
 */
