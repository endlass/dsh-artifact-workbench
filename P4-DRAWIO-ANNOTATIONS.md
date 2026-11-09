# P4.2 drawio 节点级批注契约

> **历史里程碑文档（已归档）**：本文写于对应里程碑开发期，用于并行开发者交接；文中的
> 「Lead / Client 分工」「只改某个文件」等协作约束仅对当时有效，实现细节可能已演进。
> 当前行为以 [README.md](README.md)、[SECURITY.md](SECURITY.md) 与代码为准。

## 数据

- sidecar 仍为 `<file>.workbench/annotations.json`，`format:'drawio'`；
- annotation:
  - `anchor.kind:'drawio-cell'`
  - `anchor.cellId`：mxCell id（稳定，拖拽不变化）
  - `anchor.cellLabel`：选中时的文字快照（最多 300 字）
  - `anchor.page`：drawio 页序号（1 起；bridge 未给时默认 1）
  - `slideIndex` 同步为 `page-1`，`slideId=page`，不参与页图 repair。
- 新建 payload：`{op:'create', cellId, cellLabel, pageIndex, body}`；
- 其余 op（update/resolve/reopen/delete/reply）沿用现有 `/annotations` 协议，按 id 操作；
- `.drawio` 的 annotations 不做页面 repair（节点 id 变了说明节点被删，保留 orphan 状态由后续处理）。

## Editor bridge

- Host 在 serve `editor/index.html` 时注入 `/editor/__dsh-bridge.js`（同源）。
- bridge 捕获 `EditorUi` 实例，监听 graph selection：
  - iframe → parent：`JSON.stringify({event:'dsh-selection', cells:[{id,label,vertex,edge}]})`；
  - parent → iframe：`JSON.stringify({action:'dsh-select', cellId})`，选中并滚动到可见。
- 没有选中时 cells 为空数组。

## Client

- drawio 顶部 bar 增加「批注」按钮（open 数 badge）和右侧窄面板；
- 选中节点后填写批注 → POST `/annotations` create；
- 列表只显示 `format==='drawio'` 的批注；点击条目让编辑器选中对应 cell；
- 支持 resolve/reopen/delete；reply 可选；
- “发送给 dsh”只发送 open 项，格式：
  `节点「label」(cell <id>): body`，带 deck 文件名；
- 不做画布 pin（v1），不做分页/缩略图。

## 验收

- Host 测试：drawio annotations create/read/resolve/delete，不触发页图 repair；
- Client harness：mock bridge selection、create/list/select/send、错误条；
- 真机：选中节点 → 加批注 → 拖动节点 → 批注列表 cell id 不变；发送到输入框。
