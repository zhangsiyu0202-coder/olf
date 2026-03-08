/*
 * File: organizations.js
 * Module: packages/runtime-store (组织与团队仓储)
 *
 * Responsibility:
 *   - 为组织、团队和成员关系提供结构化 PostgreSQL 持久化。
 *   - 支撑团队空间、组织级项目管理和更细粒度权限的底层数据模型。
 *
 * Dependencies:
 *   - ./storage/platform-database
 *
 * Last Updated:
 *   - 2026-03-08 by Codex - 扩展组织团队仓储以支持工作空间访问和成员查询
 */

import { ensurePlatformSchema } from "./storage/platform-database.js";

export async function getOrganizationById(organizationId) {
  const database = await ensurePlatformSchema();
  const result = await database.query(
    `
      SELECT
        id,
        slug,
        name,
        owner_user_id AS "ownerUserId",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM organizations
      WHERE id = $1
      LIMIT 1
    `,
    [organizationId],
  );

  return result.rows[0] ?? null;
}

export async function createOrganization({ slug, name, ownerUserId }) {
  const database = await ensurePlatformSchema();
  const organizationResult = await database.query(
    `
      INSERT INTO organizations (slug, name, owner_user_id)
      VALUES ($1, $2, $3)
      RETURNING
        id,
        slug,
        name,
        owner_user_id AS "ownerUserId",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `,
    [slug, name, ownerUserId],
  );
  const organization = organizationResult.rows[0] ?? null;

  await database.query(
    `
      INSERT INTO organization_memberships (organization_id, user_id, role)
      VALUES ($1, $2, 'owner')
      ON CONFLICT (organization_id, user_id) DO NOTHING
    `,
    [organization.id, ownerUserId],
  );

  return organization;
}

export async function getOrganizationMembership(organizationId, userId) {
  const database = await ensurePlatformSchema();
  const result = await database.query(
    `
      SELECT
        organization_id AS "organizationId",
        user_id AS "userId",
        role,
        created_at AS "createdAt"
      FROM organization_memberships
      WHERE organization_id = $1 AND user_id = $2
      LIMIT 1
    `,
    [organizationId, userId],
  );

  return result.rows[0] ?? null;
}

export async function listOrganizationsForUser(userId) {
  const database = await ensurePlatformSchema();
  const result = await database.query(
    `
      SELECT
        o.id,
        o.slug,
        o.name,
        o.owner_user_id AS "ownerUserId",
        o.created_at AS "createdAt",
        o.updated_at AS "updatedAt",
        m.role AS "currentUserRole"
      FROM organizations o
      JOIN organization_memberships m
        ON m.organization_id = o.id
      WHERE m.user_id = $1
      ORDER BY o.updated_at DESC
    `,
    [userId],
  );

  return result.rows;
}

export async function addOrganizationMember({ organizationId, userId, role }) {
  const database = await ensurePlatformSchema();
  await database.query(
    `
      INSERT INTO organization_memberships (organization_id, user_id, role)
      VALUES ($1, $2, $3)
      ON CONFLICT (organization_id, user_id)
      DO UPDATE SET role = EXCLUDED.role
    `,
    [organizationId, userId, role],
  );
}

export async function listOrganizationMembers(organizationId) {
  const database = await ensurePlatformSchema();
  const result = await database.query(
    `
      SELECT
        m.organization_id AS "organizationId",
        m.user_id AS "userId",
        m.role,
        m.created_at AS "createdAt",
        u.email,
        u.display_name AS "displayName"
      FROM organization_memberships m
      JOIN auth_users u ON u.id = m.user_id
      WHERE m.organization_id = $1
      ORDER BY m.created_at ASC
    `,
    [organizationId],
  );

  return result.rows;
}

export async function createTeam({ organizationId, slug, name }) {
  const database = await ensurePlatformSchema();
  const result = await database.query(
    `
      INSERT INTO teams (organization_id, slug, name)
      VALUES ($1, $2, $3)
      RETURNING
        id,
        organization_id AS "organizationId",
        slug,
        name,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `,
    [organizationId, slug, name],
  );

  return result.rows[0] ?? null;
}

export async function getTeamById(teamId) {
  const database = await ensurePlatformSchema();
  const result = await database.query(
    `
      SELECT
        id,
        organization_id AS "organizationId",
        slug,
        name,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM teams
      WHERE id = $1
      LIMIT 1
    `,
    [teamId],
  );

  return result.rows[0] ?? null;
}

export async function listTeams(organizationId) {
  const database = await ensurePlatformSchema();
  const result = await database.query(
    `
      SELECT
        id,
        organization_id AS "organizationId",
        slug,
        name,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM teams
      WHERE organization_id = $1
      ORDER BY created_at ASC
    `,
    [organizationId],
  );

  return result.rows;
}

export async function listTeamsForUser(userId) {
  const database = await ensurePlatformSchema();
  const result = await database.query(
    `
      SELECT
        t.id,
        t.organization_id AS "organizationId",
        t.slug,
        t.name,
        t.created_at AS "createdAt",
        t.updated_at AS "updatedAt",
        m.role AS "currentUserRole"
      FROM teams t
      JOIN team_memberships m
        ON m.team_id = t.id
      WHERE m.user_id = $1
      ORDER BY t.created_at ASC
    `,
    [userId],
  );

  return result.rows;
}

export async function addTeamMember({ teamId, userId, role }) {
  const database = await ensurePlatformSchema();
  await database.query(
    `
      INSERT INTO team_memberships (team_id, user_id, role)
      VALUES ($1, $2, $3)
      ON CONFLICT (team_id, user_id)
      DO UPDATE SET role = EXCLUDED.role
    `,
    [teamId, userId, role],
  );
}

export async function getTeamMembership(teamId, userId) {
  const database = await ensurePlatformSchema();
  const result = await database.query(
    `
      SELECT
        team_id AS "teamId",
        user_id AS "userId",
        role,
        created_at AS "createdAt"
      FROM team_memberships
      WHERE team_id = $1 AND user_id = $2
      LIMIT 1
    `,
    [teamId, userId],
  );

  return result.rows[0] ?? null;
}

export async function listTeamMembers(teamId) {
  const database = await ensurePlatformSchema();
  const result = await database.query(
    `
      SELECT
        m.team_id AS "teamId",
        m.user_id AS "userId",
        m.role,
        m.created_at AS "createdAt",
        u.email,
        u.display_name AS "displayName"
      FROM team_memberships m
      JOIN auth_users u ON u.id = m.user_id
      WHERE m.team_id = $1
      ORDER BY m.created_at ASC
    `,
    [teamId],
  );

  return result.rows;
}

/*
 * Code Review:
 * - 组织和团队仓储当前只负责结构化持久化，不直接判定业务权限，避免仓储层承担过多流程语义。
 * - 组织/团队 membership 先用显式 role 字段建模，后续若引入自定义角色矩阵，也能在不破坏表结构的前提下扩展。
 * - 当前项目归属关系仍然保留在项目仓储清单中，但这里已经提供了足够的查询能力，让项目工作空间访问控制可以逐步切换到组织/团队模型。
 */
