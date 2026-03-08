# 项目成员与邀请模块设计

## 总体方案

第一版采用“最小用户上下文 + 文件化仓储”的实现：

- 前端通过 `localStorage` 维护本地演示用户会话
- API 从请求头或查询参数解析当前用户
- `packages/runtime-store` 持久化用户、成员和邀请数据
- API、协作服务统一调用项目访问校验

## 核心对象

### 用户

- `id`
- `name`

### 项目成员

- `userId`
- `name`
- `role`
- `joinedAt`
- `invitedBy`

### 项目邀请

- `token`
- `projectId`
- `role`
- `createdBy`
- `createdAt`
- `expiresAt`
- `revokedAt`

## 模块边界

- `packages/runtime-store/src/users.js`
  - 维护最小用户档案
- `packages/runtime-store/src/projects.js`
  - 维护 owner/member 元数据和访问校验
- `packages/runtime-store/src/invitations.js`
  - 维护邀请链接生命周期
- `apps/api/src/server.js`
  - 解析当前用户并对所有项目入口做权限校验
- `apps/web/src/session.ts`
  - 维护本地演示用户会话

## 权限规则

### owner

- 创建项目
- 重命名/删除项目
- 创建/撤销邀请
- 查看成员列表
- 移除协作者

### collaborator

- 查看项目
- 编辑文件
- 编译
- 查看快照
- 使用 AI
- 加入文件级协作

## 后续演进

下一阶段优先考虑：

1. 存储层升级到数据库
2. 正式登录体系
3. 协作房间主键从 `filePath` 升级为 `fileId`
4. 评论与批注
