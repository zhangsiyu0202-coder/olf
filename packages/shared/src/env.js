/*
 * File: env.js
 * Module: packages/shared (环境变量工具)
 *
 * Responsibility:
 *   - 在零依赖前提下从仓库根目录的 `.env` 读取环境变量。
 *   - 为 API 和 AI 模块提供统一的环境配置入口，避免各自重复解析配置文件。
 *
 * Runtime Logic Overview:
 *   1. 模块启动时按需读取 `.env` 文件。
 *   2. 只在目标环境变量尚未设置时回填，避免覆盖显式 shell 配置。
 *   3. 解析完成后供调用方直接读取 `process.env`。
 *
 * Key Data Flow:
 *   - 输入：仓库根目录 `.env` 文件中的 `KEY=VALUE` 文本。
 *   - 输出：写入后的 `process.env`。
 *
 * Future Extension:
 *   - 可继续支持 `.env.local` 或按环境拆分配置文件。
 *   - 若后续引入正式配置系统，应由本模块统一过渡。
 *
 * Dependencies:
 *   - node:fs
 *   - packages/shared/paths
 *
 * Last Updated:
 *   - 2026-03-07 by Codex - 初始化零依赖环境变量加载工具
 */

import fs from "node:fs";
import { repositoryRoot } from "./paths.js";

let envLoaded = false;

export function loadEnvFile() {
  if (envLoaded) {
    return;
  }

  envLoaded = true;
  const envPath = `${repositoryRoot}/.env`;

  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

/*
 * Code Review:
 * - 该实现只覆盖当前项目需要的基础 `.env` 解析，避免为简单场景引入额外依赖。
 * - 通过“不覆盖已存在环境变量”保证 shell 显式配置优先级更高。
 * - 若后续配置复杂度上升，应集中升级本模块，而不是各处手写解析逻辑。
 */
