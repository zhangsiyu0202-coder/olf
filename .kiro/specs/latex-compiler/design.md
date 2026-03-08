# LaTeX 编译服务模块 - 设计文档

## 1. 系统架构设计

### 1.1 整体架构

\\\

                    前端 / API 请求                       

                     
        
                                 
    
   服务器 1              服务器 2        
  (主节点)              (从节点)         
                                         
        
  API Gateway         API Gateway   
  (Express)           (Express)     
        
                                      
        
  Worker x2           Worker x2     
  (编译进程)          (编译进程)    
        
                                         
        
  Docker              Docker        
  (TexLive)           (TexLive)     
        
    
                                 
        
                     
        
           Redis 集群            
          (共享队列 + 缓存)      
                                 
          
          Redis Master        
          (服务器 1)          
          
          
          Redis Slave         
          (服务器 2)          
          
        
\\\

### 1.2 分层架构

**表现层 (Presentation Layer)**
- Express API Gateway
- REST API 端点
- WebSocket 端点

**应用层 (Application Layer)**
- 请求路由和验证
- 速率限制和认证
- 错误处理

**业务逻辑层 (Business Logic Layer)**
- CompileManager: 编译管理
- ErrorParser: 错误解析
- CacheManager: 缓存管理
- QueueManager: 队列管理

**数据访问层 (Data Access Layer)**
- Redis 客户端
- Docker 客户端
- 文件系统访问

**基础设施层 (Infrastructure Layer)**
- Redis (队列 + 缓存)
- Docker (编译隔离)
- TexLive (编译引擎)

## 2. 模块设计

### 2.1 Compile Manager (编译管理器)

**职责**: 管理编译任务的生命周期

\\\	ypescript
class CompileManager {
  // 提交编译任务
  async submitCompile(request: CompileRequest): Promise<string>;
  
  // 获取编译结果
  async getCompileResult(jobId: string): Promise<CompileResult>;
  
  // 取消编译任务
  async cancelCompile(jobId: string): Promise<void>;
  
  // 执行编译
  private async executeCompile(job: Job): Promise<CompileResult>;
}
\\\

**流程**:
1. 接收编译请求
2. 检查缓存
3. 如果缓存命中，返回缓存结果
4. 否则，添加任务到队列
5. Worker 从队列取任务
6. 在 Docker 容器中执行编译
7. 解析编译结果
8. 缓存结果
9. 返回结果

### 2.2 Error Parser (错误解析器)

**职责**: 解析 LaTeX 编译错误

\\\	ypescript
class ErrorParser {
  // 解析编译日志
  parseErrors(log: string): CompileError[];
  
  // 分类错误类型
  classifyError(error: string): ErrorType;
  
  // 提取错误位置
  extractErrorLocation(error: string): ErrorLocation;
}

enum ErrorType {
  UNDEFINED_COMMAND = "Undefined control sequence",
  MISSING_PACKAGE = "File not found",
  SYNTAX_ERROR = "Illegal character",
  MISSING_DELIMITER = "Missing delimiter",
  FONT_ERROR = "Font not found",
  UNKNOWN = "Unknown error"
}
\\\

### 2.3 Cache Manager (缓存管理器)

**职责**: 管理编译结果缓存

\\\	ypescript
class CacheManager {
  // 获取缓存
  async getCache(key: string): Promise<CompileResult | null>;
  
  // 设置缓存
  async setCache(key: string, result: CompileResult, ttl: number): Promise<void>;
  
  // 生成缓存 Key
  generateCacheKey(source: string, engine: string): string;
  
  // 清除缓存
  async clearCache(key: string): Promise<void>;
}
\\\

**缓存策略**:
- Key: hash(source + engine + format)
- TTL: 1 小时
- 存储: Redis
- 命中率目标: > 50%

### 2.4 Queue Manager (队列管理器)

**职责**: 管理编译任务队列

\\\	ypescript
class QueueManager {
  // 添加任务到队列
  async addJob(data: CompileData, options?: JobOptions): Promise<Job>;
  
  // 获取队列统计
  async getQueueStats(): Promise<QueueStats>;
  
  // 监听队列事件
  onJobCompleted(callback: (job: Job) => void): void;
  onJobFailed(callback: (job: Job, error: Error) => void): void;
}
\\\

**队列配置**:
- 重试次数: 3
- 重试延迟: 指数退避
- 优先级: 支持
- 持久化: 启用

### 2.5 Docker Manager (Docker 管理器)

**职责**: 管理 Docker 容器

\\\	ypescript
class DockerManager {
  // 创建编译容器
  async createContainer(config: ContainerConfig): Promise<Container>;
  
  // 执行编译
  async executeCompile(container: Container, source: string): Promise<string>;
  
  // 清理容器
  async cleanupContainer(container: Container): Promise<void>;
  
  // 获取容器日志
  async getContainerLogs(container: Container): Promise<string>;
}
\\\

**容器配置**:
- 镜像: texlive:latest
- 内存限制: 512MB
- CPU 限制: 1 核
- 超时: 30s
- 自动清理: 启用

## 3. API 设计

### 3.1 REST API

#### 提交编译任务
\\\
POST /api/compile
Content-Type: application/json

{
  "source": "\\\\documentclass{article}\\n\\\\begin{document}\\nHello\\n\\\\end{document}",
  "engine": "pdflatex",
  "format": "pdf",
  "timeout": 30
}

Response:
{
  "jobId": "job_123",
  "status": "queued"
}
\\\

#### 获取编译结果
\\\
GET /api/compile/:jobId

Response:
{
  "jobId": "job_123",
  "status": "completed",
  "pdf": "base64_encoded_pdf",
  "errors": [],
  "warnings": [],
  "compilationTime": 1234
}
\\\

#### 获取队列状态
\\\
GET /api/compile/queue/stats

Response:
{
  "waiting": 5,
  "active": 2,
  "completed": 100,
  "failed": 2
}
\\\

### 3.2 WebSocket API

#### 流式编译
\\\
WebSocket /api/compile/stream

Send:
{
  "type": "compile",
  "source": "...",
  "engine": "pdflatex"
}

Receive (streaming):
{
  "type": "status",
  "status": "compiling",
  "progress": 25
}

{
  "type": "log",
  "message": "Running pdflatex..."
}

{
  "type": "completed",
  "pdf": "base64_encoded_pdf",
  "compilationTime": 1234
}
\\\

## 4. 数据库设计

### 4.1 Redis Schema

**编译队列**:
\\\
Key: bull:compile:*
Type: Queue (Bull 管理)
\\\

**编译缓存**:
\\\
Key: compile:{hash}
Type: String (JSON)
TTL: 1 小时

Value: {
  "pdf": "base64_encoded_pdf",
  "errors": [],
  "compilationTime": 1234
}
\\\

**编译统计**:
\\\
Key: compile:stats:{date}
Type: Hash

Fields:
- total: 总编译数
- success: 成功数
- failed: 失败数
- avgTime: 平均编译时间
\\\

## 5. 部署架构

### 5.1 Docker Compose

\\\yaml
version: '3.8'

services:
  api-gateway-1:
    build: ./packages/latex-compiler
    ports:
      - "3001:3001"
    environment:
      - REDIS_HOST=redis-master
      - WORKER_COUNT=2
    depends_on:
      - redis-master
    networks:
      - compile-network

  api-gateway-2:
    build: ./packages/latex-compiler
    ports:
      - "3002:3001"
    environment:
      - REDIS_HOST=redis-master
      - WORKER_COUNT=2
    depends_on:
      - redis-master
    networks:
      - compile-network

  redis-master:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    command: redis-server --appendonly yes
    networks:
      - compile-network

  redis-slave:
    image: redis:7-alpine
    ports:
      - "6380:6379"
    command: redis-server --slaveof redis-master 6379
    depends_on:
      - redis-master
    networks:
      - compile-network

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
    depends_on:
      - api-gateway-1
      - api-gateway-2
    networks:
      - compile-network

networks:
  compile-network:
    driver: bridge
\\\

### 5.2 Nginx 配置

\\\
ginx
upstream compile_backend {
    least_conn;
    server api-gateway-1:3001 weight=1;
    server api-gateway-2:3001 weight=1;
    keepalive 32;
}

server {
    listen 80;
    server_name api.latex-editor.com;

    location /api/ {
        proxy_pass http://compile_backend;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host \System.Management.Automation.Internal.Host.InternalHost;
        proxy_set_header X-Real-IP \;
        proxy_set_header X-Forwarded-For \;
        
        proxy_connect_timeout 5s;
        proxy_send_timeout 30s;
        proxy_read_timeout 30s;
    }
}
\\\

## 6. 性能优化

### 6.1 缓存策略
- 编译结果缓存（1 小时）
- 编译日志缓存（24 小时）
- 包依赖缓存（永久）

### 6.2 增量编译
- 使用 latexmk 检测文件变化
- 只编译改变的部分
- 加速 5-10 倍

### 6.3 并发处理
- 4 个 Worker（2 台 x 2）
- Redis Queue 自动分发
- 支持动态扩展

## 7. 监控和告警

### 7.1 关键指标
- 编译成功率
- 平均编译时间
- 队列长度
- Worker 利用率
- 缓存命中率

### 7.2 告警规则
- 队列长度 > 100
- 编译失败率 > 5%
- 平均编译时间 > 10s
- 服务不可用

## 8. 安全设计

### 8.1 隔离性
- Docker 容器隔离
- 资源限制
- 进程限制

### 8.2 访问控制
- JWT 认证
- 用户隔离
- 速率限制

### 8.3 输入验证
- 源代码大小限制
- 编译选项验证
- 超时时间验证
