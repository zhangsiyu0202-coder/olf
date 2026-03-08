/*
 * File: service.js
 * Module: packages/authentication (认证核心)
 *
 * Responsibility:
 *   - 提供正式登录体系所需的密码哈希、会话 token、注册、登录和请求鉴权逻辑。
 *   - 把认证策略从 API 路由中抽离出来，避免 `apps/api` 演变成认证实现细节堆积地。
 *
 * Dependencies:
 *   - node:crypto
 *   - packages/runtime-store/auth
 *   - packages/runtime-store/audit
 *
 * Last Updated:
 *   - 2026-03-08 by Codex - 初始化正式登录体系核心服务
 */

import crypto from "node:crypto";
import {
  createAuthSession,
  createAuthUser,
  getAuthSessionByTokenHash,
  getAuthUserByEmail,
  revokeAuthSession,
  touchAuthUserLogin,
} from "../../runtime-store/src/auth.js";
import { appendAuditLog } from "../../runtime-store/src/audit.js";

const passwordSaltLength = 16;
const passwordKeyLength = 64;
const passwordDerivationCost = 16384;
const sessionDurationMs = Number(process.env.AUTH_SESSION_TTL_MS ?? 30 * 24 * 60 * 60 * 1000);

export const sessionCookieName = "overleaf_session";

function normalizeEmail(email) {
  const normalizedEmail = String(email ?? "").trim().toLowerCase();

  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    throw new Error("邮箱格式不正确");
  }

  return normalizedEmail;
}

function normalizeDisplayName(displayName) {
  const normalizedName = String(displayName ?? "").trim();

  if (!normalizedName) {
    throw new Error("显示名称不能为空");
  }

  return normalizedName;
}

function normalizePassword(password) {
  const normalizedPassword = String(password ?? "");

  if (normalizedPassword.length < 8) {
    throw new Error("密码长度至少为 8 位");
  }

  return normalizedPassword;
}

function derivePasswordHash(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      password,
      salt,
      passwordKeyLength,
      { N: passwordDerivationCost, r: 8, p: 1 },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(derivedKey.toString("hex"));
      },
    );
  });
}

async function createPasswordHash(password) {
  const salt = crypto.randomBytes(passwordSaltLength).toString("hex");
  const derivedKey = await derivePasswordHash(password, salt);
  return `scrypt$${salt}$${derivedKey}`;
}

async function verifyPasswordHash(password, passwordHash) {
  const [algorithm, salt, storedHash] = String(passwordHash ?? "").split("$");

  if (algorithm !== "scrypt" || !salt || !storedHash) {
    return false;
  }

  const derivedHash = await derivePasswordHash(password, salt);
  return crypto.timingSafeEqual(Buffer.from(derivedHash, "hex"), Buffer.from(storedHash, "hex"));
}

function createSessionToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function hashSessionToken(sessionToken) {
  return crypto.createHash("sha256").update(sessionToken).digest("hex");
}

function extractCookieValue(cookieHeader, cookieName) {
  const rawCookie = String(cookieHeader ?? "");
  const cookieParts = rawCookie.split(";").map((part) => part.trim());
  const matchedCookie = cookieParts.find((part) => part.startsWith(`${cookieName}=`)) ?? null;

  if (!matchedCookie) {
    return null;
  }

  return decodeURIComponent(matchedCookie.slice(cookieName.length + 1));
}

export function buildSessionCookie(sessionToken, expiresAt) {
  const maxAge = Math.max(1, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  const secureFlag = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${sessionCookieName}=${encodeURIComponent(sessionToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureFlag}`;
}

export function buildExpiredSessionCookie() {
  return `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function serializeAuthUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.displayName,
    displayName: user.displayName,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt,
  };
}

export async function registerWithPassword({ email, password, displayName, ipAddress, userAgent }) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedPassword = normalizePassword(password);
  const normalizedName = normalizeDisplayName(displayName);
  const existingUser = await getAuthUserByEmail(normalizedEmail);

  if (existingUser) {
    throw new Error("该邮箱已注册");
  }

  const passwordHash = await createPasswordHash(normalizedPassword);
  const user = await createAuthUser({
    email: normalizedEmail,
    passwordHash,
    displayName: normalizedName,
  });
  const sessionToken = createSessionToken();
  const expiresAt = new Date(Date.now() + sessionDurationMs).toISOString();
  const session = await createAuthSession({
    userId: user.id,
    sessionTokenHash: hashSessionToken(sessionToken),
    expiresAt,
    ipAddress,
    userAgent,
  });

  await appendAuditLog({
    actorUserId: user.id,
    action: "auth.register",
    targetType: "user",
    targetId: user.id,
    payload: {
      email: user.email,
    },
  });

  return {
    user: serializeAuthUser(user),
    session,
    sessionToken,
    expiresAt,
  };
}

export async function loginWithPassword({ email, password, ipAddress, userAgent }) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedPassword = normalizePassword(password);
  const existingUser = await getAuthUserByEmail(normalizedEmail);

  if (!existingUser) {
    throw new Error("账号或密码错误");
  }

  const passwordValid = await verifyPasswordHash(normalizedPassword, existingUser.passwordHash);

  if (!passwordValid) {
    throw new Error("账号或密码错误");
  }

  await touchAuthUserLogin(existingUser.id);
  const sessionToken = createSessionToken();
  const expiresAt = new Date(Date.now() + sessionDurationMs).toISOString();
  const session = await createAuthSession({
    userId: existingUser.id,
    sessionTokenHash: hashSessionToken(sessionToken),
    expiresAt,
    ipAddress,
    userAgent,
  });

  await appendAuditLog({
    actorUserId: existingUser.id,
    action: "auth.login",
    targetType: "user",
    targetId: existingUser.id,
    payload: {
      email: existingUser.email,
    },
  });

  return {
    user: serializeAuthUser(existingUser),
    session,
    sessionToken,
    expiresAt,
  };
}

export async function logoutSession(sessionId, actorUserId = null) {
  await revokeAuthSession(sessionId);
  await appendAuditLog({
    actorUserId,
    action: "auth.logout",
    targetType: "session",
    targetId: sessionId,
    payload: {},
  });
}

export async function authenticateRequest(request) {
  const rawSessionToken = extractCookieValue(request.headers.cookie, sessionCookieName);

  if (!rawSessionToken) {
    return null;
  }

  const sessionLookup = await getAuthSessionByTokenHash(hashSessionToken(rawSessionToken));

  if (!sessionLookup) {
    return null;
  }

  const { session, user } = sessionLookup;

  if (session.revokedAt) {
    return null;
  }

  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    return null;
  }

  return {
    session,
    user: serializeAuthUser(user),
  };
}

/*
 * Code Review:
 * - 认证核心采用服务端会话 cookie，而不是先引入 JWT 刷新体系，原因是当前单体 API 场景下服务端可撤销会话更直接、更可控。
 * - 密码哈希使用 Node 原生 `scrypt`，避免为正式登录再额外引入一层 native 依赖。
 * - 当前版本没有邮箱验证、密码重置和多因子认证；这些应在此模块继续演进，而不是回退到前端本地会话。
 */
