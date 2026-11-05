# dsh-ppt-workbench

DSH 插件（P4 版本，v0.8.0）：在会话右侧栏的文档预览里，直接打开 dsh 生成的 `.pptx`，浏览幻灯片、添加批注，并把未解决批注一键整理成修改指令发给 dsh。

- 设计与可行性依据：`../research/ppt-workbench/PPT工作台插件-设计方案-20261104.md`
- 下一步规划：`./ROADMAP.md`
- P2 契约：`./P2-CONTRACT.md`
- Client 开发契约：`./CONTRACT.md`
- 编辑契约：`./EDIT-CONTRACT.md`；直接编辑/外部 LibreOffice 契约：`./EDIT-UX-CONTRACT.md`
- 目标环境：macOS + DSH 桌面版 `0.2.1-rc.5`（profile `desktop`）

## 能力（P0）

- **浏览**：`.pptx` 在右侧栏文档 tab 中默认用工作台打开（docx/pdf 等完全不受影响；可从渲染器下拉切回内置 PDF 预览）。缩略图栏 + 纵向连续画布、翻页/缩放、缺字体提示、超过 100 页时提示截断。
- **批注**：批注模式下悬停会高亮元素并显示名称；点击元素精确锚定（选中框可见）；在页面上拖拽可框选多个元素/区域，一次批注多个对象；线程/回复/解决/重新打开/两步删除；三种筛选（未解决/已解决/待重新锚定）。
- **v0.1.1 修复**：批注选择不明确（新增 hover 高亮/选中框/元素名）；新增框选多元素与区域批注。
- **v0.1.2 修复（真机定位）**：缩略图跳转失败的真正原因是宿主在点击的 React 提交期间恢复 scrollport 滚动位置（实测 scrollTop 立即写入 5051、下一拍被重置为 0）；改为双 `requestAnimationFrame` 在提交后写入，真机点击第 5 页已确认画布正确跳转。
- **自动跟随**：dsh 或外部应用改写 `.pptx` 后，文档 tab 自动刷新并重新加载；批注锚点按 `sha → slide_id+shape_id → shape_name → text_sha1 → 几何` 顺序自动修复，修复不了的标成「待重新锚定」，绝不静默删除。
- **结构化编辑（P1）**：工具栏「编辑」模式下点选顶层形状，在底部 inspector 改文本/字号/粗斜体/颜色/位置大小/表格单元格/备注；支持复制/删除/上移/下移/插入空白页；保存走 atomic replace + 单写者锁，支持撤销/重做（硬链快照），外部改写返回 409 冲突且不覆盖。
- **直接编辑（P1.1）**：画布内**双击文本原位编辑**（Esc 取消、⌘/Ctrl+Enter 或 blur 提交）；选中形状直接拖动移动、8 个手柄缩放；inspector 字段 blur/change 自动进草稿；**自动保存**默认开启（1500ms 空闲静默保存，可在编辑栏关闭），保存中/已保存状态可见；手动 ⌘/Ctrl+S 始终可用。
- **外部原生编辑兜底（P1.1）**：编辑栏「在 LibreOffice 中编辑」先保存 pending，再用本机 `/Applications/LibreOffice.app` 打开 deck；外部保存后由现有 revision 机制自动刷新。
- **PDF 工作台（P2）**：`.pdf` 在右侧栏渲染页图，支持点击/区域批注、回复/解决/筛选、发送给 dsh；PDF 只读，不显示编辑/撤销/页操作入口。批注侧车为 `dsh-artifact-annotation@2`，兼容旧版 `@1`。
- **H5 报告批注（P2.2）**：`.html/.htm` 用本机 Chrome headless 打印成 PDF 快照，再走 PDF 页图/批注管线；只读批注，不改 HTML。内置 HTML 预览会被本工作台接管。
- **drawio 内嵌编辑器（P4）**：`.drawio` 不再分页渲染，右侧栏直接嵌入离线 drawio 编辑器（插件自带 Apache-2.0 的 drawio webapp），可拖拽/连线/保存 XML；需要 `webServer` 同源资源路由。
- **Mermaid**：继续用页图和「编辑源码」面板。
- **发送给 dsh**：把未解决批注整理成包含页码、形状引用、批注正文和文件 SHA 的指令，插入 composer（用户确认后发送）；composer 不可用时退回剪贴板。
- **安全边界**：批注写操作只允许在 session workspace 内；workspace 外的 deck 可只读浏览但禁用写操作。

## 安装与使用

已在本机以 linked package 安装（profile `desktop`）：

```bash
# 若需重装/换机器（在 DSH 会话里用 plugin_manager 工具）：
#   action: install_bundle
#   target: <本目录绝对路径>
```

使用：

1. 让 dsh 用 python-pptx 生成 `foo.pptx` 并调用 `present`（或直接产出并给出文件链接）。
2. 点交付卡 / 文件链接 → 右侧栏打开「PPT 工作台」。
3. 点工具栏「批注」→ 点幻灯片落批注；底部抽屉里管理批注。
4. 点「发送给 dsh」把未解决批注插入输入框，确认发送；dsh 改写后画布自动刷新。
5. 点「编辑」→ 双击文字直接改，或拖动/缩放形状；自动保存默认开启，也可 ⌘/Ctrl+S；需要原生交互时点「在 LibreOffice 中编辑」。

## 数据与存储

- 渲染缓存：`~/.dsh/storages/dsh-ppt-workbench/renders/<deck-sha256>/`
- 编辑历史：`<deck>.workbench/history.json` + `history/` 硬链快照（默认 30 条），`edit-tmp/` 与 `edit.lock`。
- 批注侧车：`<deck>.workbench/annotations.json`（与 deck 同目录，agent 可直接 read）
- 运行日志：`~/.dsh/storages/dsh-ppt-workbench/workbench.log`
- 不写 Session 事件；不改任何 shipped 插件；不新增 npm/pip 依赖（渲染用 DSH 自带 LibreOffice Kit，inventory 用 DSH 运行时 Python 的 python-pptx）。

## 自测

```bash
node --check index.js && node --check client.js
node test/host-smoke.mjs     # Host: 渲染/缓存/批注 CRUD/锚点修复（需要设计调研目录里的测试样张）
node test/pdf-smoke.mjs      # PDF 页图/批注/旧 schema 迁移
node test/pdf-http.mjs       # PDF Host 路由/只读保护
node test/html-smoke.mjs     # H5 → PDF 快照 + 页批注
node test/diagram-smoke.mjs  # drawio/Mermaid → PNG + 页批注（含多页）
node test/source-http.mjs   # Mermaid 源码 GET/POST + stale/只读保护
node test/annotation-concurrency.mjs  # 批注侧车并发写/修复写回归
node test/edit-smoke.mjs     # 编辑/undo/redo/冲突
node test/edit-http.mjs      # Host 路由级编辑 + open-native dry-run
```

Host smoke 使用 `research/ppt-workbench/engine/deck/deck-v1.pptx` 与 `deck-v1-lort.pptx`（可用环境变量 `PPT_WORKBENCH_TEST_DECK` / `PPT_WORKBENCH_TEST_DECK_LORT` 覆盖），只写 `/tmp` 与插件缓存目录。

## 已知限制（P4+）

- 只支持顶层形状；组内形状/图片替换/动画/转场/SmartArt/媒体不编辑。
- PDF 文本层选择/搜索未接入；当前批注是页图坐标+区域，文本摘录可选但默认空。
- H5 走打印快照，动态交互/链接/表单会丢失；只适合报告类静态页。
- drawio 最多渲染 30 页；超过会提示截断；drawio 只支持外部编辑。
- Mermaid 源码保存不做语法预校验，渲染失败会回滚源文件；无编辑历史，保留最近 5 份备份。
- 冲突（409）时 Host 会把当前磁盘版本+本次 ops 尽力回放到 `<deck>.workbench/conflict/`，并在冲突 banner 显示副本名；Client 只提供「重新加载（丢弃草稿）」。
- 保存后整份 deck 重新渲染（12 页约 3–4 s），暂未只重渲染脏页。
- LibreOffice 与 PowerPoint 存在版式差异；缺字体只告警不失败。
- 首次打开需先渲染（12 页约 3–4 s）；超大 deck 分页渲染上限 100 页。
- 切换 deck tab 会 remount，未保存草稿的拦截只在同一组件内有效。
- 深色/浅色主题均只用 `--dsw-*` token，但浅色下的视觉自检尚未完成。
- 面板内**没有**内嵌 LibreOffice 原生编辑器：官方 kit 的 native editor 需要 Electron Main/preload + 共享纹理帧转发，属 DSH 主程序级集成；当前用「结构化编辑 + 外部 LibreOffice 打开」两层兜底。
- 双击原位编辑/拖拽缩放按未旋转包围盒处理；拖拽期间 inspector 几何值在 pointerup 后更新。
- 批注写回 PPTX 原生 comments 未做（侧车 JSON 是唯一数据源）。

## 文件结构

```
index.js              Host 半：/api/dsh-ppt-workbench/{deck,slide,annotations,edit,history,undo,redo,open-native,capabilities,health}
client.js             Client 半：document renderer body（浏览/批注/直接编辑/自动保存/外部打开/发送/抽屉）
lib/render.mjs        LibreOffice Kit 渲染队列 + PPTX inventory + PDF 页图编排
lib/artifacts/        Artifact adapter registry（pptx 可编辑 / pdf + html 快照只读批注）
lib/annotations.mjs   批注侧车读写、锚点修复、op 处理
lib/edit-backend.mjs  EditBackend 抽象 + PptxEditBackend（预留官方 editor 后端）
lib/edit_ops.py       11 类白名单编辑 op 的 python-pptx 实现
lib/history.mjs       硬链快照、undo/redo、历史 JSON
lib/deck-lock.mjs     单写者锁（进程内队列 + 锁文件）
lib/inventory.py      python-pptx 结构清单（形状几何/全文/字体/表格/图表/备注）
lib/util.mjs          路径、哈希、原子写、日志
test/host-smoke.mjs   Host 冒烟测试（渲染/批注/修复）
test/annotation-multi.mjs  多元素/区域批注测试
test/edit-smoke.mjs   编辑/undo/redo/冲突测试
test/edit-http.mjs    Host 路由级编辑测试
EDIT-CONTRACT.md      P1 编辑 API/ops 契约
EDIT-UX-CONTRACT.md   P1.1 直接编辑/自动保存/外部 LibreOffice 契约
P2-CONTRACT.md        P2 骨架/PDF/批注 schema v2 契约
CONTRACT.md           Client/Host 契约（开发用）
locale/{zh,en}.json   Plugin Manager 显示元数据
icon.svg              插件图标
```
