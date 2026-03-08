/*
 * File: session.ts
 * Module: apps/web (前端认证会话工具)
 *
 * Responsibility:
 *   - 为前端提供基于服务端认证会话的当前用户装饰和展示辅助。
 *   - 统一生成协作头像颜色，避免 UI、协作和成员面板各自计算一套用户展示信息。
 *
 * Runtime Logic Overview:
 *   1. API 返回正式认证用户后，由本模块补齐前端展示所需的颜色字段。
 *   2. HTTP 请求不再附带本地演示身份头，统一依赖浏览器 cookie 会话。
 *   3. 协作和成员展示都复用同一套颜色派生规则。
 *
 * Dependencies:
 *   - 浏览器原生运行时
 *   - ./types
 *
 * Last Updated:
 *   - 2026-03-08 by Codex - 用正式认证会话替换本地演示用户工具
 */

import type { SessionUser } from "./types";

const userPalette = [
  { color: "#30bced", colorLight: "#30bced33" },
  { color: "#6eeb83", colorLight: "#6eeb8333" },
  { color: "#ffbc42", colorLight: "#ffbc4233" },
  { color: "#ee6352", colorLight: "#ee635233" },
  { color: "#9ac2c9", colorLight: "#9ac2c933" },
  { color: "#8b5cf6", colorLight: "#8b5cf633" },
];

function hashString(input: string) {
  let hash = 0;

  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash);
}

export function decorateSessionUser(user: {
  id: string;
  name: string;
  email?: string;
  displayName?: string;
}): SessionUser {
  const palette = userPalette[hashString(user.id) % userPalette.length] ?? {
    color: "#30bced",
    colorLight: "#30bced33",
  };
  const sessionUser: SessionUser = {
    id: user.id,
    name: user.name,
    color: palette.color,
    colorLight: palette.colorLight,
  };

  if (user.email) {
    sessionUser.email = user.email;
  }

  sessionUser.displayName = user.displayName ?? user.name;

  return sessionUser;
}

export function getRequestUserHeaders() {
  return {};
}

export function buildCurrentUserQuery() {
  return "";
}

/*
 * Code Review:
 * - 本模块只保留“展示装饰”和兼容性函数，不再承担正式登录状态持久化职责，避免与服务端 cookie 会话重复。
 * - 颜色派生基于稳定 userId 哈希，能保证同一用户在协作和成员面板中的视觉身份一致。
 * - 当前仍保留空实现的请求头/查询参数函数，是为了平滑替换旧调用点，后续可在调用方完全收敛后移除。
 */
