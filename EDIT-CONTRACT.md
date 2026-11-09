# dsh-ppt-workbench · P1 编辑契约（Host 已实现 / Client 待实现）

> **历史里程碑文档（已归档）**：本文写于对应里程碑开发期，用于并行开发者交接；文中的
> 「Lead / Client 分工」「只改某个文件」等协作约束仅对当时有效，实现细节可能已演进。
> 当前行为以 [README.md](README.md)、[SECURITY.md](SECURITY.md) 与代码为准。

本文件是 P1（结构化编辑）的实现契约。**Client 实现者只改 `client.js`**；`index.js`、`lib/**`、`package.json`、`EDIT-CONTRACT.md` 由 Lead 维护。

## 1. 总原则

- 编辑后端是 **python-pptx**（DSH 运行时 Python），不是 LibreOffice 回写（会破坏 shape id/run/转场，见 engine-findings §5.2）。
- 编辑层抽象为 **EditBackend**：当前 `pptx` 后端；未来官方 `@deepseek-ai/libreoffice-kit/editor` 落地后可作为第二后端，Client API 不变。
- 保存必须：单写者、sha 校验、temp→fsync→rename、保存前硬链快照；支持 undo/redo；外部改写返回 409，不覆盖。
- 批注侧车不因编辑丢失：编辑改变 deck sha 后，打开/保存响应会返回修复后的批注。
- P1 v1 只支持**顶层形状**（`groupPath` 非空的组内形状不可编辑）；表格/图表仅通过专用 op 编辑。

## 2. `GET deck` 新增字段（inventory 扩展）

`slides[i].notes` 已有。每个 shape 新增（旧字段保留）：

```json
{
  "shapeId": 3, "name": "Title 1", "type": "PLACEHOLDER (14)",
  "left": 731520, "top": 1280160, "width": 4572000, "height": 822960,
  "rotation": 0, "hasText": true, "textPreview": "…",
  "text": "完整文本（≤4000 字符）",
  "paragraphCount": 2,
  "font": { "sizePt": 20.0, "bold": false, "italic": false, "color": "1A1A1A" },
  "editable": true,
  "groupPath": [],
  "hasTable": true,
  "table": { "rows": 6, "cols": 4, "cells": [["A1","B1"],["A2","B2"]] },
  "hasChart": true,
  "chart": { "categories": ["Q1","Q2"], "series": [{"name":"营收","values":[1.2,1.3]}] },
  "hasPicture": false
}
```

- `editable=false` 的情况：组内形状（`groupPath.length>0`）、图片、图表/表格（它们有专用编辑路径，UI 可只读展示或走专用表单）。
- 表格 `cells` 最多 12×8；图表 series 最多 6 条、每类最多 24 点；超限截断。
- `deck.history` 字段：`{ "version": 3, "cursor": 3, "canUndo": true, "canRedo": false }`（列表用 `/history` 单独取）。

## 3. 编辑 API（`/api/dsh-ppt-workbench/*`）

所有请求同源 fetch、`credentials:'include'`，body JSON；错误形态 `{ok:false,code,message,...}`。

### 3.1 `POST edit`

```json
{
  "sessionId": "sid",
  "path": "/abs/deck.pptx",
  "baseSha": "64 hex（Client 当前 deck 的 sha256）",
  "ops": [ { "op": "setText", "slideIndex": 9, "shapeId": 3, "text": "新标题" } ]
}
```

成功响应（结构同 `GET deck`，额外含 `edit`）：

```json
{
  "ok": true,
  "deck": { /* 同 GET deck，sha 已更新，页图新 sha */ },
  "slides": [ /* 新 inventory */ ],
  "annotations": [ /* 修复后的批注 */ ],
  "annotationsRepair": { "repaired": 0, "orphaned": 0, "items": [] },
  "edit": {
    "oldSha": "…", "newSha": "…", "opsApplied": 1, "warnings": [],
    "history": { "version": 4, "cursor": 4, "canUndo": true, "canRedo": false }
  }
}
```

- 409 `stale`：文件已被外部修改；响应含 `currentSha` 与可选 `conflictCopy`（Host 已把当前磁盘版本+本次 ops 尽力回放到 `<deck>.workbench/conflict/`）。Client 必须提示「文件已被外部修改」并提供「重新加载（丢弃草稿）」；不自动覆盖。
- 422 `bad-op`：某条 op 参数不合法，`opIndex` 指出第几条；整个 batch 原子失败，文件不动。
- 403 `outside-workspace`；404 `not-found`；413 `too-large`；500 `edit-failed`（含 message）。

### 3.2 Ops v1（白名单；一次 1–100 条）

| op | 参数 | 说明 |
|---|---|---|
| `setText` | slideIndex, shapeId, text(≤4000) | text frame 全文替换；按 `\n` 分段，保留首段首 run 字体；表格/图表拒绝 |
| `setFont` | slideIndex, shapeId, sizePt?, bold?, italic?, color?（`RRGGBB`） | 应用于该形状全部 run |
| `setShapeBox` | slideIndex, shapeId, left?, top?, width?, height?（EMU int） | 只改提供的字段 |
| `setNotes` | slideIndex, text(≤10000) | 演讲者备注 |
| `setTableCell` | slideIndex, shapeId, row, col, text(≤1000) | 表格单元格 |
| `setChartData` | slideIndex, shapeId, categories[str], series[{name?,values[number]}] | 原生图表数据替换 |
| `deleteShape` | slideIndex, shapeId | 删除顶层形状 |
| `duplicateSlide` | slideIndex | 复制页（含图片关系/备注；不复制转场） |
| `deleteSlide` | slideIndex | 删除页 |
| `moveSlide` | slideIndex, toIndex | 重排页 |
| `insertSlide` | afterIndex（-1 表示插到最前） | 插入空白页（Blank layout 或回退首个 layout） |

- EMU 与英寸换算：`1 in = 914400 EMU`；Client 显示用英寸（保留 2–3 位小数）。
- 不支持：图片替换、动画/转场、SmartArt、媒体、主题字体；遇到只读字段直接不提供 UI。

### 3.3 `GET history?sessionId&path`

```json
{ "ok": true, "version": 4, "cursor": 4, "canUndo": true, "canRedo": false,
  "items": [ { "version": 1, "sha": "…", "ts": "ISO", "opCount": 0 } ] }
```

### 3.4 `POST undo` / `POST redo`

body：`{ "sessionId", "path" }`。成功响应结构同 `POST edit`（`edit.history` 更新，`edit.opsApplied=0`）。
- 若当前文件 sha 与 history 当前位置不一致 → 409 stale，不覆盖。
- 无可撤销/重做 → 409 `no-history`。

### 3.5 错误提示建议

| code | Client 行为 |
|---|---|
| stale | 顶部红色 banner「文件已被外部修改」+ 按钮「重新加载」；保留 pending ops? 丢弃并提示 |
| bad-op | toast 显示 message + opIndex，保留 pending ops |
| outside-workspace | 只读 banner，禁用编辑 |
| edit-failed | toast + 保留 pending ops、可重试 |
| no-history | 禁用按钮 |

## 4. Client UI 需求（P1）

目标：右栏宽度 360–900px 可用；不破坏 P0 的浏览/批注/发送能力。

### 4.1 模式

- 工具栏：`[批注] [编辑]` 两个互斥开关（也可保留「浏览」态，即都不开）。
- 进入编辑模式：画布 hover 高亮 + 点击选中形状（复用 P0 的包围盒/名称 chip 逻辑）；不再创建批注。
- 退出编辑模式时若有未保存 ops：弹确认（「保存 / 放弃 / 取消」），不得静默丢失。
- 批注模式行为保持 P0 不变。

### 4.2 选中与属性面板

- 选中顶层形状后显示属性面板（建议放在底部抽屉，复用 `.wb-drawer` 区域；也可右侧浮层）：
  - 头部：形状名、类型、`可编辑/只读` 徽标；
  - 文本：textarea（shape.text），字数上限 4000；
  - 字体：字号（number，pt）、粗体/斜体（toggle）、颜色（`<input type=color>` + hex 文本）；
  - 位置/大小：left/top/width/height（number，英寸，step 0.01）；
  - 「应用到草稿」按钮：把该形状当前字段差异转成 ops 追加到 pendingOps，并更新本地显示值；
  - 表格形状：显示行×列表格输入，Apply 生成 `setTableCell`；图表形状：只读展示 data（P1 不做图表编辑 UI，可用文本表单后续）。
  - 幻灯片备注：未选中形状时显示当前页 notes textarea，Apply 生成 `setNotes`。
- 选中形状的包围盒/名称 chip 与 P0 一致；草稿修改后可在面板显示「待保存」标记。

### 4.3 页面操作

- 编辑模式下提供页面操作（工具栏「页面」菜单或面板按钮）：复制当前页、删除当前页（二次确认）、上移/下移、插入空白页。
- 页操作建议**立即**调用 `POST edit`（单条 op），成功后替换 deck；失败提示并保留状态；页操作会重置选中状态。

### 4.4 保存 / 撤销 / 重做

- 底部/工具栏显示 `保存`（primary）、`撤销`、`重做`；`⌘/Ctrl+S` 保存。
- 保存：`POST edit {baseSha: deck.sha256, ops: pendingOps}`；成功后用响应替换 deck/slides/annotations/history，清空 pendingOps；显示 toast「已保存」。
- 保存中禁用按钮并显示进度；失败按 §3.5 处理。
- 撤销/重做：调用 `/undo` `/redo`；成功后替换 deck；注意 pendingOps 必须先保存或丢弃（按钮在 pending 非空时禁用并提示）。
- deck 变化（外部刷新）时 pendingOps 处理：若 baseSha 已过期，保留草稿并提示冲突；不得直接丢。

### 4.5 历史状态

- 打开 deck 时根据 `deck.history` 或 `GET history` 设置撤销/重做可用性；每次 edit/undo/redo 后更新。
- 不要求展示完整历史列表；可选 tooltip 显示版本号。

### 4.6 图片/渲染

- 保存成功后 deck sha 变化 → 页面 PNG 全部换新；沿用现有 useSlideImages 缓存逻辑（按 sha 隔离、旧 Blob URL revoke）。
- 保存期间保留旧画布，顶部进度条；不要整页白屏。

## 5. 开发与验证

- 只改 `client.js`；`node --check client.js` 必须通过。
- 可用本地 harness：本地 Playwright harness（未随仓库分发）（Playwright + mock Host）当前只 mock 了 GET deck/slide/annotations；实现时请同步扩展 mock `/edit` `/undo` `/redo` `/history`，并覆盖：
  1. 进入编辑模式选中形状 → 改文本/字号/几何 → Apply → pending 标记；
  2. Save 发出正确 ops（baseSha、slideIndex、shapeId、字段）；
  3. 保存后 deck sha 更新、pending 清空、drawer 显示新值；
  4. 页操作：复制/删除/上移/插入各发对应 op；
  5. 撤销/重做按钮状态与调用；
  6. stale 409 显示冲突 banner 且不覆盖；
  7. 退出编辑模式时未保存确认。
- 真机验收由 Lead 负责；完成后跑 `node --check` + harness 测试并把结果写进完成消息。
- 不要改 Host 文件，不安装/重启插件，不调用 plugin_manager。
