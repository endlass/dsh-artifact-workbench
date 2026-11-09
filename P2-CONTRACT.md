# P2 契约：Artifact Workbench 骨架 + PDF 工作台

> **历史里程碑文档（已归档）**：本文写于对应里程碑开发期，用于并行开发者交接；文中的
> 「Lead / Client 分工」「只改某个文件」等协作约束仅对当时有效，实现细节可能已演进。
> 当前行为以 [README.md](README.md)、[SECURITY.md](SECURITY.md) 与代码为准。

日期：2026-11-05。P2.0（骨架/schema）、P2.1（PDF 预览+批注）、P2.2（H5 报告快照批注）与 P2.3（流程图预览/批注）。**Client 只改 `client.js`（Lead 负责 Host/lib/契约）**。

## 1. Host 路由保持不变

继续使用 `/api/dsh-artifact-workbench/{deck,slide,annotations,edit,history,undo,redo,open-native,health}`，避免已打开 tab 失效。路径支持 `.pptx` 与 `.pdf`；由内部 `ArtifactAdapter` 分派。

## 2. `GET deck` 的通用字段

新增/明确：

```json
{
  "deck": {
    "path": "…", "sha256": "…", "format": "pptx" | "pdf",
    "editable": true/false,
    "slideCount": 12, "renderedPages": 12, "truncated": false,
    "slideWidthEmu": 12191695, "slideHeightEmu": 6858000,
    "missingFonts": [], "writeAllowed": true,
    "pages": [ { "page": 1, "index": 1, "width": 1920, "height": 1081, "rectangle": {"x":0,"y":0,"width":1280,"height":720.07} } ]
  },
  "slides": [ ... ],
  "annotations": [ ... ],
  "annotationsRepair": { "repaired": 0, "orphaned": 0, "items": [] }
}
```

- `format:'pptx'`：沿用现有 slides（有 shapes、可编辑）。
- `format:'pdf'`：每页一个 slide 对象，**shapes 为空数组**，`notes:''`，无 `textSha1` 语义；`editable:false`。`slideWidthEmu/slideHeightEmu` 由页面 rectangle 换算（96dpi px → EMU 9525/px，按第一页取）。
- PDF 页数上限 100；超过时 `truncated:true`。

## 3. 批注 schema v2

新 schema：`dsh-artifact-annotation@2`；旧 `dsh-ppt-annotation@1` 必须可读并自动迁移，不丢批注。

顶层新增：`format: 'pptx' | 'pdf'`。

每条 annotation 新增：`format`；`anchor.kind`：

- `pptx-shape`：现有形状锚点（shapeId/name/textSha1/bbox/pointNorm/groupPath/relatedShapes）。
- `pdf-page`：`kind:'pdf-page'`，`page: 1-based`，`rectNorm: {x,y,w,h}`（可为空表示点击点），`pointNorm:{x,y}`，`textQuote?: string`。

`create` payload 新增可选 `format`，Host 按 deck format 归一。PDF 的 create 至少带 `slideIndex` + `pointNorm`，或 `bboxNorm`；`shapeIds` 为空。

修理规则：

- PDF：按 `anchor.page` 找页；页存在则保留，页不存在或页码越界 → orphaned，不删除；有 `rectNorm/label` 的按页近似。
- PPT：现有 6 级规则不变。
- 旧 v1 批注迁移时补 `format:'pptx'`、`anchor.kind:'pptx-shape'`，其余字段不变。

## 4. Client（只改 `client.js`）

### 4.1 注册

- document preview 扩展名改为 `['pptx','pdf']`，priority `extension`。
- 读 `deck.format`；`editable === false` 时：
  - 隐藏/禁用「编辑」按钮与编辑栏、自动保存、undo/redo、页操作；
  - 只保留「批注」「发送给 dsh」、翻页/缩放/缩略图；
  - 不调用 `/edit`、`/history`、`/undo`、`/redo`、`open-native`。
- `.pptx` 行为保持现有（P1.1）。

### 4.2 PDF 批注交互

- PDF 页没有 shapes：annotate 模式点击页面 → 草稿带 `pointNorm`（自由批注）；拖拽 → `bboxNorm`（区域批注）。
- pin 位置用 annotation 的 `pointNorm`（无则 rect 中心）；选中框用 `rectNorm` 或点标记。
- 批注列表、回复、解决、筛选、发送给 dsh 与 PPT 共用。
- 发送给 dsh 的文本对 PDF 用“页码 + 区域/点 + 原文摘录（如有）”，不要出现形状名/形状几何。
- 文本层选择先不做；PDF 文本摘录留空即可。
- 内置 PDF 预览被本渲染器接管；P2 先接受，后续再加切回入口。

### 4.3 文案

- 页面标题/aria 可用「文档工作台」，但不要大改现有样式；deck.format 为 pdf 时可显示「PDF · 只读批注」徽标。
- zh/en 字典补必要键。

## 5. 测试

- Host：PPT 全量回归（现有 5 个 test + edit-http）；PDF 新增测试：渲染页数、format/editable、annotations create（点/区域）、schema v2 文件、v1 迁移、页越界 orphaned。
- Client harness：mock PDF deck（shapes 空、format pdf、editable false），验证：
  1. 编辑按钮隐藏/禁用，批注/发送保留；
  2. 点击页面创建自由批注、拖拽创建区域批注；
  3. 保存后 pin/列表/发送文本正确；
  4. PPT 回归不退化。
- `node --check client.js`；Lead 做真机 PDF tab 验收。

交付：只改 client.js（可改 本地 Playwright harness（未随仓库分发）），不要动 Host/lib/locale/package，不要调用 plugin_manager。


## 6. P2.2 H5 报告（v0.5.0）

- `.html/.htm` 由 Host 用本机 Chrome headless 打印成 PDF 快照（缓存 `<artifact-sha>/source.pdf`），再走 PDF 页图/批注管线。
- `deck.format='pdf'`、`sourceFormat='html'`、`editable=false`、`snapshot=true`；Client 显示「H5 · 只读批注」，不提供编辑。
- 批注锚点沿用 `pdf-page`；侧车在源 HTML 同目录，格式字段为 `pdf`。
- 只支持报告类静态页；动态交互、链接、表单不保留。Chrome 路径可用 `ARTIFACT_WORKBENCH_CHROME` 覆盖。


## 7. P2.3 流程图（v0.6.0）

- `.drawio`、`.mmd/.mermaid` 由 Host 调用本机 draw.io Desktop CLI 渲染成 PNG（scale 2, border 8）。
- `deck.format='pdf'`、`sourceFormat='drawio'|'mermaid'`、`editable=false`；Client 显示「drawio/Mermaid · 只读批注」。
- 页面锚点沿用 `pdf-page`；批注侧车在源文件同目录。
- drawio：工具栏「在 draw.io 中编辑」外部打开；保存后靠 revision 刷新。
- Mermaid：当前只读预览+批注，源码编辑下一阶段。
- 当前只渲染第一页；多页 drawio 会提示截断。draw.io 路径可用 `ARTIFACT_WORKBENCH_DRAWIO` 覆盖。
