# dsh-artifact-workbench · Client 半开发契约（P0）

> **历史里程碑文档（已归档）**：本文写于对应里程碑开发期，用于并行开发者交接；文中的
> 「Lead / Client 分工」「只改某个文件」等协作约束仅对当时有效，实现细节可能已演进。
> 当前行为以 [README.md](README.md)、[SECURITY.md](SECURITY.md) 与代码为准。

本文件是 Lead 与 Client UI 实现者之间的契约。**只允许修改 `client.js`**；`index.js`、`lib/**`、`package.json`、locale 文件由 Lead 维护。

## 1. 现状

- Host 半已实现并通过实测：`deck / slide / annotations / health` 路由，LibreOffice Kit 渲染（144dpi PNG），python-pptx inventory，批注侧车 JSON + 锚点修复。
- Client 半当前是 S0 验证版（能注册 renderer、显示占位内容、跑探针）。P0 要把它替换成真正的工作台 UI。
- 客户端插件已经注册并能默认接管 `.pptx`（S0 已验证，见当时的开发日志）。app 里已有一个打开的 `.pptx` 预览 tab，Client 代码更新后 HMR 会热替换、body 会重新挂载。

## 2. 技术约束（硬性）

- `client.js` 是**普通浏览器脚本**，必须保持 `window.__ModuleLoader__.load({ id: 'dsh-artifact-workbench', factory(require) { ... } })` 结构；`require('react')` 拿 React 18，用 `React.createElement`（不要 JSX、不要 ESM import、不要构建步骤）。
- 不 import 任何 `@deepseek-ai/*` 包；不新增 npm 依赖。
- 视觉只用宿主主题 token（`--dsw-*`，如 `--dsw-alias-bg-base`、`--dsw-alias-label-primary`、`--dsw-alias-border-secondary`、`--dsw-alias-label-secondary`、`--dsw-alias-label-tertiary`、`--dsw-alias-state-error-primary`），必须同时适配亮/暗主题；不要写死深色背景。
- 可见文案走字典：`ctx.locale.register('dsh-artifact-workbench', { zh: {...}, en: {...} })`，组件内用注入的 `props.t`（注册 slot 时已带 `locale: NS`）。
- 组件收到的关键 props：
  - `resourceAddress`：`dsh-resource://file/session/<sessionId>/<encoded path>`（绝对路径时 path 保留前导 `/`）
  - `content`：`{ kind:'renderer', revision, loaded(version), failed(), reload() }`
  - `useTabInfo()`：返回 `{ tab: { id, contentId, navigation, signal, actions }, sidebar, panel }`
  - `inputActions`：composer 输入动作（见 §4.6）
  - `sessionId`：标准 prop
  - `useResource(address)`：可选
- 渲染器注册与 body 注册保留现有写法（`ctx.documentPreviews.register` + `ctx.slots.register` 到 `sidebar.right.tab.document`，key=`dsh-artifact-workbench/pptx`）。
- `content` 契约：mount 后加载成功调用 `content.loaded(versionString)`；失败调用 `content.failed()`；`content.revision` 变化时取消旧请求并重新加载（degrade gracefully，不要整页崩）。
- 不改 `index.js`/`lib/**`；不调用 plugin_manager；不重启 app。改完 `node --check client.js` 必须通过。

## 3. 数据契约（Host `/api/dsh-artifact-workbench/*`，均已实现）

同源调用：`new URL('api/dsh-artifact-workbench/<path>', document.baseURI)`。桌面页面 baseURI 是 `dsh-app://app/`，已实测可 fetch（必须走 `document.baseURI`，不要写死 127.0.0.1）。`credentials: 'include'`。

### 3.1 `GET deck?sessionId=<sid>&path=<path>`

`path` 为 `resourceAddress` 解码出的路径（绝对或相对）。成功响应（字段可能多、以下确保存在）：

```json
{
  "ok": true,
  "deck": {
    "path": "/abs/path/deck.pptx",
    "sha256": "64 hex",
    "slideCount": 12,
    "renderedPages": 12,
    "dpi": 144,
    "slideWidthEmu": 12191695,
    "slideHeightEmu": 6858000,
    "missingFonts": ["思源黑体 CN"],
    "renderMs": 3046,
    "renderCached": false,
    "truncated": false,
    "writeAllowed": true,
    "displayPath": "...",
    "pages": [
      { "page": 1, "index": 1, "width": 1920, "height": 1081,
        "rectangle": { "x":0,"y":0,"width":1920,"height":1080.09 }, "file": "page-0001.png" }
    ]
  },
  "slides": [
    { "index": 0, "slideId": 256, "notes": "...", "textSha1": "...",
      "shapes": [
        { "shapeId": 2, "name": "Title 1", "type": "PLACEHOLDER (14)",
          "isPlaceholder": true, "left": 685800, "top": 2130425,
          "width": 7772400, "height": 1470025, "rotation": 0,
          "hasText": true, "textPreview": "标题文本", "textSha1": "...",
          "groupPath": [] }
      ] }
  ],
  "annotations": [ /* 见 §3.3，内嵌当前 deck 的全部批注 */ ],
  "annotationsRepair": { "repaired": 0, "orphaned": 0, "items": [] }
}
```

- `pages[i].page` 是 1-based；`slides[i].index` 是 0-based。
- 形状 EMU 坐标是**页面绝对坐标**；归一化 = left/slideWidthEmu 等。组内子形状已在 inventory 扁平化（bbox 已换算），`groupPath` 仅作提示。
- 大 deck 只渲染前 100 页（`truncated:true`），UI 提示即可。

错误形态：`{ ok:false, code, message }`，HTTP 4xx/5xx。常见 `session-not-live`、`not-found`、`unsupported-format`、`outside-workspace`。

### 3.2 `GET slide?sha=<deck.sha256>&page=<1-based>`

返回 `image/png` 字节。客户端用 `fetch` 拿 `arrayBuffer` → `Blob` → `URL.createObjectURL`，按 `sha:page` 缓存在内存；deck 变化/卸载时 `revokeObjectURL`。

### 3.3 批注数据结构（客户端只读展示 + 提交）

```json
{
  "id": "uuid",
  "slideId": 265,
  "slideIndex": 9,
  "slideTextSha1": "...",
  "anchor": {
    "shapeId": 3, "shapeName": "EDIT-TEXT", "textSha1": "...",
    "bboxEmu": { "left": 731520, "top": 1280160, "width": 4572000, "height": 822960 },
    "rotation": 0,
    "pointNorm": { "x": 0.12, "y": 0.26 },
    "groupPath": []
  },
  "body": "请核对这里的数字",
  "author": { "id": "local", "name": "我" },
  "createdAt": "ISO",
  "updatedAt": "ISO",
  "status": "open",
  "resolvedAt": null,
  "replies": [ { "id":"uuid","body":"...","author":{"id":"local","name":"我"},"createdAt":"ISO" } ],
  "history": [ ... ]
}
```

- `status`: `open | resolved | orphaned`。orphaned = 锚点在文件变化后找不到，UI 必须显示「待重新锚定」而不是隐藏/删除。
- pin 的位置优先用 `anchor.pointNorm`；没有则用 bbox 中心。
- 点击页面创建批注时，若命中某个形状（点落在形状 bbox 内，可忽略旋转），提交 `shapeId`；否则只提交 `pointNorm`。

### 3.4 `POST annotations`

请求体：

```json
{ "sessionId": "sid", "path": "/abs/deck.pptx", "op": "create",
  "slideIndex": 9, "shapeId": 3, "pointNorm": {"x":0.4,"y":0.5},
  "body": "文字", "author": {"id":"local","name":"我"} }
```

- `op`: `create | update | resolve | reopen | reply | delete`
  - create：需要 slideIndex/pointNorm/body（shapeId 可选）
  - update：`{ id, body }`
  - resolve / reopen / delete：`{ id }`
  - reply：`{ id, body }`
- 成功响应：`{ ok:true, deckSha, annotations:[全量], annotationsRepair }`。用返回的全量替换本地状态。
- `writeAllowed:false`（deck 在 workspace 外）时 UI 禁用写操作并提示。

## 4. UI 需求（P0 验收口径）

### 4.1 生命周期

- body mount → 解码 `resourceAddress` 得到 path，用 `sessionId` + path 拉 `deck`。
- 加载中：骨架/加载态（页面占位 + 「正在渲染幻灯片…」；Host 首次渲染约 3–4 s，热缓存 <100 ms）。
- `content.revision` 变化 → 重新拉 deck（先保留旧内容，顶部显示刷新中）；成功后 `content.loaded('deck-' + sha)`。
- deck sha 变化导致批注被修复时，顶部显示可关闭的提示条：`N 条批注已自动跟随，M 条待重新锚定`。
- 错误态：显示 code/message + 「重试」按钮；`content.failed()` 只在首屏彻底失败时调用（避免误报）。
- 顶部 `missingFonts` 非空时显示警告 chip（悬浮/展开列出字体名，提示版式可能与 PowerPoint 不同）。

### 4.2 布局（右侧栏宽度约 360–700px，必须响应式）

```
┌───────────────────────────────────────────────────────────┐
│ 工具栏：幻灯片 3/12  [◀][▶]   [适配][100%]  [批注]  [发送给 dsh] │
├────────┬──────────────────────────────────────────────────┤
│ 缩略图  │  可滚动画布：逐页 <img> + 批注 pin 覆盖层            │
│ 1      │                                                  │
│ 2      │                                                  │
│ 3 ●    │                                                  │
├────────┴──────────────────────────────────────────────────┤
│ 批注抽屉（可折叠）：未解决/已解决/待重新锚定 列表 + 线程     │
└───────────────────────────────────────────────────────────┘
```

P0 实现建议（可按实际宽度调整，但功能必须齐全）：

- 缩略图左栏宽 84–100px，懒加载；点击跳到对应页；当前页高亮。宽度 < 520px 时自动隐藏缩略图（提供展开按钮）。
- 画布：页面纵向排列（每页 `img` 宽度 = 内容宽度，`max-width:100%`），页面间 10px 间距；点击缩略图/工具栏箭头滚动到对应页。
- 批注 pin：绝对定位在每页容器上，位置由 `pointNorm` 换算；数字/圆点样式用主题色；点击选中批注并打开线程。
- 批注模式开关：开启后点击页面创建批注（弹出小编辑器：textarea + ⌘/Ctrl+Enter 保存 + 取消）。工具栏按钮有明显的开启态。
- 批注抽屉：三个筛选（未解决 / 已解决 / 待重新锚定），每条显示页码、引用文本（形状 textPreview 或 body）、作者时间、正文、回复与操作（解决/重新打开/回复/删除）。选中时同步滚动到 pin 并高亮。
- `Send to dsh`：仅当存在未解决批注时可用；生成如下格式文本后调用 composer 插入（见 §4.6），并 toast 提示「已插入输入框，请确认后发送」：

```text
请按以下批注修改 `deck.pptx`（共 3 条，文件 SHA 7f3a…）：
1. 第 3 页「标题文本」：批注正文
2. 第 5 页：批注正文（未锚定形状）
...
修改后请保持其他页内容不变，并重新 present。
```

- 空状态：没有批注时抽屉给一句提示；没有 deck 数据时显示错误/加载。
- 响应式：容器宽度变化（ResizeObserver）自动隐藏缩略图/抽屉；不要溢出横向滚动。

### 4.3 主题 / 字体

- 只用 `--dsw-*` token；滚动条容器用 `overflow:auto`；亮/暗主题下对比度可读。
- 中文字体用 `var(--dsw-alias-font-family, inherit)`，代码用 `--dsw-alias-font-family-code`（若不存在则 fallback monospace）。
- 所有按钮 `<button type="button">`，带 `aria-label`/`title`；不要用 div 当按钮。

### 4.4 图片加载

- 并发 fetch 每页 PNG；按需懒加载（IntersectionObserver 或先加载首 3 页再后台补齐）。
- 建 `Map<sha|page, blobUrl>`；deck sha 变化时 revoke 全部旧 URL。
- fetch 失败的单页显示占位（页号 + 重试），不要阻塞其它页。

### 4.5 批注命中形状（可选但建议）

用 `slides[i].shapes` 的 EMU bbox 做点命中（页面坐标可选：点击落在哪个页，再换算到 EMU；点落在形状 bbox 内取最上层，按数组倒序）。命中则提交 `shapeId`，否则只提交 `pointNorm`。旋转形状 P0 可忽略（bbox 近似）。

### 4.6 发送到 composer

组件 props 有 `inputActions`。按宿主对话包 README 的语义：

```js
const span = props.inputActions.captureInsertion();
props.inputActions.insertText(text, span);
```

用 try/catch；失败时退回 `navigator.clipboard.writeText(text)` 并 toast「已复制，粘贴到输入框即可」；再失败则把文本显示在提示里。

## 5. 自测与交付

- `node --check client.js` 必须通过。
- 改完后 HMR 会热替换；app 里已打开一个 pptx 预览 tab，会自动拉 deck。Host 日志在 `~/.dsh/storages/dsh-artifact-workbench/workbench.log`（deck open / annotation 行），可以用来确认请求是否成功。
- 不要尝试安装/重启插件；Host 半已就绪。
- 交付：更新后的 `client.js` + 一段自测说明（实现了哪些交互、已知缺口、未验证项）。**视觉验收由 Lead 负责**（你无法截图），但代码必须逻辑自洽、错误路径完整。

## 6. 已知实现提示

- 解码 `resourceAddress`：`dsh-resource://file/session/<sid>/<encodedPath>`；`encodedPath` 按 `/` 分段 `decodeURIComponent`，保留前导空段（绝对路径）。可直接复用现有 client.js 里的 `decodeFilePath`。
- `props.t` 已绑定命名空间；字典 key 自定（如 `toolbar.annotate`、`drawer.empty`）。
- 防重入：create 提交时禁用按钮；成功后用响应里的全量 annotations 覆盖。
- 别整页监听全局事件；只用组件内 effect 并清理。
