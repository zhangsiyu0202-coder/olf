# AI 模块设计文档

## 1. 系统架构设计

### 1.1 整体架构

`

                     前端 (Editor Frontend)                   
            
   Completion      Chat Panel      Error Panel        
   (补全)          (问答)          (诊断)             
            

                             HTTP/WebSocket

                   API Gateway (Express)                      
   /api/projects/:projectId/ai/completion                 
   /api/projects/:projectId/ai/chat                        
   /api/projects/:projectId/ai/chat/stream (HTTP NDJSON)   
   /api/ai/assistant/*                                     

                            

                    AI Service Layer                          
    
   Context Engineer (上下文工程)                           
    cased-kit (代码分析)                                
    semchunk (语义分块)                                 
    LLMLingua (Prompt 压缩)                             
    
                                                             
    
   Completion Engine (补全引擎)                           
   Chat Engine (问答引擎)                                 
   Assistant (助手)                                       
    
                                                             
    
   Provider Layer (单一 OpenAI 兼容提供商)                
    OpenAI-Compatible Provider                          
    

                            

                  Infrastructure Layer                        
            
   Redis Cache     PostgreSQL      External API       
   (会话/缓存)     (元数据)        (OpenAI等)         
            

`

### 1.2 分层架构

**表现层 (Presentation Layer)**
- CodeMirror 6 集成
- Inline Completion UI
- Chat Panel UI
- Error Diagnostics UI

**应用层 (Application Layer)**
- API Gateway (Express)
- 请求路由和验证
- 速率限制和认证

**业务逻辑层 (Business Logic Layer)**
- CompletionEngine: 代码补全
- ChatEngine: 实时问答
- LatexAssistant: LaTeX 专家
- ContextEngineer: 上下文工程

**数据访问层 (Data Access Layer)**
- ConversationManager: 对话管理
- CacheManager: 缓存管理
- RepositoryAnalyzer: 代码分析

**基础设施层 (Infrastructure Layer)**
- Redis: 缓存和会话
- PostgreSQL: 持久化存储
- External APIs: AI 提供商

## 2. 模块设计

### 2.1 Context Engineer (上下文工程模块)

**职责**: 构建和优化发送给 AI 的上下文

**核心组件**:
`	ypescript
class ContextEngineer {
  // 使用 cased-kit 分析代码
  private repo: Repository;
  
  // 使用 semchunk 进行语义分块
  private chunker: Chunker;
  
  // 使用 LLMLingua 压缩 prompt
  private compressor: PromptCompressor;
  
  // 构建优化的上下文
  async buildContext(request: ContextRequest): Promise<EnrichedContext>;
  
  // 提取相关代码
  private extractRelevantCode(request): Promise<CodeContext>;
  
  // 分析文档结构
  private analyzeDocumentStructure(request): Promise<DocumentStructure>;
  
  // 优化上下文以适应 token 限制
  private optimizeContext(context): EnrichedContext;
}
`

**数据流**:
1. 接收用户请求 + 当前编辑上下文
2. 使用 cased-kit 提取项目文件树和相关结构信号
3. 使用 semchunk 进行语义分块
4. 选择最相关的代码块
5. 按需使用 LLMLingua 压缩 prompt；默认保持可选，不阻塞主链路
6. 返回优化后的上下文

### 2.2 Completion Engine (补全引擎)

**职责**: 处理代码补全请求

**核心接口**:
`	ypescript
interface ICompletionProvider {
  complete(context: string, options?: CompletionOptions): Promise<string>;
  streamComplete(context: string): AsyncGenerator<string>;
  getModelName(): string;
}

class CompletionEngine {
  private provider: ICompletionProvider;
  private cache: CompletionCache;
  
  async complete(request: CompletionRequest): Promise<CompletionResponse>;
  async *streamComplete(request: CompletionRequest): AsyncGenerator<StreamChunk>;
}
`

**流程**:
1. 接收补全请求（前缀 + 后缀）
2. 检查缓存
3. 构建上下文（使用 ContextEngineer）
4. 调用 AI 提供商
5. 缓存结果
6. 返回补全建议

### 2.3 Chat Engine (问答引擎)

**职责**: 处理多轮对话

**核心组件**:
`	ypescript
class ChatEngine {
  private provider: IChatProvider;
  private conversationManager: ConversationManager;
  private contextEngineer: ContextEngineer;
  
  async chat(request: ChatRequest): Promise<ChatResponse>;
  async *streamChat(request: ChatRequest): AsyncGenerator<StreamChatChunk>;
}

class ConversationManager {
  async getHistory(conversationId: string): Promise<ChatMessage[]>;
  async addMessage(conversationId: string, message: ChatMessage): Promise<void>;
  async clearHistory(conversationId: string): Promise<void>;
}
`

**特性**:
- 多轮对话支持
- 对话历史管理（Redis）
- 自动上下文压缩
- 流式响应

### 2.4 LaTeX Assistant (LaTeX 专家)

**职责**: 提供 LaTeX 特定的辅助功能

**功能**:
`	ypescript
class LatexAssistant {
  // 错误诊断
  async diagnoseError(error: CompilationError, context: LatexContext): Promise<string>;
  
  // 代码解释
  async explainCode(code: string, context: LatexContext): Promise<string>;
  
  // 优化建议
  async suggestImprovements(code: string, context: LatexContext): Promise<string>;
  
  // 生成模板
  async generateTemplate(description: string): Promise<string>;
}
`

### 2.5 Provider Layer (AI 提供商层)

**设计原则**: 单一 OpenAI 兼容 Provider，避免当前阶段为多供应商抽象过度设计

**当前支持的提供商**:
- 单一 OpenAI 兼容 Provider（例如 DeepSeek）

**接口**:
`	ypescript
interface IChatProvider {
  chat(messages: ChatMessage[]): Promise<ChatMessage>;
  streamChat(messages: ChatMessage[]): AsyncGenerator<string>;
  getModelName(): string;
}

interface ICompletionProvider {
  complete(context: string): Promise<string>;
  streamComplete(context: string): AsyncGenerator<string>;
  getModelName(): string;
}
`

## 3. API 设计

### 3.1 REST API

#### 代码补全
`
POST /api/projects/:projectId/ai/completion
Content-Type: application/json

{
  "prefix": "\\begin{document}\n\\section{",
  "suffix": "\n\\end{document}",
  "language": "latex",
  "maxTokens": 50,
  "userId": "user123"
}

Response:
{
  "completion": "Introduction}",
  "confidence": 0.92,
  "model": "gpt-4",
  "latency": 245
}
`

#### 错误诊断
`
POST /api/ai/assistant/diagnose
Content-Type: application/json

{
  "error": {
    "line": 42,
    "message": "Undefined control sequence \\mycommand",
    "file": "main.tex"
  },
  "context": {
    "documentClass": "article",
    "packages": ["amsmath"],
    "errorCode": "\\mycommand{test}"
  },
  "userId": "user123"
}

Response:
{
  "diagnosis": "The command \\mycommand is not defined...",
  "errorType": "UNDEFINED_COMMAND",
  "suggestedFixes": [
    "Define \\mycommand using \\newcommand",
    "Check if you need to load a package",
    "Verify the command spelling"
  ]
}
`

### 3.2 WebSocket API

#### 流式问答
`
POST /api/projects/:projectId/ai/chat/stream
Content-Type: application/json

Send:
{
  "type": "chat",
  "conversationId": "conv_123",
  "message": "Explain this code",
  "context": {...}
}

Receive (streaming NDJSON):
{
  "type": "chunk",
  "conversationId": "conv_123",
  "delta": "To create",
  "done": false
}

{
  "type": "chunk",
  "conversationId": "conv_123",
  "delta": " a table",
  "done": false
}

{
  "type": "done",
  "conversationId": "conv_123",
  "metadata": {
    "suggestions": [...]
  }
}
`

## 4. 数据库设计

### 4.1 Redis Schema

**对话历史**:
`
Key: conversation:{conversationId}
Type: String (JSON)
TTL: 24 hours

Value: {
  "messages": [
    {"role": "user", "content": "...", "timestamp": 1704067200000},
    {"role": "assistant", "content": "...", "timestamp": 1704067201000}
  ]
}
`

**补全缓存**:
`
Key: completion:{hash(prefix)}
Type: String (JSON)
TTL: 7 days

Value: {
  "completion": "...",
  "confidence": 0.92,
  "model": "gpt-4"
}
`

**用户会话**:
`
Key: session:{userId}
Type: Hash

Fields:
- lastActivity: timestamp
- model: "gpt-4"
- tokenUsage: number
`

### 4.2 PostgreSQL Schema

**conversations 表**:
`sql
CREATE TABLE conversations (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  title VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
`

**messages 表**:
`sql
CREATE TABLE messages (
  id UUID PRIMARY KEY,
  conversation_id UUID NOT NULL,
  role VARCHAR(20),
  content TEXT,
  tokens_used INT,
  created_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);
`

**ai_usage 表**:
`sql
CREATE TABLE ai_usage (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  feature VARCHAR(50),
  tokens_used INT,
  cost DECIMAL(10, 4),
  created_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
`

## 5. 技术选型说明

### 5.1 cased-kit (代码分析)

**为什么选择**:
- 专为 AI 开发工具设计
- 快速符号提取（AST 解析）
- 支持多语言（包括 LaTeX）
- MIT 协议，可商用

**使用场景**:
- 提取文档中的章节、环境、命令
- 分析代码依赖关系
- 快速代码搜索

### 5.2 semchunk (语义分块)

**为什么选择**:
- 比竞品快 85%
- 保持语义完整性
- 支持自定义 tokenizer
- MIT 协议，可商用

**使用场景**:
- 将长 LaTeX 文档分块
- 确保每个块都是语义完整的
- 优化上下文长度

### 5.3 LLMLingua (Prompt 压缩)

**为什么选择**:
- 最高 20x 压缩率
- 保留关键信息
- 降低成本 80%+
- MIT 协议，可商用

**使用场景**:
- 压缩长上下文
- 降低 token 使用量
- 加速推理速度

## 6. 部署架构

### 6.1 Docker 容器化

`dockerfile
# Dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

EXPOSE 3001

CMD ["node", "dist/index.js"]
`

### 6.2 Docker Compose

`yaml
version: '3.8'

services:
  ai-service:
    build: ./packages/ai-service
    ports:
      - "3001:3001"
    environment:
      - AI_PROVIDER=openai
      - AI_API_KEY=
      - REDIS_HOST=redis
      - DB_HOST=postgres
    depends_on:
      - redis
      - postgres
    networks:
      - app-network

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    networks:
      - app-network

  postgres:
    image: postgres:15-alpine
    environment:
      - POSTGRES_DB=ai_service
      - POSTGRES_PASSWORD=
    ports:
      - "5432:5432"
    networks:
      - app-network

networks:
  app-network:
    driver: bridge
`

### 6.3 Kubernetes 部署

`yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ai-service
spec:
  replicas: 3
  selector:
    matchLabels:
      app: ai-service
  template:
    metadata:
      labels:
        app: ai-service
    spec:
      containers:
      - name: ai-service
        image: ai-service:latest
        ports:
        - containerPort: 3001
        env:
        - name: AI_PROVIDER
          value: "openai"
        - name: REDIS_HOST
          value: "redis-service"
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "1Gi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /health
            port: 3001
          initialDelaySeconds: 30
          periodSeconds: 10
`

## 7. 安全设计

### 7.1 认证和授权

- JWT Token 认证
- API Key 管理
- 用户隔离

### 7.2 数据安全

- HTTPS/WSS 加密传输
- 敏感信息过滤（API Key、密码）
- 用户代码不永久存储

### 7.3 速率限制

- 每用户每分钟最多 30 次请求
- 每用户每天最多 1000 次请求
- IP 级别的 DDoS 防护

## 8. 性能优化

### 8.1 缓存策略

- 补全结果缓存（7 天）
- 对话历史缓存（24 小时）
- 代码分析结果缓存（1 小时）

### 8.2 异步处理

- 使用 Queue 处理耗时操作
- 后台任务处理（成本计算、日志）
- 流式响应减少延迟

### 8.3 上下文优化

- LLMLingua 压缩（10-20x）
- semchunk 分块（保持语义）
- 智能选择相关代码

## 9. 监控和告警

### 9.1 关键指标

- 响应时间 (P50, P95, P99)
- 错误率
- Token 使用量
- 成本

### 9.2 告警规则

- 响应时间 > 2s
- 错误率 > 1%
- 日成本 > 预算
- 服务不可用

## 10. 扩展性设计

### 10.1 支持新的 AI 提供商

只需实现 IChatProvider 和 ICompletionProvider 接口

### 10.2 支持新的功能

通过 LatexAssistant 添加新方法

### 10.3 支持新的上下文优化

通过 ContextEngineer 添加新的优化策略
