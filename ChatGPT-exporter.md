# exporter

**User:** Anonymous (jiachangkun02@gmail.com)  
**Created:**   
**Updated:**   
**Exported:** 3/8/2026 13:09:20  
**Link:** [https://chatgpt.com/c/WEB:bb01c6a1-9e8f-4478-a308-2ce7fd806370](https://chatgpt.com/c/WEB:bb01c6a1-9e8f-4478-a308-2ce7fd806370)  

## Prompt:
那就不填  同时给两个平台的langchain的接口的详细调用方法  和之前的arxiv一样

## Response:
我按你“**不填 key**”这个前提来写，主线就放 **Semantic Scholar + PubMed**。Google Scholar 我先不放进主流程，因为 LangChain 那条官方集成确实要 `SERP_API_KEY`。

已思考 1m 26s

好。  
我这里按你的意思，直接给你 **两个“不填 key 也能用”的平台** 的 LangChain 详细调用指南：

1.  **Semantic Scholar**
2.  **PubMed**

我**不把 Google Scholar 放进主线**，因为 LangChain 官方那条集成明确要求配置 `SERP_API_KEY`。另外，LangChain 现在官方推荐的新 agent 入口是 `create_agent`；Semantic Scholar 在 LangChain 官方文档里主要是 **Tool** 集成，而 PubMed 则同时有 **Tool** 和 **Retriever** 两条线。[LangChain 文档+9LangChain 文档+9LangChain 文档+9](https://docs.langchain.com/oss/python/migrate/langchain-v1?utm_source=chatgpt.com)

* * *

一、先说结论：你现在最该怎么用
===============

Semantic Scholar
----------------

更适合做：

*   综合学术搜索
*   查论文元数据
*   查作者/论文关系
*   给 Agent 当搜索工具

在我这次核到的 LangChain 官方文档里，它的主入口是 **Tool**。Semantic Scholar 官方 API 说明则写明：**大多数 endpoint 可以不认证直接用**；如果用了 key，就放在 `x-api-key` header 里。[LangChain 文档+2Semantic Scholar+2](https://docs.langchain.com/oss/python/integrations/tools/semanticscholar)

PubMed
------

更适合做：

*   医学 / 生物 / 药学文献检索
*   作为 Tool 给 Agent 用
*   或直接当 Retriever 做 RAG

LangChain 官方 PubMed 页面明确写了：PubMed 收录 **3500 万+ citations**，并且 LangChain 同时提供了 **`PubmedQueryRun`** 和 **`PubMedRetriever`**。[LangChain 文档+1](https://docs.langchain.com/oss/python/integrations/tools/pubmed)

* * *

二、Semantic Scholar：LangChain 详细调用指南
===================================

* * *

1）它在 LangChain 里是什么形态
---------------------

LangChain 官方这条集成页的标题就是 **“Semantic scholar API integration”**，页面说明是“用 LangChain Python 集成 Semantic Scholar API tool”，并展示了 `SemanticScholarQueryRun()` 作为工具给 agent 使用。[LangChain 文档](https://docs.langchain.com/oss/python/integrations/tools/semanticscholar)

所以你可以把它理解成：

*   **主线接口**：Tool
*   **适合玩法**：直接查、给 agent 用
*   **不是当前官方主线**：Retriever / Loader（至少我这次查到的官方页没有像 PubMed 那样单独给这两页）[LangChain 文档+1](https://docs.langchain.com/oss/python/integrations/tools/semanticscholar)

* * *

2）安装
----

官方文档示例先安装 `semanticscholar` 包；实际做 LangChain 开发时，一般一起装：

```
pip install -U langchain langchain-community semanticscholar
```

LangChain 官方 Semantic Scholar 页里明确给了：

```
pip install -qU semanticscholar
```

这说明底层依赖就是这个 Python 包。[LangChain 文档](https://docs.langchain.com/oss/python/integrations/tools/semanticscholar)

* * *

3）最基础用法：直接把它当 Tool 用
--------------------

### 代码示例：单独调用 Tool

```
from langchain_community.tools.semanticscholar.tool import SemanticScholarQueryRun

tool = SemanticScholarQueryRun()

result = tool.invoke("biases in large language models")
print(result)
```

### 这个接口适合什么

适合：

*   快速查一个主题
*   看返回的论文标题、作者、摘要片段
*   不接 LLM 也能先跑通检索

LangChain 官方页展示的 agent 运行日志里，`semanticscholar` 工具被调用时，返回内容就包含：

*   Published year
*   Title
*   Authors
*   Abstract

所以这个 Tool 本质上就是一个“学术搜索结果摘要输出器”。[LangChain 文档](https://docs.langchain.com/oss/python/integrations/tools/semanticscholar)

* * *

4）详细案例 1：查某个主题下的代表论文
--------------------

```
from langchain_community.tools.semanticscholar.tool import SemanticScholarQueryRun

tool = SemanticScholarQueryRun()

query = "multimodal reasoning for vision-language models"
result = tool.invoke(query)

print("查询词:", query)
print(result)
```

### 场景

适合做：

*   “某方向最近有什么代表论文？”
*   “给我列几篇入门论文”
*   “某个技术路线有哪些典型文章？”

### 你会拿到什么

典型会是几篇论文的文本化结果，包含标题、作者、摘要摘要版。LangChain 官方示例输出就是这种风格。[LangChain 文档](https://docs.langchain.com/oss/python/integrations/tools/semanticscholar)

* * *

5）详细案例 2：接入 Agent，让模型自己决定什么时候查
------------------------------

LangChain 现在官方推荐 `create_agent` 作为 agent 入口。[LangChain 文档+1](https://docs.langchain.com/oss/python/langchain/agents?utm_source=chatgpt.com)

### 代码示例：Semantic Scholar + Agent

```
import os
from langchain.agents import create_agent
from langchain_openai import ChatOpenAI
from langchain_community.tools.semanticscholar.tool import SemanticScholarQueryRun

os.environ["OPENAI_API_KEY"] = "你的_openai_key"

tools = [SemanticScholarQueryRun()]

agent = create_agent(
    model=ChatOpenAI(model="gpt-4o-mini", temperature=0),
    tools=tools,
    system_prompt=(
        "You are a research assistant. "
        "Use the Semantic Scholar tool when the user asks about papers, authors, or research trends. "
        "Return paper titles, authors, year, and a concise Chinese summary."
    ),
)

result = agent.invoke({
    "messages": [
        {
            "role": "user",
            "content": "帮我找多模态推理的代表论文，并用中文总结趋势"
        }
    ]
})

print(result)
```

### 场景

适合：

*   聊天式论文助手
*   趋势总结
*   研究选题 brainstorming

### 为什么这写法更稳

因为 Tool 本来就是给 agent 调的，而 `create_agent` 是当前 LangChain 官方推荐的 agent 入口。[LangChain 文档+2LangChain 文档+2](https://docs.langchain.com/oss/python/integrations/tools?utm_source=chatgpt.com)

* * *

6）详细案例 3：不用 Agent，直接做“搜索 → 总结”两段式
---------------------------------

这比纯 agent 更可控。

```
import os
from langchain_openai import ChatOpenAI
from langchain_community.tools.semanticscholar.tool import SemanticScholarQueryRun

os.environ["OPENAI_API_KEY"] = "你的_openai_key"

tool = SemanticScholarQueryRun()
llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)

query = "tool-using agents for scientific discovery"
search_result = tool.invoke(query)

prompt = f"""
你是科研助理。下面是 Semantic Scholar 的检索结果。
请你：
1. 提取最值得看的 5 篇论文
2. 每篇给出一句推荐理由
3. 总结这个方向的共同主题与空白点

检索结果：
{search_result}
"""

resp = llm.invoke(prompt)
print(resp.content)
```

### 场景

适合：

*   你想保留中间检索结果
*   你想自己控制总结 prompt
*   你不希望 agent 自由发挥太多

* * *

7）不填 key 时，Semantic Scholar 会发生什么
---------------------------------

Semantic Scholar 官方说明：

*   **大多数 endpoint 可匿名访问**
*   未认证请求落在**共享限流池**
*   如果用了 key，则放在 `x-api-key` header
*   API key 初始额度是 **1 request/second**
*   匿名访问则是 **1000 requests/second shared among all unauthenticated users**。[Semantic Scholar+2Semantic Scholar+2](https://www.semanticscholar.org/product/api?utm_source=chatgpt.com)

所以你现在“不填”的工程含义是：

*   **能用**
*   但更适合低频、交互式查询
*   别把它当批量数据泵

* * *

8）Semantic Scholar 这条线的建议
-------------------------

### 最适合

*   主题搜索
*   论文发现
*   Agent 搜学术资料

### 不太适合

*   全文知识库主引擎
*   大规模批量拉取
*   你需要严格的 `Document` / retriever 管线时

因为在我这次核到的 LangChain 官方文档里，Semantic Scholar 主线是 Tool，不像 PubMed 那样官方同时给了 Retriever 页。[LangChain 文档+1](https://docs.langchain.com/oss/python/integrations/tools/semanticscholar)

* * *

三、PubMed：LangChain 详细调用指南
=========================

* * *

1）它在 LangChain 里是什么形态
---------------------

PubMed 在 LangChain 官方文档里比 Semantic Scholar 更完整：

*   **PubMed Tool**
*   **PubMed Retriever**

而且官方介绍非常明确：PubMed 收录 **3500 万+ biomedical citations**，包括 `MEDLINE`、生命科学期刊和在线图书，部分记录还会带到 PubMed Central 或出版社全文链接。[LangChain 文档+1](https://docs.langchain.com/oss/python/integrations/tools/pubmed)

所以这条线的定位是：

*   **医学 / 生物主库**
*   Tool 适合 agent
*   Retriever 适合 RAG

* * *

2）安装
----

官方 Tool 页里最简安装写的是 `xmltodict`。实际建议你一起装：

```
pip install -U langchain langchain-community xmltodict
```

LangChain 官方 PubMed Tool 页明确写了：

```
pip install xmltodict
```

所以这是它的关键依赖之一。[LangChain 文档](https://docs.langchain.com/oss/python/integrations/tools/pubmed)

* * *

3）最基础用法：PubMed Tool
-------------------

### 代码示例：单独调用 Tool

```
from langchain_community.tools.pubmed.tool import PubmedQueryRun

tool = PubmedQueryRun()

result = tool.invoke("What causes lung cancer?")
print(result)
```

这是 LangChain 官方页直接给的最小示例。返回内容会包含：

*   Published
*   Title
*   Copyright Information
*   Summary

而且通常会拼接多条结果。[LangChain 文档](https://docs.langchain.com/oss/python/integrations/tools/pubmed)

* * *

4）详细案例 1：查疾病机制
--------------

```
from langchain_community.tools.pubmed.tool import PubmedQueryRun

tool = PubmedQueryRun()

query = "mechanisms of Alzheimer's disease"
result = tool.invoke(query)

print("查询词:", query)
print(result)
```

### 场景

适合：

*   疾病机制搜索
*   药理方向入门查文献
*   医学选题初筛

### 为什么用 Tool

因为你想先快速拿到一坨可读文本结果，而不是一组 `Document` 对象。

* * *

5）详细案例 2：给 Agent 用，做医学问答助手
--------------------------

```
import os
from langchain.agents import create_agent
from langchain_openai import ChatOpenAI
from langchain_community.tools.pubmed.tool import PubmedQueryRun

os.environ["OPENAI_API_KEY"] = "你的_openai_key"

tools = [PubmedQueryRun()]

agent = create_agent(
    model=ChatOpenAI(model="gpt-4o-mini", temperature=0),
    tools=tools,
    system_prompt=(
        "You are a biomedical literature assistant. "
        "Use PubMed when the user asks medical or life-science questions. "
        "Cite the title and publication date when possible. "
        "If the evidence is weak, say so explicitly."
    ),
)

result = agent.invoke({
    "messages": [
        {
            "role": "user",
            "content": "帮我查一下乳腺癌免疫治疗最近的研究方向，并用中文概括"
        }
    ]
})

print(result)
```

### 场景

适合：

*   医学研究助理
*   临床科研文献助手
*   研究方向快速综述

### 为什么这比直接搜网页更靠谱

因为 PubMed 本身就是 NCBI/NLM 的生物医学文献检索入口，LangChain 这里是直接对 PubMed 做工具集成。[LangChain 文档+1](https://docs.langchain.com/oss/python/integrations/tools/pubmed)

* * *

6）最重要的一条：PubMed Retriever
-------------------------

这条线是 PubMed 真正的亮点。  
LangChain 官方专门有一页 **PubMed retriever**，并直接展示了 `PubMedRetriever()`。[LangChain 文档](https://docs.langchain.com/oss/python/integrations/retrievers/pubmed)

### 基础示例

```
from langchain_community.retrievers import PubMedRetriever

retriever = PubMedRetriever()

docs = retriever.invoke("chatgpt")

print(len(docs))
print(docs[0].metadata)
print(docs[0].page_content[:1000])
```

官方返回示例表明，`Document.metadata` 里会有类似：

*   `uid`
*   `Title`
*   `Published`
*   `Copyright Information`

`page_content` 则是摘要文本。[LangChain 文档](https://docs.langchain.com/oss/python/integrations/retrievers/pubmed)

* * *

7）详细案例 3：PubMed Retriever 做医学 RAG
---------------------------------

```
import os
from langchain_openai import ChatOpenAI
from langchain_community.retrievers import PubMedRetriever

os.environ["OPENAI_API_KEY"] = "你的_openai_key"

retriever = PubMedRetriever()
llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)

question = "What are recent clinical concerns about using ChatGPT in medical education?"

docs = retriever.invoke(question)

context = "\n\n".join(
    f"Title: {d.metadata.get('Title')}\nPublished: {d.metadata.get('Published')}\n\n{d.page_content[:2500]}"
    for d in docs[:5]
)

prompt = f"""
你是医学文献助理。请基于下面的 PubMed 检索结果回答问题。
要求：
1. 先给出结论
2. 再总结证据
3. 说明不确定性
4. 用中文回答

问题：
{question}

证据：
{context}
"""

resp = llm.invoke(prompt)
print(resp.content)
```

### 场景

适合：

*   医学问答
*   文献综述初稿
*   生物医药 RAG

### 为什么 Retriever 路线更稳

因为 Retriever 的职责本来就是：  
**给一个非结构化查询，返回 Documents。** PubMed 这条线非常适合这种玩法。[LangChain 文档+1](https://docs.langchain.com/oss/python/integrations/retrievers?utm_source=chatgpt.com)

* * *

8）详细案例 4：做“今日医学论文摘要卡片”
----------------------

```
from langchain_community.retrievers import PubMedRetriever

retriever = PubMedRetriever()

docs = retriever.invoke("breast cancer immunotherapy")

cards = []
for d in docs[:5]:
    cards.append({
        "uid": d.metadata.get("uid"),
        "title": d.metadata.get("Title"),
        "published": d.metadata.get("Published"),
        "summary_preview": d.page_content[:300],
    })

for c in cards:
    print(c)
```

### 场景

适合：

*   团队每周文献会
*   科研信息流
*   医学 newsletter

* * *

9）PubMed 不填 key 时，差别是什么
-----------------------

PubMed 背后的 NCBI E-Utilities 规则是：

*   **不带 API key：3 requests/second**
*   **带 API key：默认 10 requests/second**

NLM 官方支持页和 NCBI 官方说明都这么写。LangChain 的 PubMed 官方集成页本身并没有要求你先配 key，所以日常使用可以直接跑。[LangChain 文档+4NLM 支持中心+4NCBI Insights+4](https://support.nlm.nih.gov/kbArticle/?pn=KA-05317&utm_source=chatgpt.com)

所以你现在“不填”的现实含义是：

*   完全可以用
*   适合正常交互式查询
*   不要高并发猛打

* * *

四、两个平台怎么选
=========

你做综合学术搜索
--------

优先用 **Semantic Scholar**。  
它更像通用学术发现入口，适合“帮我找某方向论文”。Semantic Scholar 官方 API 也主打 paper / author data。[LangChain 文档+1](https://docs.langchain.com/oss/python/integrations/tools/semanticscholar)

你做医学 / 生物 / 药学
--------------

优先用 **PubMed**。  
因为 PubMed 就是医学文献主场，而且在 LangChain 里它还有 Retriever 这条更适合 RAG 的路线。[LangChain 文档+1](https://docs.langchain.com/oss/python/integrations/tools/pubmed)

* * *

五、最实用的组合建议
==========

方案 A：综合论文助手
-----------

*   `SemanticScholarQueryRun` 做发现
*   LLM 做总结

方案 B：医学论文助手
-----------

*   `PubmedQueryRun` 做快速查询
*   `PubMedRetriever` 做 RAG / QA

方案 C：双库组合
---------

先用 Semantic Scholar 找方向，再用 PubMed 深挖医学证据。  
这是比较像正常科研工作流的，不会把所有检索都压在一个库上。

* * *

六、你现在最该记住的接口名
=============

Semantic Scholar
----------------

*   `SemanticScholarQueryRun()`

PubMed
------

*   `PubmedQueryRun()`
*   `PubMedRetriever()`

这三个就是你现在在 **“不填 key”** 前提下，最值得直接上手的 LangChain 接口。[LangChain 文档+2LangChain 文档+2](https://docs.langchain.com/oss/python/integrations/tools/semanticscholar)

* * *

七、最短结论
======

按你现在的要求：

*   **不要额外填 key**
*   **像之前 arXiv 一样要详细调用方法**

那么最合适的两条线就是：

1.  **Semantic Scholar：主打 Tool**
2.  **PubMed：Tool + Retriever 双路线**

Google Scholar 我没放进主流程，因为 LangChain 官方那条集成明确要 `SERP_API_KEY`。[LangChain 文档+3LangChain 文档+3LangChain 文档+3](https://docs.langchain.com/oss/python/integrations/tools/semanticscholar?utm_source=chatgpt.com)

下一条我可以直接继续给你：

**“Semantic Scholar + PubMed + arXiv 三库统一接口层的 LangChain 实战代码”**  
也就是把三个源包装成一个研究助手。

## Prompt:
这两个平台不能像arxiv一样搜索/返回全文？

## Response:
我先把“平台本身能不能拿全文”和“LangChain 这层现成接口会不会给你全文”分开核实，不然很容易把摘要、链接和全文混成一锅。

已思考 1m 13s

不完全能。要把 **“平台本身能不能拿全文”** 和 **“LangChain 这层现成接口会不会直接把全文吐给你”** 分开看。

先给结论
----

### Semantic Scholar

**能搜索；通常返回的是元数据、摘要、引用关系之类，不是像 arXiv Loader 那样现成把全文稳定拉成文档。**  
Semantic Scholar 官方 API 的定位是提供 papers、authors、citations、venues 等学术数据；官方还特别提到它会提供 **PDF URLs、abstract、summarization** 等元数据。与此同时，它还有开放数据集入口，并列出了 **S2ORC**，描述为“面向 NLP 和 text mining 的通用 scientific papers corpus”。这说明它**有全文生态**，但不是说你用当前 LangChain 的 `SemanticScholarQueryRun` 就会像 `ArxivLoader` 一样直接得到论文全文文本。[Semantic Scholar+2Semantic Scholar+2](https://www.semanticscholar.org/product/api)

### PubMed

**能搜索；LangChain 里有 Tool、Retriever，甚至还有 `PubMedLoader`，但默认拿到的核心内容仍然更像摘要/记录，不是保证给你整篇论文全文。**  
LangChain 的 PubMed 文档写得很清楚：PubMed 是 **citations** 数据库，记录“可能包含”指向 **PubMed Central** 和出版社网站全文的链接。`PubMedLoader` 的官方示例里，`page_content` 展示出来的是论文摘要式内容，而不是整篇正文。[LangChain 文档+3LangChain 文档+3LangChain 文档+3](https://docs.langchain.com/oss/python/integrations/providers/pubmed)

### arXiv

**这点上更像“现成全文库”。**  
LangChain 的 `ArxivLoader` 官方示例直接展示了把 arXiv 论文 PDF 转成文本 `Document`，示例输出就是论文正文内容开头。也就是说，**在 LangChain 现成集成里，arXiv 的“搜到后直接变全文文本”体验，确实比前两个更顺。** [LangChain 文档](https://docs.langchain.com/oss/python/integrations/document_loaders/arxiv?utm_source=chatgpt.com)

* * *

1\. Semantic Scholar：能搜，但不是现成全文 Loader 路线
-----------------------------------------

LangChain 当前公开文档里，Semantic Scholar 这条主线是 **Tool integration**。官方示例 `SemanticScholarQueryRun()` 的输出内容是论文的 **Published year、Title、Authors、Abstract** 等文本化结果。也就是说，**现成 LangChain 接口默认更像“学术搜索工具”**，不是“全文加载器”。[LangChain 文档](https://docs.langchain.com/oss/python/integrations/tools/semanticscholar)

Semantic Scholar 官方 API 本身的定位也不是“全文下载 API”，而是学术图谱与论文数据 API：papers、authors、citations、recommendations、datasets。官方说明里专门提到它包含 **PDF URLs、abstract、summarization** 等附加元数据；这意味着你常常能拿到“全文入口”或开放 PDF 线索，但不是直接把整篇正文作为标准返回值给你。[Semantic Scholar+1](https://www.semanticscholar.org/product/api)

再往深一点，Semantic Scholar 官方资源页还列出了 **S2ORC**，它是“用于 NLP 和 text mining 的通用 scientific papers corpus”。这说明**平台层面有全文语料资源**，但它更偏数据集/语料库路线，不等于 LangChain 现成的 `SemanticScholarQueryRun` 已经帮你把全文拉下来并解析好了。[Semantic Scholar](https://www.semanticscholar.org/product/api)

所以一句话：

> **Semantic Scholar 能搜论文，也常能给你摘要和 PDF 线索；但在 LangChain 现成接口里，它不像 arXiv 那样有一条顺手的“搜完直接全文文本化”主线。** [LangChain 文档+1](https://docs.langchain.com/oss/python/integrations/tools/semanticscholar)

* * *

2\. PubMed：有 Loader，但默认更像“摘要/记录 Loader”，不是“普遍全文 Loader”
-------------------------------------------------------

PubMed 这边要比 Semantic Scholar 再微妙一点。

LangChain 的 PubMed provider 页面明确写了三件事：

*   PubMed 是一个 **3500 万+ citations** 的数据库
*   引文**可能包含**指向 **PubMed Central** 和出版社网站的全文链接
*   LangChain 这边同时列了 **Retriever** 和 **Document loader**，文档加载器就是 `PubMedLoader`。[LangChain 文档](https://docs.langchain.com/oss/python/integrations/providers/pubmed)

所以，和我前面给你的直觉版答案相比，这里要更精确一点：

> **PubMed 在 LangChain 里不只是 Tool / Retriever，确实还有 `PubMedLoader`。**

但别高兴太早，`PubMedLoader` 的官方示例也很诚实：  
`docs[1].page_content` 展示出来的是一段典型摘要结构——`BACKGROUND`、`OBJECTIVE`、`METHODS`、`RESULTS`、`CONCLUSIONS`。这说明它当前示例里加载到的，核心还是**文献记录/摘要文本**，不是整篇论文全文。[LangChain 文档](https://docs.langchain.com/oss/python/integrations/document_loaders/pubmed)

而 PubMed 自己的官方说明也一直在强调：  
PubMed 记录**可以包含**全文链接；真正的全文通常要去 **PubMed Central** 或出版社站点。NLM 的官方教学页也明确把“Get the Full Text”描述成去找 PMC 或 publisher links。[LangChain 文档+1](https://docs.langchain.com/oss/python/integrations/providers/pubmed)

所以 PubMed 这条线的真实情况是：

*   **搜索：可以**
*   **LangChain 直接返回摘要/记录：可以**
*   **像 arXiv 一样稳定地“搜完直接拿整篇全文文本”**：**不普遍，不保证**
*   **对于有 PMC/出版社全文链接的记录**：理论上你可以再跟进一跳，去抓 HTML/PDF，再用通用 URL/PDF loader 解析。PubMed 本身和 LangChain 的 PubMed 集成都把这个“全文入口”描述为链接，不是默认正文。[LangChain 文档+2LangChain 文档+2](https://docs.langchain.com/oss/python/integrations/providers/pubmed)

* * *

3\. 为什么 arXiv 这件事看起来更“顺手”
-------------------------

因为 arXiv 的开放获取属性更强，而且 LangChain 官方确实给了 **`ArxivLoader`** 这条非常直白的路线：  
示例里 `loader.load()` 之后拿到的 `Document.page_content` 就是论文正文开头，不是只有摘要。[LangChain 文档](https://docs.langchain.com/oss/python/integrations/document_loaders/arxiv?utm_source=chatgpt.com)

所以如果你的目标是：

*   搜论文
*   拉全文
*   切块
*   做 RAG

那 **arXiv 在 LangChain 里目前就是更像“开箱即用全文源”**。  
Semantic Scholar 和 PubMed 更像：

*   **Semantic Scholar**：发现与元数据很强
*   **PubMed**：医学检索很强，但全文经常需要跳去 PMC/出版社

* * *

4\. 最实用的判断
----------

### Semantic Scholar

更适合：

*   先搜到论文
*   看标题、作者、摘要、引用
*   找开放 PDF 线索

不太像：

*   直接现成全文库

### PubMed

更适合：

*   医学/生物方向检索
*   拿摘要和记录
*   再根据 PMC / publisher link 决定要不要继续抓全文

不太像：

*   所有结果都能直接完整返回全文

### arXiv

最像：

*   “直接搜 + 直接拉全文文本”

* * *

5\. 你现在该怎么选
-----------

如果你要的是\*\*“像 arXiv 一样，能直接拉全文做 LangChain RAG”\*\*：

*   **计算机 / AI / 数学 / 物理**：优先 **arXiv**
*   **医学 / 生物**：用 **PubMed 先检索**，再对有全文链接的结果去 **PMC / 出版社** 拉正文
*   **综合学术发现**：先用 **Semantic Scholar** 搜，再根据 `openAccessPdf` / PDF URL / 外链决定下一跳。[Semantic Scholar+2Semantic Scholar+2](https://www.semanticscholar.org/product/api)

最短版就是：

> **Semantic Scholar 和 PubMed 都能搜；但都不像 arXiv 那样，在 LangChain 现成接口里天然更偏“直接全文文本源”。**  
> **Semantic Scholar 偏元数据/摘要/PDF 线索，PubMed 偏摘要/记录/全文链接，arXiv 才是最像直接全文库的那个。** [LangChain 文档+2LangChain 文档+2](https://docs.langchain.com/oss/python/integrations/tools/semanticscholar)

我可以下一条直接给你一份 **“PubMed / Semantic Scholar 如何补成全文工作流”** 的 LangChain 代码，把“先检索，再顺着链接拉 HTML/PDF，再解析成 Document”写出来。

## Prompt:
除了这个langchain  其它的有没有类似的论文平台

## Response:
我去把主流框架里**现成的学术/论文源集成**核一下，优先看官方文档，不拿社区野路子凑数。

已思考 59s

有，而且差别还挺大。

先给结论
----

如果你问的是：

> **除了 LangChain，还有没有别的框架也能接论文源 / 学术库？**

答案是 **有**，而且最像 LangChain 这一套的，是 **LlamaIndex**。  
因为它现在官方就有现成的：

*   **ArxivReader**
*   **PubmedReader**
*   **SemanticScholarReader**

而且这些 reader 都是直接返回 `Document` 列表；其中 `ArxivReader` 还会**下载 PDF 再读取**，`SemanticScholarReader` 还有 `full_text=False/True` 这种开关。[LlamaIndex OSS Documentation+1](https://developers.llamaindex.ai/python/framework-api-reference/readers/arxiv/)

* * *

我按“像不像 LangChain 的论文集成”来排
-------------------------

### 1\. **LlamaIndex**：最像，也最完整

这是最接近你前面问的 LangChain 体验的替代品。

官方文档里明确有：

*   `ArxivReader`：按查询词搜 arXiv，返回 `Document` 列表；它会**下载 top 结果的 PDF 到本地，然后读取**。[LlamaIndex OSS Documentation+1](https://developers.llamaindex.ai/python/framework-api-reference/readers/arxiv/)
*   `PubmedReader`：按查询词搜 PubMed，返回 `Document` 列表；其中 `load_data_bioc()` 的说明写的是**抓取最相关全文论文的文本**，但文档也直说 **“BioC API 经常挂”**，稳定性一般。[LlamaIndex OSS Documentation+1](https://developers.llamaindex.ai/python/framework-api-reference/readers/papers/)
*   `SemanticScholarReader`：按查询词拉 Semantic Scholar 数据，返回 `Document` 列表，默认返回标题、摘要、venue、年份、citationCount、`openAccessPdf` 等字段；并且 `load_data()` 明确有 `full_text=False` 参数，设为真时会进一步取全文文档。[LlamaIndex OSS Documentation+1](https://developers.llamaindex.ai/python/framework-api-reference/readers/semanticscholar/)

### 你可以怎么理解它

如果 LangChain 是：

*   `Tool`
*   `Retriever`
*   `Loader`

那 LlamaIndex 更像：

*   `Reader`
*   `Document`
*   然后直接接索引 / 检索 / Agent

也就是说，它更偏“先把论文数据摄取进来，再做 RAG / QA / Agent”。

### 我对它的判断

**如果你想找一个“除了 LangChain 之外，最像论文工作台”的东西，LlamaIndex 是第一选择。**

* * *

### 2\. **Agno**：有现成论文工具，但覆盖没 LlamaIndex 那么全

Agno 官方现在明确有：

*   `ArxivTools`：能搜索 arXiv；参数里还有 `enable_read_arxiv_papers=True`，文档写的是允许**直接读取 arXiv 论文**。[Agno](https://docs.agno.com/integrations/toolkits/search/arxiv)
*   `PubmedTools`：能让 Agent 搜 PubMed。[Agno](https://docs.agno.com/integrations/toolkits/search/pubmed)
*   另外还有 `ArxivReader`，文档直接写它是一个**从 Arxiv API 读论文的 reader**。[Agno](https://docs.agno.com/reference/knowledge/reader/arxiv?utm_source=chatgpt.com)

### 它适合什么

适合：

*   你想要**Agent-first** 的体验
*   工具要现成
*   不想自己包太多函数

### 但它的边界也很明显

我这次核到的官方文档里：

*   **有 arXiv**
*   **有 PubMed**
*   我**没看到和 LlamaIndex 同等级的官方 Semantic Scholar 集成页**

所以它比 LangChain / LlamaIndex 更像：

> “现成 Agent 工具箱里有论文能力”

而不是：

> “完整的学术数据摄取平台”

* * *

### 3\. **CrewAI**：有 arXiv，但更像单点工具

CrewAI 官方现在明确有一个 **`ArxivPaperTool`**，文档写得很直：

*   搜索 arXiv
*   返回紧凑、可读结果
*   **可选下载 PDF**
*   **不需要 API key**
*   走的是 public arXiv Atom API。[docs.crewai.com](https://docs.crewai.com/en/tools/search-research/arxivpapertool)

### 它适合什么

适合：

*   你已经在用 CrewAI
*   只想给 agent 加一个“查 arXiv”能力
*   想快速做 demo

### 它不太像什么

它**不太像 LangChain 那种“学术源多接口体系”**。  
至少按我这次核到的官方文档，它更像：

*   CrewAI 主体负责 agent / flow
*   论文这块目前给你一个不错的 arXiv 工具
*   不是完整的论文平台矩阵

* * *

### 4\. **AutoGen**：能做，但官方更偏“你自己封装”

AutoGen 官方有一个 **Literature Review** 示例，里面很明确地说：

*   先定义一个 `search_arxiv` 函数
*   这个函数用 `arxiv` 库查论文
*   再把它包成 `FunctionTool`
*   给 agent 用。[microsoft.github.io](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/examples/literature-review.html)

### 这意味着什么

它不是没有论文能力。  
而是：

> **AutoGen 更像给你工具机制，论文源通常由你自己封。**

所以它不像 LangChain / LlamaIndex 那样，官方已经把学术源集成铺得比较平。

* * *

一句话对比
-----

### 最像 LangChain 的

**LlamaIndex**。  
因为它有现成的：

*   arXiv
*   PubMed
*   Semantic Scholar

而且都走 `Document` / Reader 这条很适合 RAG 的路线。[LlamaIndex OSS Documentation+1](https://developers.llamaindex.ai/python/framework-api-reference/readers/arxiv/)

### 最像“Agent + 论文工具箱”的

**Agno**。  
它有现成 `ArxivTools` 和 `PubmedTools`，开箱就能给 agent 用。[Agno+1](https://docs.agno.com/integrations/toolkits/search/arxiv)

### 最像“我只想给 agent 加个 arXiv”

**CrewAI**。  
有官方 `ArxivPaperTool`，还能选配下载 PDF。[docs.crewai.com](https://docs.crewai.com/en/tools/search-research/arxivpapertool)

### 最像“框架给机制，你自己组装论文工具”

**AutoGen**。  
官方 literature review 示例就是这么干的。[microsoft.github.io](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/examples/literature-review.html)

* * *

如果你真正关心的是“论文平台”而不是“框架名字”
------------------------

那可以把它们分成两层：

### 底层论文源 / 学术库

*   arXiv
*   PubMed
*   Semantic Scholar

### 上层框架

*   LangChain
*   LlamaIndex
*   Agno
*   CrewAI
*   AutoGen

也就是说，**这些框架大多不是自己发明了新的论文平台**，而是把现有学术源包装成：

*   tool
*   reader
*   retriever
*   loader
*   document pipeline

* * *

我给你的实际建议
--------

### 你想要“和 LangChain 很像，但做论文更顺”

选 **LlamaIndex**。  
因为它现在官方就把 arXiv / PubMed / Semantic Scholar 三条线摆在那儿了，而且格式统一成 `Document`。[LlamaIndex OSS Documentation+1](https://developers.llamaindex.ai/python/framework-api-reference/readers/arxiv/)

### 你想要“少折腾，Agent 直接能查论文”

选 **Agno**。[Agno+1](https://docs.agno.com/integrations/toolkits/search/arxiv)

### 你只想“把 arXiv 塞进一个 agent workflow”

选 **CrewAI**。[docs.crewai.com](https://docs.crewai.com/en/tools/search-research/arxivpapertool)

### 你已经在用 AutoGen

那就按官方示例自己包函数工具，别等它给你神奇学术平台大礼包。[microsoft.github.io](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/examples/literature-review.html)

* * *

最短结论
----

**有。**  
而且在“类似 LangChain 的论文集成能力”这件事上，**LlamaIndex 是最强替代**；**Agno** 次之，偏 agent 工具；**CrewAI** 更偏单点 arXiv 工具；**AutoGen** 则更偏你自己封装。[microsoft.github.io+3LlamaIndex OSS Documentation+3Agno+3](https://developers.llamaindex.ai/python/framework-api-reference/readers/arxiv/)

我可以下一条直接给你一份 **“LlamaIndex 版的 arXiv / PubMed / Semantic Scholar 使用指南”**，按你之前要 LangChain 那种方式写。

## Prompt:
；参数里还有 \`enable\_read\_arxiv\_papers=True\`，文档写的是允许\*\*直接读取 arXiv 论文\*\*

是不是意味着不用下载了？还是什么意思？

## Response:
我去把 Agno 文档里这句的精确定义钉一下，避免把“能读论文”误解成“完全不下载、也不经过 PDF”。

已思考 25s

不是“完全不用下载”的意思。

更准确地说，**对你写代码的人来说**，它的意思是：

> 你**不用自己手写**“搜索 arXiv → 找 PDF → 下载文件 → 解析内容”这一串流程，Agno 把这部分封装成工具了。`ArxivTools` 文档里写的是：`enable_search_arxiv` 用来搜索，`enable_read_arxiv_papers` 用来“直接读取 arXiv 论文”，并且还有一个 `download_dir` 参数，说明“下载的文件会保存到这个目录”。这已经很直接地表明：**底层仍然可能会下载文件，只是下载动作由框架代劳**。[Agno](https://docs.agno.com/integrations/toolkits/search/arxiv)

所以这句话应该拆成两层理解：

*   **从使用体验上**：像“不用你管下载了”，因为你只是在 Agent 里开一个开关。[Agno](https://docs.agno.com/integrations/toolkits/search/arxiv)
*   **从底层实现上**：不是“空气取全文”，而是框架自己去取论文内容；`download_dir` 这个参数本身就说明它会处理下载后的文件保存。[Agno](https://docs.agno.com/integrations/toolkits/search/arxiv)

另外，Agno 还有一个单独的 `ArxivReader`，官方写法是：它是一个“允许你从 Arxiv API 读取论文”的 reader。这个表述也更像“框架帮你读取远端论文内容”，不是“论文 magically 已经在你本地”。[Agno](https://docs.agno.com/reference/knowledge/reader/arxiv)

你可以把它理解成：

*   **你自己写原始流程**：  
    搜索 → 下载 → 解析 → 返回内容
*   **用 Agno**：  
    调 `ArxivTools` / `ArxivReader` → 框架替你做上面那串脏活

所以答案是：

**不是“不用下载”，而是“不用你亲自处理下载和读取过程”。**  
如果只是 `search_arxiv` 这类搜索，更多是查结果；如果开启/使用“read papers”这条能力，底层就更接近“由框架代你取回论文内容并读取”。[Agno+1](https://docs.agno.com/integrations/toolkits/search/arxiv)

你要的话，我可以接着把这句话再翻译成**非常具体的工程含义**：  
“它到底更像摘要抓取，还是更像 PDF 下载后解析”。

## Prompt:
所以langchain和llamaindex有一样的功能吧？

## Response:
我去把两家的**官方定位**再对一下，免得把“都能做”误说成“完全一样”。

已思考 21s

对，**大方向上有很大重叠**，但**不是完全一样**。

先说人话版结论
-------

### 可以把它们看成“同一类框架”

两家都能做这些事：

*   接 LLM
*   接工具
*   做 agent
*   做检索 / RAG
*   把外部数据接进来

LangChain 官方把自己定位成一个带有**预构建 agent 架构**和大量模型/工具集成的框架；LlamaIndex 官方则把自己定位成一个用于构建**基于你自己数据的 agents** 的框架。也就是说，**两者都能做 agent + 检索 + 数据接入**。[LlamaIndex OSS Documentation+3LangChain 文档+3LlamaIndex OSS Documentation+3](https://docs.langchain.com/oss/python/langchain/overview?utm_source=chatgpt.com)

### 但它们的“重心”不一样

**LangChain** 更偏：

*   agent 工程
*   工具调用
*   运行控制
*   中间件、可观测性、执行流程控制

官方文档里专门有 agents、middleware、LangGraph 这些模块，强调生产级 agent 执行与控制。[LangChain 文档+2LangChain 文档+2](https://docs.langchain.com/oss/python/langchain/agents?utm_source=chatgpt.com)

**LlamaIndex** 更偏：

*   你的数据
*   索引 / 检索
*   query engines / chat engines
*   retrieval-augmented agents

官方文档里对 retriever、tool retriever、agents over your data 这条线写得非常重。[LlamaIndex OSS Documentation+3LlamaIndex OSS Documentation+3LlamaIndex OSS Documentation+3](https://developers.llamaindex.ai/python/framework/?utm_source=chatgpt.com)

* * *

如果只看“论文平台能力”，它们其实非常像
--------------------

这是你当前最关心的点。

### 在论文 / 学术源这件事上

它们都能做“搜论文、拿文档、接 agent / RAG”，只是接口名字不同：

*   **LangChain** 常见是  
    `Tool` / `Retriever` / `Loader`
*   **LlamaIndex** 常见是  
    `Reader` / `Document` / `Index` / `QueryEngine`

所以从能力上说，**是同一类功能族**；从 API 风格上说，**不是一模一样的壳子**。这个差别更像“同一种车，变速箱手感不同”，不是“一个是车一个是微波炉”。[LangChain 文档+2LlamaIndex OSS Documentation+2](https://docs.langchain.com/oss/python/langchain/retrieval?utm_source=chatgpt.com)

* * *

最实用的判断
------

### 你要“agent + 工具编排 + 生产控制”

更偏 **LangChain**。  
因为它官方当前主叙事就是 agent engineering，`create_agent`、middleware、LangGraph 这些模块都在往这个方向发力。[LangChain 文档+3LangChain 文档+3LangChain 文档+3](https://docs.langchain.com/?utm_source=chatgpt.com)

### 你要“论文 / 文档 / 自有数据 → 检索 → 问答 / agent”

更偏 **LlamaIndex**。  
因为它官方定位和模块设计都更强调“over your data”，retriever、query engine、reader 这条链条更统一。[LlamaIndex OSS Documentation+3LlamaIndex OSS Documentation+3LlamaIndex OSS Documentation+3](https://developers.llamaindex.ai/python/framework/?utm_source=chatgpt.com)

* * *

一句话钉死
-----

**是，同类功能大体都有。**  
但更准确地说是：

> **LangChain 和 LlamaIndex 在能力集合上高度重叠，尤其都能做论文检索、RAG、agent；只是 LangChain 更偏 agent 平台与工具编排，LlamaIndex 更偏数据摄取、索引和检索。** [LlamaIndex OSS Documentation+3LangChain 文档+3LlamaIndex OSS Documentation+3](https://docs.langchain.com/oss/python/langchain/overview?utm_source=chatgpt.com)

如果你愿意，我下一条可以直接给你一张 **“LangChain vs LlamaIndex 在论文场景下的逐项对照表”**，把 arXiv、PubMed、Semantic Scholar、全文读取、RAG、Agent 这些一列一列比清楚。

## Prompt:
所以它们阅读全文的方式都是直接下载下来？

## Response:
我把“阅读全文”拆成三种来源来说：**arXiv、PubMed、Semantic Scholar**。别把“返回摘要”“给全文链接”“实际下载 PDF/HTML 再解析”揉成一坨。

已思考 28s

不都是。

最准确的结论
------

**它们“阅读全文”的方式取决于数据源，不取决于框架名字本身。**  
LangChain 和 LlamaIndex 都只是封装层；真正决定“是不是直接下载全文”的，是你接的是 **arXiv、PubMed，还是 Semantic Scholar**，以及你用的是 **loader / reader / retriever / tool** 哪一类接口。[LangChain 文档+1](https://docs.langchain.com/oss/python/integrations/document_loaders?utm_source=chatgpt.com)

* * *

1\. arXiv：通常是，基本就是“下载 PDF 再解析”
------------------------------

这条线最像你说的“直接下载下来再读”。

*   **LangChain `ArxivLoader`** 官方页明确要求安装 `PyMuPDF`，并说明它会把 arXiv 的论文加载成 `Document`；这条路线本质上就是拿论文 PDF 再转成文本。[LangChain 文档](https://docs.langchain.com/oss/python/integrations/document_loaders/arxiv?utm_source=chatgpt.com)
*   **LlamaIndex `ArxivReader`** 写得更直白：`Search for a topic on Arxiv, download the PDFs of the top results locally, then read them.` 也就是先把 top 结果的 PDF 下载到本地，再读成文档。[LlamaIndex OSS Documentation](https://developers.llamaindex.ai/python/framework-api-reference/readers/arxiv/?utm_source=chatgpt.com)

所以对 **arXiv** 来说，你可以近似理解成：

> **是，阅读全文这件事通常就是“下载 PDF → 解析文本”。** [LangChain 文档+1](https://docs.langchain.com/oss/python/integrations/document_loaders/arxiv?utm_source=chatgpt.com)

* * *

2\. PubMed：通常不是“直接下载全文”，而是先拿记录/摘要，全文要看外链
----------------------------------------

PubMed 这条线就没那么简单了。

LangChain 的 PubMed 文档反复强调：PubMed 是一个 **citations** 数据库，记录里**可能包含**指向 **PubMed Central** 或出版社网站的全文链接。这个表述很关键，意思是它默认更像“文献记录和摘要入口”，不是“所有结果都直接给你正文”。[LangChain 文档+2LangChain 文档+2](https://docs.langchain.com/oss/python/integrations/tools/pubmed?utm_source=chatgpt.com)

而且 **LangChain `PubMedLoader`** 的官方示例里，展示出来的 `page_content` 是典型的摘要结构，比如 `BACKGROUND / OBJECTIVE / METHODS / RESULTS / CONCLUSIONS`，这更像摘要或结构化记录，不是整篇正文。[LangChain 文档](https://docs.langchain.com/oss/python/integrations/document_loaders/pubmed?utm_source=chatgpt.com)

所以对 **PubMed** 来说：

> **通常不是直接把全文下载下来。**  
> 更常见的是：先返回记录/摘要；如果那篇文章有 **PMC 或 publisher full text link**，你再顺着链接去拿全文。[LangChain 文档+2LangChain 文档+2](https://docs.langchain.com/oss/python/integrations/tools/pubmed?utm_source=chatgpt.com)

* * *

3\. Semantic Scholar：更像“给你元数据 + 开放 PDF 线索”，不天然等于全文下载器
-----------------------------------------------------

Semantic Scholar 在这三者里最像“学术图谱和元数据 API”。

LlamaIndex 的 `SemanticScholarReader` 文档显示，它默认返回的字段包括：

*   `title`
*   `abstract`
*   `venue`
*   `year`
*   `paperId`
*   `citationCount`
*   `openAccessPdf`
*   `authors`
*   `externalIds`

也就是说，它默认先给你的是**摘要和元数据**，外加一个 `openAccessPdf` 入口。[LlamaIndex OSS Documentation](https://developers.llamaindex.ai/python/framework-api-reference/readers/semanticscholar/?utm_source=chatgpt.com)

同一页还写了：

*   `full_text=False` 是默认值
*   如果设成 `full_text=True`，就会进一步调用 `_get_full_text_docs(documents)` 去拿全文文档。[LlamaIndex OSS Documentation](https://developers.llamaindex.ai/python/framework-api-reference/readers/semanticscholar/?utm_source=chatgpt.com)

这说明对 **Semantic Scholar** 来说，全文不是默认结果；它更像：

> **先拿论文信息和开放 PDF 链接，只有在你显式走 full\_text 路线时，才进一步去抓全文。** [LlamaIndex OSS Documentation](https://developers.llamaindex.ai/python/framework-api-reference/readers/semanticscholar/?utm_source=chatgpt.com)

这里我会保守一点说：  
它**不应被理解成“永远都先下载整篇论文”**，而更像“如果有开放可用的全文入口，就继续取全文”。[LlamaIndex OSS Documentation](https://developers.llamaindex.ai/python/framework-api-reference/readers/semanticscholar/?utm_source=chatgpt.com)

* * *

4\. 所以 LangChain 和 LlamaIndex 是不是“阅读全文方式一样”？
--------------------------------------------

**大方向很像，但不是逐项完全一样。**

*   对 **arXiv**，两边都很像“下载 PDF 再解析文本”。[LangChain 文档+1](https://docs.langchain.com/oss/python/integrations/document_loaders/arxiv?utm_source=chatgpt.com)
*   对 **PubMed**，两边都更像“先拿记录/摘要，再看有没有 PMC/出版社全文链接”。至少 LangChain 官方就是这么定义的；你不该把它想成 PubMed 天然就是全文库。[LangChain 文档+2LangChain 文档+2](https://docs.langchain.com/oss/python/integrations/tools/pubmed?utm_source=chatgpt.com)
*   对 **Semantic Scholar**，它更像“返回元数据和开放 PDF 入口；需要全文时再继续拿”，不是默认全文下载器。[LlamaIndex OSS Documentation](https://developers.llamaindex.ai/python/framework-api-reference/readers/semanticscholar/?utm_source=chatgpt.com)

所以更准确的说法是：

> **不是“LangChain 和 LlamaIndex 都一律直接下载全文”，而是“它们都会按各个数据源允许的方式去拿内容；只有 arXiv 这条线最像稳定的 PDF 下载 + 解析模式”。** [LlamaIndex OSS Documentation+3LangChain 文档+3LlamaIndex OSS Documentation+3](https://docs.langchain.com/oss/python/integrations/document_loaders/arxiv?utm_source=chatgpt.com)

* * *

5\. 你可以这样记忆，不容易混
----------------

### arXiv

最像：  
**搜索 → 下载 PDF → 解析成文本**。[LangChain 文档+1](https://docs.langchain.com/oss/python/integrations/document_loaders/arxiv?utm_source=chatgpt.com)

### PubMed

最像：  
**搜索 → 返回摘要/记录 → 有全文链接时再跳去 PMC/出版社**。[LangChain 文档+2LangChain 文档+2](https://docs.langchain.com/oss/python/integrations/tools/pubmed?utm_source=chatgpt.com)

### Semantic Scholar

最像：  
**搜索 → 返回论文元数据/摘要/开放 PDF 入口 → 可选继续拿全文**。[LlamaIndex OSS Documentation](https://developers.llamaindex.ai/python/framework-api-reference/readers/semanticscholar/?utm_source=chatgpt.com)

* * *

6\. 最短版回答
---------

**不是。**  
只有 **arXiv** 这条线，最接近“阅读全文就是直接把 PDF 下载下来再解析”。  
**PubMed** 通常先给摘要/记录和全文链接。  
**Semantic Scholar** 通常先给元数据、摘要和开放 PDF 入口，全文是后续可选步骤，不是默认都直接下载。[LlamaIndex OSS Documentation+3LangChain 文档+3LlamaIndex OSS Documentation+3](https://docs.langchain.com/oss/python/integrations/document_loaders/arxiv?utm_source=chatgpt.com)

我可以下一条直接把这三条路线画成一个**完整工作流图**：  
“搜索 → 返回什么 → 什么时候会真的去拉全文”。



---
Powered by [ChatGPT Exporter](https://www.chatgptexporter.com)