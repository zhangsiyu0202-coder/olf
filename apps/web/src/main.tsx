/*
 * File: main.tsx
 * Module: apps/web (前端入口)
 *
 * Responsibility:
 *   - 挂载 React 应用并加载全局样式。
 *
 * Runtime Logic Overview:
 *   1. 浏览器加载入口 HTML。
 *   2. `main.tsx` 创建 React 根节点。
 *   3. `App.tsx` 接管整个工作台状态和交互。
 *
 * Dependencies:
 *   - react
 *   - react-dom
 *   - ./App
 *   - ./index.css
 *
 * Last Updated:
 *   - 2026-03-07 by Codex - 初始化 React 前端入口
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/*
 * Code Review:
 * - 入口层保持纯挂载职责，避免把业务状态提前堆在根文件里。
 * - 使用 `StrictMode` 便于尽早发现副作用问题，符合成品化阶段质量要求。
 * - 后续若加入路由，也应从这里继续扩展，而不是把路由逻辑塞进 HTML 入口。
 */
