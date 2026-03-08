# 项目自动快照模块 - 设计文档

## 1. 设计目标

自动快照模块的第一版目标是：

1. 稳定地保留关键版本
2. 让用户可以整项目恢复
3. 不破坏现有编辑和编译主链路

这意味着第一版不追求复杂版本控制语义，而是追求“简单、可靠、可恢复”。

## 2. 推荐架构

```text
Web App
  |
  | REST
  v
API Server
  |
  +--> Snapshot Service
  |       |
  |       +--> Snapshot Repository (packages/runtime-store)
  |
  +--> Project Repository
  |
  +--> Compile Job API

Compile Worker
  |
  +--> Compile Success Hook
          |
          +--> Snapshot Service
```

说明：

- `Snapshot Service` 是业务层
- `Snapshot Repository` 是存储层
- 编译 Worker 只触发里程碑快照，不直接操作快照底层存储细节

## 3. 核心设计决策

### 3.1 为什么不是“每次保存都快照”

每次保存都快照会导致：

- 快照数量爆炸
- 存储成本不可控
- 真正有意义的版本被淹没

因此第一版只保留“成功编译里程碑 + 编辑检查点”。

### 3.2 为什么恢复前要先创建保护性快照

恢复本身是一种高风险覆盖操作。如果恢复目标选错，用户必须还能回退到恢复前状态，因此恢复前先创建一次 `manual_restore_guard` 或等价保护性快照。

### 3.3 为什么快照逻辑不直接写在 Worker 里

编译 Worker 的职责是编译，不是版本管理。Worker 只能发起“成功编译后创建快照”的业务请求，真正的快照装配、去重、清理和存储应由独立服务处理。

## 4. 数据模型

### 4.1 Snapshot Metadata

```json
{
  "id": "snapshot_xxx",
  "projectId": "project_xxx",
  "type": "compile_success",
  "createdAt": "2026-03-07T13:00:00.000Z",
  "triggerSource": "compile_worker",
  "sourceRef": "job_xxx",
  "contentHash": "sha256:...",
  "archivePath": "/snapshots/project_xxx/snapshot_xxx.tar.gz",
  "fileCount": 12,
  "sizeBytes": 35865,
  "label": "Compiled successfully",
  "restoredFromSnapshotId": null
}
```

### 4.2 快照类型

- `compile_success`
- `auto_checkpoint`
- `restore_guard`

### 4.3 元数据真相来源

第一版建议：

- 快照内容：压缩归档文件
- 快照索引：由 `packages/runtime-store` 统一维护

后续升级：

- 元数据迁移到 PostgreSQL
- 快照归档迁移到对象存储

## 5. 存储设计

### 5.1 第一版目录建议

```text
.runtime/
  snapshots/
    archives/
      <projectId>/
        <snapshotId>.tar.gz
    metadata/
      <projectId>.json
```

说明：

- 每个项目单独一个快照索引文件，降低全局清单冲突
- 每个快照一个归档文件，便于删除与恢复

### 5.2 去重策略

第一版不做块级去重，但应做“相邻快照内容一致则跳过”：

1. 创建快照前计算当前项目目录摘要
2. 对比最近一次快照的 `contentHash`
3. 若一致，则跳过创建

## 6. 创建流程

### 6.1 成功编译触发

1. Worker 完成编译并确认 PDF 生成成功
2. Worker 调用 `Snapshot Service.createSnapshot(projectId, type=compile_success, sourceRef=jobId)`
3. `Snapshot Service` 读取项目当前目录
4. 计算内容摘要
5. 若内容未变化，则直接返回“跳过”
6. 若内容有变化，则创建归档并写入元数据
7. 执行保留策略清理

### 6.2 编辑检查点触发

1. API 在项目写入后更新“脏状态”和最后编辑时间
2. 后台定时任务扫描可创建检查点的项目
3. 对满足阈值的项目调用 `Snapshot Service.createSnapshot(type=auto_checkpoint)`
4. 创建完成后清理脏状态或更新最新快照时间

## 7. 恢复流程

1. 用户选择目标快照
2. API 调用 `Snapshot Service.restoreSnapshot(projectId, snapshotId)`
3. 服务先创建 `restore_guard` 快照
4. 校验目标快照存在且可读取
5. 清理项目当前目录
6. 解压目标归档到项目目录
7. 更新项目 `updatedAt`
8. 返回恢复成功结果

## 8. API 建议

### 8.1 查询快照列表

```http
GET /api/projects/:projectId/snapshots
```

响应：

```json
{
  "snapshots": [
    {
      "id": "snapshot_001",
      "type": "compile_success",
      "createdAt": "2026-03-07T13:00:00.000Z",
      "label": "Compiled successfully",
      "sourceRef": "job_001"
    }
  ]
}
```

### 8.2 手动恢复快照

```http
POST /api/projects/:projectId/snapshots/:snapshotId/restore
```

响应：

```json
{
  "success": true,
  "restoredSnapshotId": "snapshot_001",
  "guardSnapshotId": "snapshot_099"
}
```

## 9. 实现拆分建议

### 9.1 `packages/runtime-store`

新增：

- `snapshots.js`
- 项目脏状态元数据
- 快照清单与归档路径管理

### 9.2 `packages/shared`

新增：

- 目录打包与解包工具
- 内容摘要计算工具

### 9.3 `apps/api`

新增：

- 快照列表接口
- 快照恢复接口
- 编辑脏状态更新逻辑

### 9.4 `workers/compiler`

新增：

- 成功编译后的快照触发钩子

## 10. 风险与缓解

### 10.1 快照创建过慢

缓解：

- 先后台化
- 先只在必要事件触发
- 先控制保留数量

### 10.2 恢复误操作

缓解：

- 恢复前强制保护性快照
- 恢复操作要求显式确认

### 10.3 存储快速膨胀

缓解：

- 内容哈希去重
- 优先清理旧的检查点快照
- 限制每项目保留数量
