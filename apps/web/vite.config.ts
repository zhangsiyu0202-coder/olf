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
 *   2. `/api` 请求会代理到 `127.0.0.1:3000` 的 API 服务。
 *   3. 生产构建产物输出到 `apps/web/dist`，由 API 服务统一托管。
 *
 * Dependencies:
 *   - vite
 *   - @vitejs/plugin-react
 *
 * Last Updated:
 *   - 2026-03-07 by Codex - 为协作 WebSocket 增加开发代理支持
 */

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});

/*
 * Code Review:
 * - 当前配置保持极简，只解决 React 构建和 API 代理，不提前引入复杂别名和环境矩阵。
 * - API 代理固定到本地 3000 端口，符合当前仓库单机开发方式；后续若引入多环境，可再收敛为环境变量。
 * - 构建产物仍交由 API 托管，避免前后端部署方式分叉。
 */
