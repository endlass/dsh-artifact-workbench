# P4.3 H5 原页 iframe + 交互批注契约

> **历史里程碑文档（已归档）**：本文写于对应里程碑开发期，用于并行开发者交接；文中的
> 「Lead / Client 分工」「只改某个文件」等协作约束仅对当时有效，实现细节可能已演进。
> 当前行为以 [README.md](README.md)、[SECURITY.md](SECURITY.md) 与代码为准。

目标：`.html/.htm` 不再打印成 PDF 分页快照；原始页面在 iframe 中运行（CSS/JS/滚动/交互保留），批注层可选开启，按 DOM 元素锚定。

## Host

- `webServer` prefix `/plugins/dsh-artifact-workbench/artifact`。
- `GET /artifact-url?sessionId&path` -> `{ok,url,title}`；`url` 是 `/plugins/dsh-artifact-workbench/artifact/<token>/<basename>`，token 随机、1h、只映射 HTML 所在目录。
- 静态服务保留相对资源（css/js/img）；HTML 响应注入 `/__dsh-bridge.js`（同源相对路径），其他文件原样。
- 安全：仅 token 范围内、目录穿越拒绝、只接受 session workspace 内文件。
- 批注 format=`html`，anchor.kind=`html-dom`：
  - `selector`（CSS 路径，尽量稳定）
  - `textQuote`（元素文字快照，≤500）
  - `xNorm`（0..1，viewport 宽度归一）
  - `yNorm`（0..1，文档高度归一，含 scrollY）
  - `scrollY`、`tag`、`page=1`
  - 不参与页图 repair。
- POST `/annotations` create payload：`{op:'create', selector, textQuote, xNorm, yNorm, scrollY, tag, pageIndex:0, body}`；无选择时允许空 selector = 页面整体批注。

## Bridge（iframe 内）

iframe → parent（JSON string）：
- `{event:'dsh-html-ready', scrollHeight, scrollY, viewportWidth, viewportHeight, title}`
- `{event:'dsh-html-scroll', scrollY, scrollHeight}`
- `{event:'dsh-html-pick', selector, textQuote, xNorm, yNorm, scrollY, viewportWidth, viewportHeight, tag}`

parent → iframe：
- `{action:'dsh-html-annotate', on:boolean}`
- `{action:'dsh-html-scroll-to', yNorm:number}`

行为：
- 默认不拦截任何点击/滚动，原页面照常；
- annotate 开启时 capture click：找最近可见元素，阻止默认，生成 selector/textQuote/坐标并上报；
- 只监听本层 parent。

## Client

- `deck.sourceFormat==='html'` 时不再显示分页/缩略图/页图批注；整块 iframe 原页。
- 顶部 bar：「批注模式」开关、「批注」面板（窄，右侧 overlay）、可回到原浏览。
- bridge ready 后显示页面；滚动时更新当前 scrollY、pins 位置。
- annotate 模式点击元素 -> 草稿 {selector,textQuote,xNorm,yNorm,scrollY,tag}；面板填内容 -> POST annotations create；失败保留草稿。
- 列表只显示 format html；点条目 -> iframe scroll 到 yNorm；resolve/reopen/delete；「发送给 dsh」只发 open，格式 `网页元素「selector / textQuote」: body`。
- pins：在父层 overlay 按 yNorm*scrollHeight - scrollY 定位；仅可视区域显示；点击 pin 选中批注并滚动。没有分页。
- 其他格式零改动。
- zh/en；仅 require('react')、无 JSX/新依赖。

## 验收

- Host：artifact token/相对资源/路径穿越/bridge 注入；html annotations create/read/resolve/delete。
- Client harness：iframe 原页 mock、bridge ready/scroll/pick、批注创建/列表/滚动/发送、非 html 不受影响、无分页/页图请求。
- 真机：打开 HTML 报告，原脚本/滚动正常；开批注模式点元素加批注；退出批注模式恢复交互。
