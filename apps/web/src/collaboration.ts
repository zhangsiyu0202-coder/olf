/*
 * File: collaboration.ts
 * Module: apps/web (协作工具)
 *
 * Responsibility:
 *   - 为前端提供协作房间名、连接地址和本地用户身份生成能力。
 *   - 避免 `App` 和编辑器组件各自拼接协作参数，造成协议规则分叉。
 *
 * Runtime Logic Overview:
 *   1. 打开文件时根据 `projectId + fileId` 生成稳定房间名。
 *   2. 由前端会话模块提供当前用户参数，透传到协作连接。
 *   3. CodeMirror 协作绑定读取这里的结果连接服务端房间。
 *
 * Dependencies:
 *   - 浏览器原生 `btoa`
 *
 * Last Updated:
 *   - 2026-03-08 by Codex - 将协作房间主键切换为稳定 fileId
 */

export function createCollaborationRoomName(projectId: string, fileId: string) {
  return `${projectId}::${fileId}`;
}

export function getCollaborationServerUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/collaboration`;
}

/*
 * Code Review:
 * - 房间名现在使用 `projectId + fileId`，文件移动和重命名后协作状态仍能稳定映射回同一文档。
 * - 协作服务地址与房间名集中在这里，避免页面层和编辑器层各自拼接不同协议。
 * - 该文件保持极薄，避免把会话或权限逻辑掺进前端协作协议层。
 */
