# arXiv API 调用介绍

**User:** Anonymous (jiachangkun02@gmail.com)  
**Created:** 3/7/2026 10:05:58  
**Updated:** 3/7/2026 10:16:44  
**Exported:** 3/7/2026 10:29:42  
**Link:** [https://chatgpt.com/c/69ab87f4-ef94-8323-ba03-da702a0804e0](https://chatgpt.com/c/69ab87f4-ef94-8323-ba03-da702a0804e0)  

## Prompt:
https://info.arxiv.org/help/api/basics.html      看看这个网页的内容  是这样调用的吗？

## Response:
我先把这个页面的规则抓出来，核对一下它实际写的调用方式，再给你一个能直接照着用的版本。

已思考 44s

看了，这个页面的意思基本就是：

**对，arXiv API 确实是这样调的。**  
它不是那种先装官方 SDK 再调方法的路子，而是直接对 `export.arxiv.org` 发 HTTP 请求。官方说明里写的是：可以用 **GET 或 POST**，最常见的是 **GET**，把参数拼到查询字符串里；返回内容是 **Atom 1.0 XML**，不是 JSON。[arXiv信息+1](https://info.arxiv.org/help/api/basics.html)

最基础的调用长这样：

```
http://export.arxiv.org/api/query?search_query=all:electron
```

要分页时再加：

```
http://export.arxiv.org/api/query?search_query=all:electron&start=0&max_results=10
```

这正是它文档里的示例。`start` 是从 0 开始的结果偏移，`max_results` 是本次返回多少条。[arXiv信息+1](https://info.arxiv.org/help/api/basics.html)

这个页面里最关键的几点
-----------

*   基础入口是 `api/query`
*   常用参数有 `search_query`、`id_list`、`start`、`max_results`
*   `search_query` 用来按条件搜，`id_list` 用逗号分隔传 arXiv id
*   两个一起传时，`id_list` 会被当成一个过滤范围，再去匹配 `search_query`
*   返回格式是 Atom XML feed，不是 JSON 数组那套 [arXiv信息](https://info.arxiv.org/help/api/user-manual.html)

你可以这样理解它
--------

### 1) 搜索

```
http://export.arxiv.org/api/query?search_query=all:electron
```

### 2) 分页

```
http://export.arxiv.org/api/query?search_query=all:electron&start=20&max_results=10
```

### 3) 排序

```
http://export.arxiv.org/api/query?search_query=ti:"electron thermal conductivity"&sortBy=lastUpdatedDate&sortOrder=ascending
```

官方文档还列了 `sortBy` 可用值：`relevance`、`lastUpdatedDate`、`submittedDate`，`sortOrder` 可用 `ascending` 或 `descending`。[arXiv信息](https://info.arxiv.org/help/api/user-manual.html)

如果你要在代码里调
---------

Python 用 `requests` 或标准库都行，思路就是把参数传给这个 endpoint：

```
import requests

url = "http://export.arxiv.org/api/query"
params = {
    "search_query": 'all:electron',
    "start": 0,
    "max_results": 10,
}

resp = requests.get(url, params=params, timeout=30)
print(resp.status_code)
print(resp.text[:500])   # 这里拿到的是 Atom XML
```

这个写法和官方页面表达的调用方式是一致的：HTTP 请求 + query parameters。返回后你要按 XML/Atom 去解析。[arXiv信息+1](https://info.arxiv.org/help/api/basics.html)

另外两个容易踩坑的小机关
------------

*   **不是 JSON**：很多人会下意识 `response.json()`，这会翻车。官方写得很清楚，返回是 Atom 1.0 XML。[arXiv信息+1](https://info.arxiv.org/help/api/basics.html)
*   **别过猛连打**：文档建议多次连续请求时加大约 **3 秒延迟**；同一查询结果一天内通常不会变化，建议缓存。单次 `max_results` 也有限制，超大批量抓取更适合用 OAI-PMH。[arXiv信息](https://info.arxiv.org/help/api/user-manual.html)

所以，结论很朴素：

**是，这网页说的调用方式就是：**

1.  请求 `http://export.arxiv.org/api/query`
2.  参数放到 query string（GET）或 POST 请求里
3.  读回来的 Atom XML

把你现在写的那段调用代码或完整 URL 贴上来，我直接按这份官方文档帮你逐项对。

## Prompt:
这个返回的到底是什么？论文全文吗？还是什么？

## Response:
我去把官方文档里“返回内容结构”那段翻出来，免得被 XML 这团史前沼泽骗了。

已思考 17s

不是论文全文。

**这个 API 返回的是一份 Atom XML feed，本质上是“论文元数据列表”**，里面每个 `<entry>` 对应一篇论文；官方明确写了，API 返回的是 **Atom 1.0 格式** 的响应，不是 HTML，也不是直接把 PDF / TeX 全文塞回来。[arXiv信息+1](https://info.arxiv.org/help/api/user-manual.html)

每条结果里通常有什么
----------

按官方的解析示例和手册，单篇论文的条目一般会包含这些信息：

*   arXiv ID
*   标题
*   发布时间 / 更新时间
*   作者
*   作者单位（有时有）
*   摘要（在 `<summary>` 里）
*   abstract 页面链接
*   PDF 链接
*   学科分类
*   comments、journal reference、DOI 等附加元数据（如果有） [arXiv信息+2arXiv信息+2](https://info.arxiv.org/help/api/examples/python_arXiv_parsing_example.txt)

这里最容易误会的一点是：

**`summary` 字段是摘要，不是全文。**  
官方示例代码直接写了 “The abstract is in the `<summary>` element”。[arXiv信息+1](https://info.arxiv.org/help/api/examples/python_arXiv_parsing_example.txt)

你拿到的更像这样
--------

返回结构大概是：

```
<feed>
  ... 查询本身的元信息 ...
  <entry>
    <id>...</id>
    <title>...</title>
    <published>...</published>
    <updated>...</updated>
    <summary>摘要</summary>
    <author>...</author>
    <link ... />   <!-- abs 页面 -->
    <link ... />   <!-- pdf 链接 -->
    ...
  </entry>
</feed>
```

也就是说，**它给你的是“可检索的论文信息 + 跳转链接”**。[arXiv信息+1](https://info.arxiv.org/help/api/user-manual.html)

那全文怎么拿？
-------

如果你要的是**全文 PDF**，通常做法是：

1.  先用 API 拿到结果
2.  从返回里的 `<link title="pdf">` 或论文页面链接里取 PDF 地址
3.  再单独下载 PDF

官方的 bulk data 页面也把这件事分得很清楚：  
**API** 提供的是 **metadata 和 search engine access**；  
而 **full-text** 获取是另一类服务，像 Kaggle 全量数据集、Amazon S3 上的 PDF / source files。[arXiv信息](https://info.arxiv.org/help/bulk_data.html)

所以一句话概括：

**arXiv API 默认返回的是“论文元数据 + 摘要 + 链接”，不是论文全文。**

把你实际拿到的那段 XML 贴出来，我可以直接帮你逐字段解释，告诉你哪个是摘要、哪个是 PDF 链接、哪个是论文 ID。

## Prompt:
这个api好像就直接可以调用    不像llm api那样有一串密钥？  我不太明白     你能结合实际的例子和场景来为我演示一下吗？

## Response:
我去把官方文档里“认证、返回内容、典型请求”几块拼起来，然后用几个实际场景演示。核心差别其实不玄学：这个更像公开检索接口，不像需要身份计费的 LLM 接口。

我已经把关键处对上了：查询 API 这边，官方示例都是直接请求 `export.arxiv.org/api/query`，没有展示任何 token/header 那套身份认证。还要补一刀：这是“查论文元数据”的接口，不是“代你跑模型”的接口。

已思考 57s

对，你抓到关键差别了。

先给结论
----

**arXiv 的“查询 API”基本就是公开 HTTP 接口。**  
官方文档把它描述成 **public API access**，示例也是直接对 `http://export.arxiv.org/api/query` 发 GET/POST 请求，没有展示 API key、Bearer token、签名之类的认证步骤；而且官方还明确说，这个 URL 甚至可以直接在浏览器里打开。返回结果是 **Atom 1.0 XML**。[arXiv信息+2arXiv信息+2](https://info.arxiv.org/help/api/index.html?utm_source=chatgpt.com)

但这里要加一个小齿轮：

**你现在看的这个，是“查询/检索 API”。**  
arXiv 还有别的接口，比如 **SWORD deposit API** 是给投稿/批量上传用的，那套就不是裸奔模式了：官方写了需要作者注册、额外授权，并通过 `https` + **HTTP Basic Authentication** 认证。[arXiv信息](https://info.arxiv.org/help/submit_sword.html)

所以不是“arXiv 所有 API 都没密钥”，而是：

*   **查询 API**：公开可调用，像开放检索接口
*   **投稿/上传 API（SWORD）**：需要认证和授权 [arXiv信息+1](https://info.arxiv.org/help/submit_sword.html)

* * *

为什么它不像 LLM API 那样要 key？
-----------------------

本质上两类东西不是一个物种。

### LLM API

你每次调用都在消耗模型推理算力，还牵涉计费、额度、滥用控制，所以通常必须有 key。

### arXiv 查询 API

它做的是 **公开论文库的检索和元数据返回**。官方目标就是降低门槛，方便开发者访问 arXiv 的内容和元数据，所以它走的是“公开 HTTP 接口 + 使用条款 + 速率限制”这条路。[arXiv信息+1](https://info.arxiv.org/help/api/basics.html)

你可以把它理解成：

*   **LLM API** 更像“租一台很贵的大脑”
*   **arXiv 查询 API** 更像“查一个公开图书馆目录”

图书馆目录通常不需要你先领一把金钥匙，但也不会允许你拿电钻把门拆了。所以官方要求 **最多每 3 秒 1 次请求，且一次只用一个连接**。[arXiv信息+1](https://info.arxiv.org/help/api/tou.html?utm_source=chatgpt.com)

* * *

实际演示 1：手工查论文（最直观）
-----------------

### 场景

你只是想看看“diffusion”相关论文前 3 条。

你直接在浏览器打开这个 URL 就行：

```
http://export.arxiv.org/api/query?search_query=all:diffusion&start=0&max_results=3
```

这和官方 Quickstart 的模式完全一样：  
`search_query` 指定搜索条件，`start` 指分页起点，`max_results` 指返回条数。官方示例就是这样拼 URL 的。[arXiv信息+1](https://info.arxiv.org/help/api/basics.html)

### 你会看到什么？

不是网页论文正文，而是一段 XML，大概长这样：

```
<feed>
  ...
  <entry>
    <id>...</id>
    <title>...</title>
    <published>...</published>
    <updated>...</updated>
    <summary>这里是摘要，不是全文</summary>
    <author>...</author>
    <link rel="alternate" ... />   <!-- abstract 页面 -->
    <link title="pdf" rel="related" ... />  <!-- PDF 链接 -->
  </entry>
</feed>
```

官方文档明确写了：

*   返回是 **Atom 1.0**
*   每篇论文是一个 `<entry>`
*   `<summary>` 是摘要
*   `<link>` 里通常有 abstract 页和 pdf 链接
*   还可能有分类、comments、journal ref、DOI 等字段 [arXiv信息+2arXiv信息+2](https://info.arxiv.org/help/api/basics.html)

* * *

实际演示 2：用 curl 调一下
-----------------

### 场景

你在命令行里快速测试接口通不通。

```
curl "http://export.arxiv.org/api/query?search_query=all:graph+neural+network&start=0&max_results=2"
```

### 结果

你会拿到 XML 文本，而不是 JSON。  
这点很重要，很多人第一反应会写 `response.json()`，然后代码当场表演自由落体。官方写得很清楚：返回是 **Atom 1.0 XML**。[arXiv信息+1](https://info.arxiv.org/help/api/basics.html)

* * *

实际演示 3：Python 里真正怎么写
--------------------

### 场景

你想做一个“每天抓 5 篇某主题论文”的小脚本。

```
import requests
import xml.etree.ElementTree as ET

url = "http://export.arxiv.org/api/query"
params = {
    "search_query": 'all:"graph neural network"',
    "start": 0,
    "max_results": 5,
}

resp = requests.get(url, params=params, timeout=30)
resp.raise_for_status()

xml_text = resp.text
root = ET.fromstring(xml_text)

ns = {
    "atom": "http://www.w3.org/2005/Atom",
    "arxiv": "http://arxiv.org/schemas/atom",
}

for entry in root.findall("atom:entry", ns):
    title = entry.findtext("atom:title", default="", namespaces=ns).strip()
    summary = entry.findtext("atom:summary", default="", namespaces=ns).strip()

    pdf_link = None
    for link in entry.findall("atom:link", ns):
        if link.attrib.get("title") == "pdf":
            pdf_link = link.attrib.get("href")
            break

    print("标题:", title)
    print("摘要:", summary[:200], "...")
    print("PDF:", pdf_link)
    print("-" * 50)
```

### 这段代码在干什么？

它就是照官方接口结构来的：

*   请求 `api/query`
*   传 `search_query`、`start`、`max_results`
*   把返回的 Atom XML 解析成 `entry`
*   从 `title`、`summary`、`link title="pdf"` 里取数据

这些字段和组织方式都在官方手册里写了。[arXiv信息+2arXiv信息+2](https://info.arxiv.org/help/api/basics.html)

* * *

实际演示 4：已知论文 ID，精确拿元数据
---------------------

### 场景

你已经知道某篇 arXiv 论文的 ID，只想拿它的元数据，而不是全文。

可以走 `id_list`：

```
http://export.arxiv.org/api/query?id_list=cs/9901002v1
```

官方手册用这个 `id_list` 例子展示过分类和主分类字段。[arXiv信息](https://info.arxiv.org/help/api/user-manual.html)

### 适合什么场景？

比如你已经从别处拿到了 arXiv ID，现在想补全：

*   标题
*   作者
*   摘要
*   分类
*   PDF 链接
*   DOI / journal\_ref（如果作者填了）

* * *

一个更贴近实际的小应用场景
-------------

### 场景：做“论文监控器”

你研究某个方向，比如 `"multimodal reasoning"`。  
你每天跑一次：

```
http://export.arxiv.org/api/query?search_query=all:"multimodal reasoning"&start=0&max_results=20&sortBy=submittedDate&sortOrder=descending
```

然后你把返回里的每个 `<entry>` 解析出来，存进自己的数据库，页面上只展示：

*   标题
*   作者
*   摘要
*   PDF 按钮
*   分类
*   更新时间

这就是 arXiv API 很典型的用途：**发现论文、整理元数据、做提醒/检索/可视化工具**。官方 Terms of Use 里还明确列了这类允许用途，比如更好的搜索界面、通知工具、主题可视化。[arXiv信息+1](https://info.arxiv.org/help/api/user-manual.html)

* * *

你现在最容易混淆的点
----------

### 1\. “没 key” 不等于 “随便打”

官方有速率限制：

*   **不超过每 3 秒 1 次请求**
*   **单连接**
*   不要绕过限制，不然可能被封 [arXiv信息+1](https://info.arxiv.org/help/api/tou.html?utm_source=chatgpt.com)

### 2\. “API 返回内容” 不等于 “论文全文”

查询 API 返回的是：

*   元数据
*   摘要
*   链接

不是直接把 PDF 正文塞回来。官方 bulk data 页面把“元数据/search API”和“全文数据获取”分开讲了。[arXiv信息+1](https://info.arxiv.org/help/bulk_data.html?utm_source=chatgpt.com)

### 3\. “arXiv API” 不只一种

你现在看到的是 **legacy arXiv query API**。  
如果是 **SWORD 投稿 API**，那就需要注册、授权、认证了。别把这两锅汤倒一起。[arXiv信息+1](https://info.arxiv.org/help/api/tou.html)

* * *

一句话记忆版
------

你可以这么记：

> **arXiv 查询 API = 公开的论文目录检索口**  
> **LLM API = 付费调用大模型算力**

前者更像“查馆藏”；后者更像“雇脑子”。

把你现在最想实现的那个场景贴出来——比如“按关键词搜论文”“拿 PDF 链接”“按日期抓新论文”“根据作者过滤”——我可以直接给你写成一段可运行的 Python 或 JavaScript。

## Prompt:
可以

## Response:
我直接给你做一个最小可运行演示：先查关键词，再把标题、摘要、PDF 链接取出来。顺手把“为什么不需要 key、但仍然要限速”也钉死。

已思考 23s

可以。下面我直接拿 **arXiv 查询 API** 做一个“能看懂、能上手、能区分它和 LLM API”的演示。

先把核心差别钉住
--------

你现在说的这个 **arXiv query API**，官方写法就是：

*   直接对 `http://export.arxiv.org/api/query` 发 **HTTP GET 或 POST**
*   参数放在 URL 查询串里
*   这个 URL **甚至可以直接在浏览器里打开**
*   返回内容是 **Atom 1.0 XML**
*   文档没有要求你先申请 API key 才能查这些公开元数据接口 [arXiv信息+2arXiv信息+2](https://info.arxiv.org/help/api/basics.html)

而且官方还要求你别把它打成机关枪：

*   legacy API 最多 **每 3 秒 1 次请求**
*   同时只用 **单连接** [arXiv信息+1](https://info.arxiv.org/help/api/tou.html)

所以它更像：

*   **arXiv query API**：公开论文目录检索口
*   **LLM API**：付费调用模型算力的服务

不是一个物种，别把两只锅里的汤倒一起。

* * *

场景 1：最简单，直接在浏览器里查
-----------------

### 目标

查“graph neural network”相关论文前 3 条。

直接打开：

```
http://export.arxiv.org/api/query?search_query=all:"graph neural network"&start=0&max_results=3
```

这里几个参数的意思是：

*   `search_query`：搜索条件
*   `start`：从第几条开始，**0-based**，也就是从 0 开始计数
*   `max_results`：返回多少条结果 [arXiv信息](https://info.arxiv.org/help/api/user-manual.html)

### 你会看到什么？

你看到的不是论文全文，也不是 JSON，而是一段 **Atom XML**。官方明确写了：HTTP 响应体里返回的内容都是 **Atom 1.0**。[arXiv信息+1](https://info.arxiv.org/help/api/basics.html)

结构大致像这样：

```
<feed>
  <entry>
    <title>...</title>
    <id>...</id>
    <updated>...</updated>
    <summary>...</summary>
    <author>...</author>
    <link href="..." rel="alternate" type="text/html"/>
    <link title="pdf" href="..." rel="related" type="application/pdf"/>
  </entry>
</feed>
```

其中：

*   `<summary>` 是 **摘要**
*   `title="pdf"` 的 `<link>` 是 **PDF 链接** [arXiv信息+1](https://info.arxiv.org/help/api/user-manual.html)

* * *

场景 2：你想“按关键词抓论文摘要”
------------------

### 用 curl 直接测

```
curl "http://export.arxiv.org/api/query?search_query=all:\"graph neural network\"&start=0&max_results=2"
```

这一步适合干嘛？

*   验证接口能不能通
*   看返回是不是你要的字段
*   先别写代码，先肉眼确认 XML 长啥样

这个阶段很像拿小木棍戳沼泽，避免一脚踩进去。

* * *

场景 3：Python 里真正怎么写
------------------

这是一个最小可运行版本：  
它会查询论文，然后打印 **标题、摘要、PDF 链接**。

```
import time
import requests
import xml.etree.ElementTree as ET

url = "http://export.arxiv.org/api/query"
params = {
    "search_query": 'all:"graph neural network"',
    "start": 0,
    "max_results": 3,
    "sortBy": "submittedDate",
    "sortOrder": "descending",
}

resp = requests.get(url, params=params, timeout=30)
resp.raise_for_status()

xml_text = resp.text
root = ET.fromstring(xml_text)

ns = {
    "atom": "http://www.w3.org/2005/Atom",
    "arxiv": "http://arxiv.org/schemas/atom",
}

for entry in root.findall("atom:entry", ns):
    title = entry.findtext("atom:title", default="", namespaces=ns).strip()
    summary = entry.findtext("atom:summary", default="", namespaces=ns).strip()

    pdf_link = None
    for link in entry.findall("atom:link", ns):
        if link.attrib.get("title") == "pdf":
            pdf_link = link.attrib.get("href")
            break

    print("标题:", title)
    print("摘要:", summary[:200], "...")
    print("PDF:", pdf_link)
    print("-" * 60)

# 如果你要循环分页抓取，记得遵守官方建议
time.sleep(3)
```

### 这段代码对应了哪些官方规则？

*   请求入口是 `api/query` [arXiv信息+1](https://info.arxiv.org/help/api/basics.html)
*   `sortBy` 可用 `relevance`、`lastUpdatedDate`、`submittedDate`
*   `sortOrder` 可用 `ascending`、`descending` [arXiv信息](https://info.arxiv.org/help/api/user-manual.html)
*   返回是 Atom XML，不是 JSON [arXiv信息+1](https://info.arxiv.org/help/api/basics.html)
*   摘要在 `<summary>`，PDF 在 `title="pdf"` 的链接里 [arXiv信息+1](https://info.arxiv.org/help/api/user-manual.html)
*   连续调用时最好加 3 秒延迟，避免顶到限速天花板 [arXiv信息+1](https://info.arxiv.org/help/api/tou.html)

* * *

场景 4：已知 arXiv ID，只取那篇论文的信息
--------------------------

比如你已经知道论文 ID，想取它的元数据。

```
http://export.arxiv.org/api/query?id_list=cond-mat/0207270
```

官方手册里写了：

*   只给 `id_list`：返回这些 ID 对应的文章
*   只给 `search_query`：返回匹配搜索条件的文章
*   两个都给：返回 `id_list` 里同时匹配 `search_query` 的文章，相当于过滤器 [arXiv信息](https://info.arxiv.org/help/api/user-manual.html)

这很适合这种场景：

*   数据库里已经存了 arXiv ID
*   现在想补全标题、摘要、PDF、分类、DOI

* * *

场景 5：做一个“每天抓新论文”的小工具
--------------------

### 需求

每天看最新的 “diffusion model” 论文。

请求可以写成：

```
http://export.arxiv.org/api/query?search_query=all:"diffusion model"&start=0&max_results=10&sortBy=submittedDate&sortOrder=descending
```

然后你的程序可以做：

1.  发请求
2.  解析 XML
3.  取出标题、摘要、PDF
4.  存到数据库
5.  给自己发邮件 / Telegram / 飞书消息

这就是 arXiv API 非常典型的用途：  
**检索公开论文元数据，做提醒、搜索、监控、可视化工具。** 官方 Terms 里也明确鼓励这类用途，比如更好的搜索界面、通知工具、主题可视化。[arXiv信息](https://info.arxiv.org/help/api/tou.html)

* * *

它为什么不像 LLM API 那样要密钥？
---------------------

用最朴素的话说：

### LLM API

你每次请求，服务端都得跑模型推理。  
这是重算力、常计费、强限额的服务，所以通常需要身份认证和 key。

### arXiv query API

你请求的是 **公开论文仓库的检索和元数据**。  
官方目标就是给开发者一个低门槛入口，所以它是：

*   HTTP 接口
*   可直接拼 URL
*   浏览器可访问
*   返回公开元数据和链接 [arXiv信息](https://info.arxiv.org/help/api/basics.html)

这不是“更高级”或者“更低级”，只是服务性质不同。

* * *

你最该避免的 4 个坑
-----------

### 1\. 别用 `response.json()`

因为返回是 **Atom XML**，不是 JSON。[arXiv信息+1](https://info.arxiv.org/help/api/basics.html)

### 2\. 别以为返回的是全文

`<summary>` 是摘要，不是全文；PDF 要从链接单独拿。[arXiv信息+1](https://info.arxiv.org/help/api/user-manual.html)

### 3\. 别疯狂翻页抓取

官方要求 legacy API 最多 **每 3 秒 1 次**，而且 **单连接**。[arXiv信息](https://info.arxiv.org/help/api/tou.html)

### 4\. 别把 `id_list` 和 `search_query` 的逻辑搞混

两者同时给时，是 **交集过滤**，不是并集大杂烩。[arXiv信息](https://info.arxiv.org/help/api/user-manual.html)

* * *

你现在可以怎么用它
---------

最实用的三个方向：

1.  **按关键词搜论文**
2.  **按 arXiv ID 补元数据**
3.  **定时抓某个方向的新论文**

* * *

给你一个更像“上班可用”的成品思路
-----------------

比如你想做一个“AI 论文日报”：

*   关键词：`all:"large language model"`
*   排序：`submittedDate desc`
*   每次抓 20 条
*   去重后只保留新 ID
*   输出成一份 Markdown：

```
标题
作者
摘要前 200 字
PDF 链接
```

这玩意儿本质上已经能用了，而且不用 key，门槛低得像把门锁忘在了门外，但限速还是得守规矩。[arXiv信息+1](https://info.arxiv.org/help/api/basics.html)

我下一条可以直接给你一份 **完整可运行的 Python 脚本**，做“按关键词抓论文并输出成表格/Markdown”。



---
Powered by [ChatGPT Exporter](https://www.chatgptexporter.com)