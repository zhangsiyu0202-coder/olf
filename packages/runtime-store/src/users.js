/*
 * File: users.js
 * Module: packages/runtime-store (用户仓储)
 *
 * Responsibility:
 *   - 为当前成品阶段提供最小可用的本地用户档案持久化能力。
 *   - 为项目成员、邀请和访问控制提供统一的用户身份入口。
 *
 * Runtime Logic Overview:
 *   1. API 在每次请求到达时根据请求头或查询参数解析当前用户。
 *   2. 若用户不存在，则创建或更新本地用户档案。
 *   3. 其他仓储通过这里读取用户基本信息，避免重复维护用户元数据。
 *
 * Dependencies:
 *   - packages/runtime-store/storage/metadata-store
 *   - packages/shared/paths
 *
 * Last Updated:
 *   - 2026-03-07 by Codex - 初始化成员与邀请系统的最小用户仓储
 */

import path from "node:path";
import { runtimeDataRoot } from "../../shared/src/paths.js";
import { ensureMetadataStorage, getMetadataStore } from "./storage/metadata-store.js";

const usersManifestPath = path.join(runtimeDataRoot, "users.json");
const usersNamespace = "users";

function normalizeUser(user) {
  return {
    id: user.id,
    name: user.name,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt ?? user.createdAt,
  };
}

async function readUsersManifest() {
  const store = await getMetadataStore();
  const users = await store.readManifest({
    namespace: usersNamespace,
    filePath: usersManifestPath,
    fallbackValue: [],
  });
  return users.map(normalizeUser);
}

async function writeUsersManifest(users) {
  const store = await getMetadataStore();
  await store.writeManifest({
    namespace: usersNamespace,
    filePath: usersManifestPath,
    value: users.map(normalizeUser),
  });
}

export async function ensureUserStorage() {
  await ensureMetadataStorage();
  const store = await getMetadataStore();
  const existing = await store.readManifest({
    namespace: usersNamespace,
    filePath: usersManifestPath,
    fallbackValue: null,
  });

  if (!existing) {
    await writeUsersManifest([]);
  }
}

export async function listUsers() {
  await ensureUserStorage();
  return readUsersManifest();
}

export async function getUser(userId) {
  const users = await listUsers();
  return users.find((user) => user.id === userId) ?? null;
}

export async function ensureUserProfile({ id, name }) {
  const trimmedId = String(id ?? "").trim();
  const trimmedName = String(name ?? "").trim();

  if (!trimmedId) {
    throw new Error("当前用户标识不能为空");
  }

  if (!trimmedName) {
    throw new Error("当前用户名不能为空");
  }

  const users = await listUsers();
  const now = new Date().toISOString();
  const existingUser = users.find((user) => user.id === trimmedId) ?? null;

  if (!existingUser) {
    const createdUser = normalizeUser({
      id: trimmedId,
      name: trimmedName,
      createdAt: now,
      updatedAt: now,
    });
    users.push(createdUser);
    await writeUsersManifest(users);
    return createdUser;
  }

  if (existingUser.name !== trimmedName) {
    const updatedUsers = users.map((user) =>
      user.id === trimmedId
        ? normalizeUser({
            ...user,
            name: trimmedName,
            updatedAt: now,
          })
        : user,
    );
    await writeUsersManifest(updatedUsers);
    return updatedUsers.find((user) => user.id === trimmedId) ?? existingUser;
  }

  return existingUser;
}

/*
 * Code Review:
 * - 当前用户体系刻意保持极简，只保存 `id + name`，先支撑成员关系和邀请流转，不提前引入完整认证系统。
 * - 用户档案采用 upsert 语义，允许前端本地演示身份在改名后自然同步到后端。
 * - 若后续接入正式鉴权，应保留本模块作为用户基础资料读取入口，而不是让请求解析逻辑散落到业务层。
 */
