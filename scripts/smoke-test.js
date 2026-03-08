/*
 * File: smoke-test.js
 * Module: scripts (MVP 烟雾测试)
 *
 * Responsibility:
 *   - 在本地开发阶段快速验证项目、编译、快照与 AI 助手兜底链路。
 *   - 为人工调试前提供一个最小的命令行自检入口。
 *
 * Runtime Logic Overview:
 *   1. 脚本直接调用仓储、快照、Worker 与 AI 服务创建项目、读写文件、触发编译与恢复。
 *   2. 若主链路可走通，则输出通过信息；若流程中断，则抛出失败原因。
 *   3. 当前环境已安装 `pdflatex`，因此脚本会验证真实编译成功与快照恢复链路。
 *
 * Dependencies:
 *   - packages/runtime-store
  *   - workers/compiler
  *   - packages/runtime-store/snapshots
  *   - packages/ai-assistant
 *
 * Last Updated:
 *   - 2026-03-08 by Codex - 扩展烟雾测试以覆盖项目级编译设置和任务快照
 */

import {
  generateExplainReply,
  generateFixReply,
  generateImproveReply,
  generateInlineCompletion,
  generateDiagnosisResult,
  streamAssistantReply,
} from "../packages/ai-assistant/src/service.js";
import {
  appendAIConversationExchange,
  clearAIConversation,
  ensureAIConversationStorage,
  getAIConversation,
} from "../packages/runtime-store/src/ai-conversations.js";
import { getCompileJob, createCompileJob } from "../packages/runtime-store/src/jobs.js";
import {
  createProjectInvitation,
  ensureInvitationStorage,
  getInvitation,
} from "../packages/runtime-store/src/invitations.js";
import {
  createProjectComment,
  ensureCommentStorage,
  listProjectComments,
  replyProjectComment,
  resolveProjectComment,
} from "../packages/runtime-store/src/comments.js";
import {
  addProjectMember,
  createProject,
  createProjectFile,
  ensureProjectStorage,
  getProjectTree,
  getProjectCompileSettings,
  listProjectsForUser,
  readProjectFile,
  requireProjectAccess,
  resolveProjectEntryById,
  updateProjectCompileSettings,
  updateProjectFile,
} from "../packages/runtime-store/src/projects.js";
import {
  ensureSnapshotStorage,
  listSnapshots,
  restoreSnapshot,
  runAutoCheckpointCycle,
} from "../packages/runtime-store/src/snapshots.js";
import {
  ensureUserProfile,
  ensureUserStorage,
} from "../packages/runtime-store/src/users.js";
import { getProjectRoot } from "../packages/shared/src/paths.js";
import { processPendingJob } from "../workers/compiler/src/worker.js";

await ensureProjectStorage();
await ensureSnapshotStorage();
await ensureInvitationStorage();
await ensureUserStorage();
await ensureAIConversationStorage();
await ensureCommentStorage();

const ownerUser = await ensureUserProfile({ id: "smoke-owner", name: "Smoke Owner" });
const collaboratorUser = await ensureUserProfile({ id: "smoke-collaborator", name: "Smoke Collaborator" });
const project = await createProject("Smoke Test Project", ownerUser);
const invitation = await createProjectInvitation(project.id, {
  createdBy: ownerUser.id,
  createdByName: ownerUser.name,
});
const storedInvitation = await getInvitation(invitation.token);

if (!storedInvitation || storedInvitation.projectId !== project.id) {
  throw new Error("项目邀请未正确写入仓储");
}

await addProjectMember(project.id, {
  userId: collaboratorUser.id,
  name: collaboratorUser.name,
  role: "editor",
  invitedBy: ownerUser.id,
});

const collaboratorProjects = await listProjectsForUser(collaboratorUser);
if (!collaboratorProjects.some((item) => item.id === project.id)) {
  throw new Error("协作者无法看到已加入的项目");
}

await requireProjectAccess(project.id, collaboratorUser);

await createProjectFile(project.id, "notes.tex", "\\section{Smoke Test}\n");
await createProjectFile(
  project.id,
  "manuscript.tex",
  [
    "\\documentclass{article}",
    "",
    "\\title{Smoke Test Manuscript}",
    "\\begin{document}",
    "\\maketitle",
    "Custom root file content.",
    "\\end{document}",
    "",
  ].join("\n"),
);
await updateProjectFile(
  project.id,
  "notes.tex",
  "\\section{Smoke Test}\nThis file was created by the smoke test.\n",
);
await updateProjectCompileSettings(project.id, {
  rootFile: "manuscript.tex",
  compileEngine: "pdflatex",
});

const compileSettings = await getProjectCompileSettings(project.id);

if (compileSettings.rootFile !== "manuscript.tex" || compileSettings.compileEngine !== "pdflatex") {
  throw new Error("项目编译设置未正确更新");
}

const filePayload = await readProjectFile(project.id, "notes.tex");
if (!filePayload.content.includes("Smoke Test")) {
  throw new Error("文件读取结果不符合预期");
}

const treePayload = await getProjectTree(project.id);
if (!treePayload.some((entry) => entry.path === "notes.tex")) {
  throw new Error("文件树未返回新建文件");
}

const notesEntry = await resolveProjectEntryById(
  project.id,
  treePayload.find((entry) => entry.path === "notes.tex")?.id ?? "",
);

if (!notesEntry?.id) {
  throw new Error("notes.tex 未分配稳定 fileId");
}

const comment = await createProjectComment(project.id, {
  fileId: notesEntry.id,
  filePath: notesEntry.path,
  excerpt: "\\section{Smoke Test}",
  selectionText: "\\section{Smoke Test}",
  lineStart: 1,
  lineEnd: 1,
  columnStart: 1,
  columnEnd: 20,
  content: "这里需要再补一段说明。",
  authorUserId: ownerUser.id,
  authorName: ownerUser.name,
});

await replyProjectComment(project.id, comment.id, {
  authorUserId: collaboratorUser.id,
  authorName: collaboratorUser.name,
  content: "收到，我来补。",
});
await resolveProjectComment(project.id, comment.id, ownerUser.id);
const comments = await listProjectComments(project.id, { fileId: notesEntry.id });

if (comments.length !== 1 || comments[0].replies.length !== 1 || !comments[0].resolvedAt) {
  throw new Error("评论批注链路未正确持久化");
}

const compileJob = await createCompileJob(project.id, compileSettings);
await processPendingJob();
const finishedJob = await getCompileJob(compileJob.id);

if (!finishedJob || finishedJob.status !== "succeeded") {
  throw new Error("编译任务未进入终态");
}

if (finishedJob.rootFile !== "manuscript.tex" || finishedJob.compileEngine !== "pdflatex") {
  throw new Error("编译任务未记录项目编译设置快照");
}

const cachedCompileJob = await createCompileJob(project.id, compileSettings);
await processPendingJob();
const cachedFinishedJob = await getCompileJob(cachedCompileJob.id);

if (!cachedFinishedJob || cachedFinishedJob.status !== "succeeded" || !cachedFinishedJob.log.includes("Execution Mode: cache")) {
  throw new Error("编译缓存未命中或未正确回写缓存日志");
}

const snapshotsAfterCompile = await listSnapshots(project.id);
const compileSnapshot = snapshotsAfterCompile.find((snapshot) => snapshot.type === "compile_success");

if (!compileSnapshot) {
  throw new Error("编译成功后未创建里程碑快照");
}

await updateProjectFile(
  project.id,
  "notes.tex",
  "\\section{Changed}\nThis file was changed after compile.\n",
);
await runAutoCheckpointCycle({ thresholdMs: 0 });

const snapshotsAfterCheckpoint = await listSnapshots(project.id);
if (!snapshotsAfterCheckpoint.some((snapshot) => snapshot.type === "auto_checkpoint")) {
  throw new Error("编辑后未创建自动检查点快照");
}

const restoreResult = await restoreSnapshot(project.id, compileSnapshot.id);
if (!restoreResult.success || !restoreResult.guardSnapshotId) {
  throw new Error("快照恢复结果不完整");
}

const restoredFile = await readProjectFile(project.id, "notes.tex");
if (!restoredFile.content.includes("This file was created by the smoke test.")) {
  throw new Error("恢复后的文件内容不符合编译成功快照预期");
}

const assistantStreamChunks = [];
const assistantReply = await streamAssistantReply({
  message: "请解释一下当前文件的结构",
  projectId: project.id,
  projectRoot: getProjectRoot(project.id),
  currentFilePath: "notes.tex",
  currentFileContent: restoredFile.content,
  selectedText: "\\section{Smoke Test}",
  recentCompileLog: finishedJob.log,
  history: [],
}, {
  onDelta(chunk) {
    assistantStreamChunks.push(chunk);
  },
});

if (!assistantReply.answer || assistantReply.answer.length < 12) {
  throw new Error("AI 助手未返回有效回答");
}

if (!assistantStreamChunks.join("").trim() && !assistantReply.answer.trim()) {
  throw new Error("AI 主聊天流式回复为空");
}

await appendAIConversationExchange(
  project.id,
  ownerUser.id,
  { role: "user", content: "请解释一下当前文件结构" },
  { role: "assistant", content: assistantReply.answer },
);
const storedConversation = await getAIConversation(project.id, ownerUser.id);

if (storedConversation.messages.length < 2) {
  throw new Error("AI 对话历史未正确持久化");
}

const streamedChunks = [];
const streamedReply = await streamAssistantReply(
  {
    message: "请结合最近编译日志告诉我哪里有问题",
    currentFilePath: "notes.tex",
    currentFileContent: restoredFile.content,
    selectedText: "",
    recentCompileLog: finishedJob.log,
    history: [],
  },
  {
    onDelta(chunk) {
      streamedChunks.push(chunk);
    },
  },
);

if (!streamedChunks.join("").trim() || !streamedReply.answer.trim()) {
  throw new Error("AI 流式回复未返回有效内容");
}

const diagnosis = await generateDiagnosisResult({
  message: "请分析最近一次 LaTeX 编译错误",
  currentFilePath: "notes.tex",
  currentFileContent: restoredFile.content,
  selectedText: "",
  recentCompileLog: "Undefined control sequence.\\nl.12 \\\\mycommand",
  history: [],
});

if (!diagnosis.errorType || diagnosis.suggestedFixes.length === 0) {
  throw new Error("AI 诊断结果不完整");
}

const explainReply = await generateExplainReply({
  message: "请解释当前代码",
  currentFilePath: "notes.tex",
  currentFileContent: restoredFile.content,
  selectedText: "\\section{Smoke Test}",
  recentCompileLog: finishedJob.log,
  history: storedConversation.messages,
});

if (!explainReply.answer.trim()) {
  throw new Error("AI 解释结果为空");
}

const improveReply = await generateImproveReply({
  message: "请优化当前代码",
  currentFilePath: "notes.tex",
  currentFileContent: restoredFile.content,
  selectedText: "\\section{Smoke Test}\nThis file was created by the smoke test.\n",
  recentCompileLog: finishedJob.log,
  history: storedConversation.messages,
});

if (!improveReply.answer.trim()) {
  throw new Error("AI 优化结果为空");
}

const fixReply = await generateFixReply({
  message: "请生成修复代码",
  projectId: project.id,
  projectRoot: getProjectRoot(project.id),
  currentFilePath: "notes.tex",
  currentFileContent: restoredFile.content,
  selectedText: "\\mycommand{test}",
  recentCompileLog: "Undefined control sequence.\\nl.12 \\\\mycommand",
  history: storedConversation.messages,
});

if (!fixReply.answer.trim()) {
  throw new Error("AI 修复代码结果为空");
}

const completionResult = await generateInlineCompletion({
  message: "请补全当前 LaTeX 代码",
  projectId: project.id,
  projectRoot: getProjectRoot(project.id),
  currentFilePath: "notes.tex",
  currentFileContent: restoredFile.content,
  selectedText: "",
  recentCompileLog: finishedJob.log,
  history: storedConversation.messages,
  prefix: "\\section{",
  suffix: "\nThis file was created by the smoke test.\n",
});

if (typeof completionResult.completion !== "string") {
  throw new Error("AI inline completion 结果类型异常");
}

await clearAIConversation(project.id, ownerUser.id);
const clearedConversation = await getAIConversation(project.id, ownerUser.id);

if (clearedConversation.messages.length !== 0) {
  throw new Error("AI 对话清空失败");
}

console.log("Smoke test passed.");
console.log(`Project ID: ${project.id}`);
console.log(`Compile Job ID: ${compileJob.id}`);
console.log(`Compile Status: ${finishedJob.status}`);
console.log(`Compile Root File: ${finishedJob.rootFile}`);
console.log(`Compile Engine: ${finishedJob.compileEngine}`);
console.log(`Compile Snapshot ID: ${compileSnapshot.id}`);
console.log(`Restore Guard Snapshot ID: ${restoreResult.guardSnapshotId}`);
console.log(`Invite Token: ${invitation.token}`);
console.log(`AI Reply Source: ${assistantReply.source}`);
console.log(`AI Stream Source: ${streamedReply.source}`);
console.log(`AI Diagnosis Type: ${diagnosis.errorType}`);
console.log(`AI Explain Source: ${explainReply.source}`);
console.log(`AI Improve Source: ${improveReply.source}`);
console.log(`AI Fix Source: ${fixReply.source}`);
console.log(`AI Inline Completion Source: ${completionResult.source}`);

/*
 * Code Review:
 * - 该脚本只验证主链路最关键的仓储、成员与 Worker 协作是否正常，不试图覆盖完整功能面。
 * - 当前环境已安装 `pdflatex`，因此这里直接要求真实编译成功，以便尽早暴露环境回退问题。
 * - 若后续引入自动化测试框架，可把这里迁移为集成测试用例。
 */
