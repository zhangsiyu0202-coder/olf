/*
 * File: vite.config.ts
 * Module: apps/web (前端构建配置)
 *
 * Responsibility:
 *   - 为 React + TypeScript + Vite 前端提供统一构建入口。
 *   - 在开发阶段把 `/api` 请求代理到后端服务，避免前端自行拼接开发环境地址。
 *
 * Runtime Logic Overview:
 *   1. 本地开发时由 Vite 提供 HMR 和静态资源服务。
 *   2. `/api` 请求会代理到环境变量指定的 API 服务，默认仍为本地 `127.0.0.1:3000`。
 *   3. 生产构建产物输出到 `apps/web/dist`，由 API 服务统一托管。
 *
 * Dependencies:
 *   - vite
 *   - @vitejs/plugin-react
 *
 * Last Updated:
 *   - 2026-03-09 by Codex - 接入 Tailwind Vite 插件，为阅读页使用 Tailwind 工具类做准备
 */

import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const webHost = env.WEB_HOST || "127.0.0.1";
  const webPort = Number(env.WEB_PORT || "5173");
  const apiPort = Number(env.API_PORT || "3000");
  const apiProxyTarget = env.VITE_API_PROXY_TARGET || `http://127.0.0.1:${apiPort}`;

  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: webHost,
      port: Number.isInteger(webPort) && webPort > 0 ? webPort : 5173,
      proxy: {
        "/api": {
          target: apiProxyTarget,
          changeOrigin: true,
          ws: true,
        },
      },
    },
  };
});

/*
 * Code Review:
 * - 当前配置保持极简，只解决 React 构建和 API 代理，不提前引入复杂别名和环境矩阵。
 * - API 代理与前端端口都收敛到环境变量，能避免本地多实例测试时出现“前端命中旧 API 端口”的问题。
 * - 构建产物仍交由 API 托管，避免前后端部署方式分叉。
 */
