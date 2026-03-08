/*
 * File: archive.js
 * Module: packages/shared (快照归档工具)
 *
 * Responsibility:
 *   - 提供项目目录内容摘要、归档打包和归档解包能力。
 *   - 让快照系统能够在不引入第三方依赖的前提下稳定地创建与恢复项目快照。
 *
 * Runtime Logic Overview:
 *   1. 快照创建前先计算目录内容摘要，用于避免重复快照。
 *   2. 确认需要创建快照后，将项目目录打包为 `.tar.gz` 归档。
 *   3. 恢复快照时，从归档中解压回项目目录。
 *
 * Key Data Flow:
 *   - 输入：项目目录、目标归档路径。
 *   - 输出：内容哈希、文件数量、打包后的归档文件或解包后的目录内容。
 *
 * Future Extension:
 *   - 后续可替换为对象存储直写归档，或补充更细粒度的差异哈希逻辑。
 *   - 若切换容器化执行环境，可在此集中封装系统命令调用差异。
 *
 * Dependencies:
 *   - node:child_process
 *   - node:crypto
 *   - node:fs/promises
 *   - node:path
 *   - packages/shared/fs
 *
 * Last Updated:
 *   - 2026-03-07 by Codex - 初始化快照归档与目录摘要工具
 */

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir } from "./fs.js";

async function walkDirectory(rootDir, currentDir = rootDir, entries = []) {
  const directoryEntries = await fs.readdir(currentDir, { withFileTypes: true });

  for (const entry of directoryEntries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = path.join(currentDir, entry.name);
    const relativePath = path.relative(rootDir, absolutePath).replaceAll(path.sep, "/");

    if (entry.isDirectory()) {
      entries.push({ type: "directory", relativePath });
      await walkDirectory(rootDir, absolutePath, entries);
      continue;
    }

    entries.push({ type: "file", relativePath, absolutePath });
  }

  return entries;
}

function runCommand(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${command} exited with code ${code}: ${stderr || stdout}`.trim()));
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

export async function createDirectoryFingerprint(sourceDir) {
  const entries = await walkDirectory(sourceDir);
  const hash = crypto.createHash("sha256");
  let fileCount = 0;

  for (const entry of entries) {
    if (entry.type === "directory") {
      hash.update(`dir:${entry.relativePath}\n`);
      continue;
    }

    fileCount += 1;
    hash.update(`file:${entry.relativePath}\n`);
    hash.update(await fs.readFile(entry.absolutePath));
    hash.update("\n");
  }

  return {
    contentHash: `sha256:${hash.digest("hex")}`,
    fileCount,
  };
}

export async function createTarGzArchive(sourceDir, archivePath) {
  await ensureDir(path.dirname(archivePath));
  await runCommand("tar", ["-czf", archivePath, "-C", sourceDir, "."], {
    cwd: sourceDir,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export async function extractTarGzArchive(archivePath, targetDir) {
  await ensureDir(targetDir);
  await runCommand("tar", ["-xzf", archivePath, "-C", targetDir], {
    cwd: targetDir,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/*
 * Code Review:
 * - 目录摘要显式把目录项和文件项都纳入哈希，避免空目录变化被忽略。
 * - 归档与解包依赖系统 `tar`，这在当前 Ubuntu 环境中最简单稳定；若未来跨平台，应在此统一兼容。
 * - 当前实现优先保证正确性，未针对超大项目做流式哈希优化，符合现阶段范围。
 */
