/*
 * File: AuthScreen.tsx
 * Module: apps/web (认证界面)
 *
 * Responsibility:
 *   - 为正式登录体系提供登录与注册入口，并在未认证时替代工作台主界面。
 *   - 把认证表单和交互反馈收敛到单独组件，避免 `App` 继续膨胀。
 *
 * Dependencies:
 *   - react
 *   - ../api
 *
 * Last Updated:
 *   - 2026-03-08 by Codex - 初始化正式登录入口界面
 */

import { useState } from "react";
import { loginWithPassword, registerWithPassword } from "../api";

type AuthMode = "login" | "register";

export default function AuthScreen({ onAuthenticated }: { onAuthenticated: () => Promise<void> | void }) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [errorText, setErrorText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit() {
    setErrorText("");
    setIsSubmitting(true);

    try {
      if (mode === "login") {
        await loginWithPassword({ email, password });
      } else {
        await registerWithPassword({ email, password, displayName });
      }

      await onAuthenticated();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "认证请求失败");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="brand-mark">K</div>
          <div>
            <strong>考拉论文</strong>
            <small>正式登录后进入论文工作台</small>
          </div>
        </div>

        <div className="auth-tabs">
          <button
            type="button"
            className={`auth-tab${mode === "login" ? " auth-tab-active" : ""}`}
            onClick={() => setMode("login")}
          >
            登录
          </button>
          <button
            type="button"
            className={`auth-tab${mode === "register" ? " auth-tab-active" : ""}`}
            onClick={() => setMode("register")}
          >
            注册
          </button>
        </div>

        <div className="auth-form">
          {mode === "register" ? (
            <label className="auth-field">
              <span>显示名称</span>
              <input
                type="text"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="例如：张三"
              />
            </label>
          ) : null}

          <label className="auth-field">
            <span>邮箱</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@example.com"
            />
          </label>

          <label className="auth-field">
            <span>密码</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="至少 8 位密码"
            />
          </label>

          {errorText ? <div className="auth-error">{errorText}</div> : null}

          <button type="button" className="accent-button auth-submit" onClick={() => void handleSubmit()} disabled={isSubmitting}>
            {isSubmitting ? "提交中..." : mode === "login" ? "登录并进入工作台" : "注册并进入工作台"}
          </button>

          <small className="auth-hint">
            当前阶段已启用正式 cookie 会话，后续会继续补充组织空间、团队权限和审计能力。
          </small>
        </div>
      </div>
    </div>
  );
}

/*
 * Code Review:
 * - 认证页故意保持单入口设计，先把正式登录链路接通，再在后续加入邮箱验证、找回密码等扩展流。
 * - 登录和注册共用同一张卡片，减少路由和状态复杂度，适合当前单页工作台架构。
 * - 当前组件不直接持有全局用户状态，只负责提交和通知外层刷新，避免和 `App` 的主业务状态耦合。
 */
