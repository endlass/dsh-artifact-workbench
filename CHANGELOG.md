# Changelog

## 0.13.3 — 2026-11-08

- 飞书 docx/wiki 链接支持右键菜单：在 Artifact Workbench 打开 / 在侧栏原生界面打开；非飞书链接不显示。

## 0.13.2 — 2026-11-08

- 原生飞书页优先在新 pane 打开（preferNewPane），保留镜像 tab 可见，便于原生编辑+镜像/评论并排。

## 0.13.1 — 2026-11-08

- 飞书文档加载成功后默认自动在 DSH Browser tab 打开原生页面；头部增加「自动打开原生界面」开关（localStorage 持久化）。

## 0.13.0 — 2026-11-08

- 飞书原生体验：Feishu tab 顶部「侧栏原生打开」直接调用 DSH 内置 browser tab（桌面 Electron webview），可在内登录飞书并使用原生编辑/评论。
- Host 新增 `feishu_doc_read` 工具：读标题/revision/markdown/blocks/comments，供 agent 基于飞书文档和评论继续。

## 0.12.0 — 2026-11-08

- P5.2：飞书评论工作台增强。块级评论（blockId 选择）、30s revision/评论自动刷新（草稿/隐藏暂停）、发送未解决评论给 dsh（inputActions/剪贴板/manual）。
- Host 增加 blocks 解析（DocxXML → heading/paragraph/listItem id+text）。

## 0.11.0 — 2026-11-08

- P5.1：飞书只读工作台。Host `lib/feishu.mjs` 通过 lark-cli 封装 doc fetch/comments/add/reply/resolve；新增右侧栏 `feishu-doc` tab、URL 输入、正文/评论显示、全文评论/回复/解决/重开、在飞书打开。
- Host 新增 feishu-status/doc/comments/comment 路由与 fake-lark-cli 测试；真实飞书 docx 评论闭环已验证。

## 0.10.0 — 2026-11-06

- P4.3：H5 改为原页 iframe（保留 CSS/JS/滚动/交互），不再打印分页快照。
- Host `artifact-url` + 同源 artifact 静态路由（token、1h、目录内、注入 bridge）；html-dom 批注 schema。
- Client：批注模式开关、元素选择、pins、列表定位、发送 dsh。

## 0.9.1 — 2026-11-06

- drawio 批注支持多选（框选/Shift 多选）：一次锚定多个 mxCell，侧栏显示「N 个元素」，点击条目重选全部。
- 未选中任何元素时可直接写「整图批注」，anchor.kind=`drawio-diagram`。
- 修复 Host 未重载导致 drawio 批注 create 走旧页锚点、报 `slideIndex is out of range`。

## 0.9.0 — 2026-11-06

- P4.2：drawio 节点级批注。编辑器 bridge 上报选中 mxCell，右侧批注面板按 cell id 锚定；创建/解决/重开/删除/发送 dsh，不依赖页图坐标。
- Host 新增 drawio 注释 format/`drawio-cell` anchor 与测试。

## 0.8.0 — 2026-11-05

- P4：`.drawio` 改为内嵌离线 drawio 编辑器（vendor Apache-2.0 webapp，webServer 同源资源路由），支持拖拽/连线/保存/冲突保留；不再分页。
- 新增 editor 静态资源路由与 `editor-assets` 测试；source 支持 drawio 读写 `render:false`。

## 0.7.0 — 2026-11-05

- P3：drawio 多页渲染（最多 30 页，逐页 PNG/页锚点）。
- P3：Mermaid 面板内源码编辑（GET/POST source、CAS 校验、原子写、最近 5 份备份、渲染失败回滚）。
- Client 源码抽屉、stale 冲突处理、drawio 多页回归；新增 source-http/diagram 多页测试。

## 0.6.0 — 2026-11-05

- P2.3 流程图预览/批注：`.drawio`、`.mmd/.mermaid` 用本机 draw.io Desktop CLI 渲染为单页图，复用 PDF 页批注管线。
- drawio 工具栏提供「在 draw.io 中编辑」；Mermaid 暂只读。多页 drawio 先渲染第一页并提示截断。
- 新增 drawio/Mermaid fixture 与 diagram smoke test；要求本机安装 draw.io Desktop。

## 0.5.0 — 2026-11-05

- P2.2 H5 报告：本机 Chrome headless 将 `.html/.htm` 打印成 PDF 快照，复用 PDF 页图/批注管线；Client 对 H5 显示「H5 · 只读批注」。
- HTML 批注不改源文件；动态交互/链接/表单不保留。

## 0.4.0 — 2026-11-05

- 抽出 `lib/artifacts/` adapter registry，路由按 `.pptx` / `.pdf` 分派；PPTX adapter 保持原行为。
- 批注侧车升级到 `dsh-artifact-annotation@2`，兼容并自动迁移 `dsh-ppt-annotation@1`。
- 新增 PDF 工作台：LibreOffice Kit 渲染页图、page anchor、页码/区域批注、Host 只读保护。
- Client 注册 `pptx/pdf`，PDF 只读批注模式；PPTX 编辑/自动保存路径不变。
- 发布工程骨架：`PUBLISHING.md`、本 changelog、版本与测试脚本；包名/许可证待定。

## 0.3.0 — 2026-11-04

- P1.1 直接编辑：双击文本原位编辑、拖动/8 手柄缩放、inspector 自动草稿、自动保存、外部 LibreOffice 打开。
- 批注修复写竞态修复（随机临时文件、按 deck 串行化、修复写非致命）。
- 自动保存开关、`⌘/Ctrl+S`、冲突 banner、页操作。
- 真机验证编辑栏与原位编辑。

## 0.2.1 — 2026-11-04

- 修复连续保存后的 `ENOENT rename annotations.json.tmp` 竞态；新增批注并发回归测试。
- 冲突时 Host 生成 `<deck>.workbench/conflict/` 副本，Client 显示副本名。

## 0.2.0 — 2026-11-04

- P1 结构化编辑：文本/字体/几何/备注/表格/图表/页操作。
- 原子保存、单写者锁、硬链快照撤销/重做、冲突校验。
- inventory 扩展全文/字体/表格/图表；缓存版本化。

## 0.1.2 — 2026-11-04

- 修复缩略图跳转：宿主在点击 React 提交期间恢复 scrollport，改为提交后双 `requestAnimationFrame` 写入。
- 真机验证第 5/9/12 页跳转。

## 0.1.1 — 2026-11-04

- 批注 hover 高亮、选中框、元素名；框选多元素/区域批注。

## 0.1.0 — 2026-11-04

- P0 首版：`.pptx` 右侧栏浏览、批注锚定与修复、批注发送给 dsh。
