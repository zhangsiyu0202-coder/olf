/*
 * File: invitations.js
 * Module: packages/runtime-store (项目邀请仓储)
 *
 * Responsibility:
 *   - 保存项目邀请链接与其生命周期状态。
 *   - 为项目成员与邀请系统提供统一的邀请创建、查询和撤销能力。
 *
 * Runtime Logic Overview:
 *   1. 项目所有者创建邀请后，本模块生成稳定 token 并持久化。
 *   2. 受邀用户通过 token 查询邀请并加入项目。
 *   3. 邀请可按项目维度列出和撤销，避免项目级分享状态散落到前端。
 *
 * Dependencies:
 *   - node:crypto
 *   - node:path
 *   - packages/contracts
 *   - packages/runtime-store/storage/metadata-store
 *   - packages/shared/paths
 *
 * Last Updated:
 *   - 2026-03-08 by Codex - 将项目邀请默认角色升级为 editor 并兼容旧 collaborator 数据
 */

import crypto from "node:crypto";
import path from "node:path";
import { PROJECT_INVITE_TTL_MS, PROJECT_MEMBER_ROLE } from "../../contracts/src/index.js";
import { runtimeDataRoot } from "../../shared/src/paths.js";
import { ensureMetadataStorage, getMetadataStore } from "./storage/metadata-store.js";

const invitationsManifestPath = path.join(runtimeDataRoot, "project-invitations.json");
const invitationsNamespace = "project-invitations";

function normalizeInvitation(invitation) {
  const rawRole = invitation.role ?? PROJECT_MEMBER_ROLE.editor;

  return {
    token: invitation.token,
    projectId: invitation.projectId,
    role: rawRole === "collaborator" ? PROJECT_MEMBER_ROLE.editor : rawRole,
    createdBy: invitation.createdBy,
    createdByName: invitation.createdByName ?? "未知用户",
    createdAt: invitation.createdAt,
    expiresAt: invitation.expiresAt,
    revokedAt: invitation.revokedAt ?? null,
  };
}

async function readInvitationsManifest() {
  const store = await getMetadataStore();
  const invitations = await store.readManifest({
    namespace: invitationsNamespace,
    filePath: invitationsManifestPath,
    fallbackValue: [],
  });
  return invitations.map(normalizeInvitation);
}

async function writeInvitationsManifest(invitations) {
  const store = await getMetadataStore();
  await store.writeManifest({
    namespace: invitationsNamespace,
    filePath: invitationsManifestPath,
    value: invitations.map(normalizeInvitation),
  });
}

export async function ensureInvitationStorage() {
  await ensureMetadataStorage();
  const store = await getMetadataStore();
  const existing = await store.readManifest({
    namespace: invitationsNamespace,
    filePath: invitationsManifestPath,
    fallbackValue: null,
  });

  if (!existing) {
    await writeInvitationsManifest([]);
  }
}

export async function listProjectInvitations(projectId) {
  await ensureInvitationStorage();
  const invitations = await readInvitationsManifest();
  return invitations
    .filter((invitation) => invitation.projectId === projectId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function getInvitation(token) {
  const invitations = await listAllInvitations();
  return invitations.find((invitation) => invitation.token === token) ?? null;
}

export async function listAllInvitations() {
  await ensureInvitationStorage();
  return readInvitationsManifest();
}

export async function createProjectInvitation(
  projectId,
  { createdBy, createdByName, role = PROJECT_MEMBER_ROLE.editor, ttlMs = PROJECT_INVITE_TTL_MS },
) {
  await ensureInvitationStorage();
  const invitations = await readInvitationsManifest();
  const now = new Date();
  const invitation = normalizeInvitation({
    token: crypto.randomBytes(18).toString("base64url"),
    projectId,
    role,
    createdBy,
    createdByName,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
  });

  invitations.push(invitation);
  await writeInvitationsManifest(invitations);
  return invitation;
}

export async function revokeProjectInvitation(projectId, token) {
  const invitations = await listAllInvitations();
  let revokedInvitation = null;
  const now = new Date().toISOString();
  const nextInvitations = invitations.map((invitation) => {
    if (invitation.projectId !== projectId || invitation.token !== token) {
      return invitation;
    }

    revokedInvitation = normalizeInvitation({
      ...invitation,
      revokedAt: now,
    });
    return revokedInvitation;
  });

  if (!revokedInvitation) {
    throw new Error("邀请不存在");
  }

  await writeInvitationsManifest(nextInvitations);
  return revokedInvitation;
}

export function assertInvitationUsable(invitation) {
  if (!invitation) {
    throw new Error("邀请不存在");
  }

  if (invitation.revokedAt) {
    throw new Error("邀请已失效");
  }

  if (new Date(invitation.expiresAt).getTime() < Date.now()) {
    throw new Error("邀请已过期");
  }
}

/*
 * Code Review:
 * - 邀请仓储当前只负责分享链接生命周期，不混入成员添加逻辑，保持职责单一。
 * - 第一版邀请设计为可重复使用的项目链接，更贴近真实协作产品，而不是一次性注册码。
 * - 后续若要增加邀请备注、角色粒度或审计日志，应继续在本模块扩展邀请元数据，而不是让前端自行拼装状态。
 */
