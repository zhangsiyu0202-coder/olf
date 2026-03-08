/*
 * File: ai-conversations.js
 * Module: packages/runtime-store (AI 对话仓储)
 *
 * Responsibility:
 *   - 持久化按“项目 + 用户”划分的 AI 对话历史。
 *   - 为 AI 问答模块提供统一的历史读取、追加和清空入口。
 *
 * Runtime Logic Overview:
 *   1. API 在处理问答请求前读取当前项目与当前用户的历史消息。
 *   2. AI 返回后，把本轮用户消息和助手回复追加到同一会话。
 *   3. 前端切换项目或用户时，可重新加载同一会话历史。
 *
 * Dependencies:
 *   - packages/runtime-store/storage/metadata-store
 *   - packages/shared/paths
 *
 * Last Updated:
 *   - 2026-03-07 by Codex - 初始化 AI 对话持久化仓储
 */

import path from "node:path";
import { runtimeDataRoot } from "../../shared/src/paths.js";
import { ensureMetadataStorage, getMetadataStore } from "./storage/metadata-store.js";

const aiConversationsManifestPath = path.join(runtimeDataRoot, "ai-conversations.json");
const maxConversationMessages = 20;
const aiConversationNamespace = "ai-conversations";

function normalizeMessage(message) {
  return {
    role: message.role === "user" ? "user" : "assistant",
    content: String(message.content ?? ""),
  };
}

function normalizeConversation(entry) {
  return {
    conversationKey: entry.conversationKey,
    projectId: entry.projectId,
    userId: entry.userId,
    messages: Array.isArray(entry.messages) ? entry.messages.map(normalizeMessage).slice(-maxConversationMessages) : [],
    updatedAt: entry.updatedAt ?? new Date().toISOString(),
  };
}

async function readConversationsManifest() {
  const store = await getMetadataStore();
  const conversations = await store.readManifest({
    namespace: aiConversationNamespace,
    filePath: aiConversationsManifestPath,
    fallbackValue: [],
  });
  return conversations.map(normalizeConversation);
}

async function writeConversationsManifest(conversations) {
  const store = await getMetadataStore();
  await store.writeManifest({
    namespace: aiConversationNamespace,
    filePath: aiConversationsManifestPath,
    value: conversations.map(normalizeConversation),
  });
}

function createConversationKey(projectId, userId) {
  return `${projectId}:${userId}`;
}

export async function ensureAIConversationStorage() {
  await ensureMetadataStorage();
  const store = await getMetadataStore();
  const existing = await store.readManifest({
    namespace: aiConversationNamespace,
    filePath: aiConversationsManifestPath,
    fallbackValue: null,
  });

  if (!existing) {
    await writeConversationsManifest([]);
  }
}

export async function getAIConversation(projectId, userId) {
  await ensureAIConversationStorage();
  const conversationKey = createConversationKey(projectId, userId);
  const conversations = await readConversationsManifest();
  const conversation = conversations.find((entry) => entry.conversationKey === conversationKey) ?? null;

  return conversation ?? {
    conversationKey,
    projectId,
    userId,
    messages: [],
    updatedAt: new Date().toISOString(),
  };
}

export async function saveAIConversation(projectId, userId, messages) {
  await ensureAIConversationStorage();
  const conversationKey = createConversationKey(projectId, userId);
  const conversations = await readConversationsManifest();
  const nextConversation = normalizeConversation({
    conversationKey,
    projectId,
    userId,
    messages,
    updatedAt: new Date().toISOString(),
  });
  const nextConversations = conversations.some((entry) => entry.conversationKey === conversationKey)
    ? conversations.map((entry) => (entry.conversationKey === conversationKey ? nextConversation : entry))
    : [...conversations, nextConversation];

  await writeConversationsManifest(nextConversations);
  return nextConversation;
}

export async function appendAIConversationExchange(projectId, userId, userMessage, assistantMessage) {
  const conversation = await getAIConversation(projectId, userId);
  return saveAIConversation(projectId, userId, [
    ...conversation.messages,
    normalizeMessage(userMessage),
    normalizeMessage(assistantMessage),
  ]);
}

export async function clearAIConversation(projectId, userId) {
  return saveAIConversation(projectId, userId, []);
}

/*
 * Code Review:
 * - 当前会话粒度明确收敛到“项目 + 用户”，优先匹配工作台产品形态，不提前引入更重的 conversationId 体系。
 * - 历史消息上限固定为 20 条，先满足产品连续性和 token 成本之间的平衡。
 * - 后续若把 AI 会话迁移到数据库，应保留本模块作为唯一读写入口，避免 API 和服务层直接操作底层存储。
 */
