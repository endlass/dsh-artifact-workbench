# Artifact Workbench — 规划（2026-11-05 版）

目标：把现有的 `dsh-ppt-workbench` 从“本机 PPT 实验插件”整理成一个可发布的多格式交付物工作台。PPT 的浏览、批注、编辑和自动保存保留；Excel 只预览；PDF 和 H5 报告做批注；流程图同时支持 drawio 与 Mermaid，优先本地渲染。

## 1. 设计原则

- **预览与编辑分开**。只有 PPTX 做结构化编辑；PDF/H5/流程图以“看 + 批 + 发回 dsh”为主。
- **本地优先**。不依赖云端渲染；drawio 用本机 drawio-desktop，Mermaid 渲染器随插件打包或由本机 Host 提供。
- **不破坏 DSH 内置预览**。接管某格式时保留切回内置预览的入口；xlsx 不接管。
- **一条批注侧车，多种锚点**。`<artifact>.workbench/annotations.json` 升级 schema v2，旧批注可读。
- **发布形态从第一天考虑**。包名、许可证、README、示例、CI、兼容审计都进 P2.0，不留到“最后再补”。

## 2. 适配层

```ts
interface ArtifactAdapter {
  id: 'pptx' | 'pdf' | 'html' | 'drawio' | 'mermaid'
  extensions: string[]
  detect(path, bytes): boolean
  preview: 'server-render' | 'iframe' | 'client-render'
  render(ctx): Promise<RenderResult>       // 页图 / HTML 快照
  anchors: AnchorKind[]                    // 支持哪些批注锚点
  editBackend?: EditBackend                // 仅 PPTX（未来可扩展）
  externalOpen?: ExternalOpenSpec          // LibreOffice / drawio
  capabilities(): { edit: boolean; annotate: boolean; previewOnly: boolean }
}
```

`DocumentWorkbench` 负责：

- 右侧栏外壳、加载/刷新状态、批注侧车、发送给 dsh；
- 根据扩展名选择 adapter；
- 把统一的批注 DTO 交给对应 adapter 映射到锚点；
- 保留旧 renderer key 一个版本，迁移期不打断已打开的 tab。

批注 schema v2 的锚点：

- `pptx-shape`：现有 slide + shapeId + 文本/几何；
- `pdf-page`：页号 + 归一化矩形 + 文本摘录；
- `html-dom`：CSS selector + 文本摘录 + 元素包围盒；
- `diagram-image`：渲染图上的归一化矩形；
- `mermaid-node`：节点/边 id + 文本。

## 3. 格式与里程碑

### P2.0 骨架与发布工程

- 抽 `DocumentWorkbench` + `ArtifactAdapter`，先迁现有 PPT 代码。
- 侧车 schema v2 + 迁移；旧批注不丢。
- 包名、目录、LICENSE、README、CHANGELOG、示例文件、测试入口、兼容范围。
- 把 PPT 现有的两个体验项做完：外部 LibreOffice 打开后暂停自动保存、保存后的脏页增量渲染。
- 验收：现有 PPT 功能全回归；插件能在干净 profile 安装；发布工程检查通过。

### P2.1 PDF 批注

- 用现有 LibreOffice Kit 渲染 PDF 页图；页码 + 页内坐标 + 文本摘录。
- 发回 dsh 的指令格式：文件名、页码、坐标、摘录、批注正文。
- 保留“切回内置 PDF 预览”。
- 验收：真实报告 PDF 批注、刷新、发回 dsh 全链路。

### P2.2 H5 报告批注

- 第一步：Host 把 HTML 打印成 PDF（本机 Chrome/Electron），按 PDF 批注；安全、稳定、复用 P2.1。
- 第二步（可选）：静态本地 HTML iframe + 父层 overlay，取选择器、文本摘录、元素包围盒；只允许 workspace 内、agent 生成、默认无外部网络。
- 不做 H5 编辑。
- 验收：一份真实报告 H5 的批注能定位到章节/段落，发送给 dsh 后能按选择器修改。

### P2.3 流程图（drawio + Mermaid）

- drawio：本机装 drawio-desktop；Host 调用本地 CLI 导出 PNG/SVG；先做预览+批注+“在 drawio 中编辑”外部打开；嵌入 diagrams.net 编辑器留待 spike 决策。
- Mermaid：渲染器作为插件资产本地加载；面板内源码编辑 + 实时预览 + 节点级批注。
- 两种格式共用 diagram adapter；先用真实流程图样张验证渲染、缩放、坐标和发回格式。
- 验收：drawio 与 Mermaid 各一份样张可预览、可批注、可发回；本机不依赖云端。

### P2.4 发布

- 清理命名、文档、截图、示例；跑 `dsh-plugin-upgrade-audit` E0–E3。
- 选择分发方式：GitHub Release / npm / DSH 插件市场（如果开放）。
- 发布后保持旧 renderer key 兼容至少一个版本。

## 4. 待定决策

1. 包名：`dsh-artifact-workbench` 或保留 `dsh-ppt-workbench` 扩展；许可证 MIT 还是 Apache-2.0。
2. Mermaid 渲染器：随插件打包（离线、自洽、体积增加约 2–3MB）还是 Host 服务。
3. drawio 嵌入编辑器：P2.3 spike 后决定做或不做；默认只做预览+外部编辑。
4. H5 页面脚本：默认禁止；图表型报告走打印 PDF。
5. 是否保留内置 PDF/HTML 预览作为可切换入口。

## 5. 当前进度

- 已完成：PPTX 浏览/批注/结构化编辑/直接编辑/自动保存/冲突与历史；阶段总结与规划已归档（docs 中心 + 飞书）；灵感池 IDEA-025 已更新范围。
- 未开始：P2.0 骨架、PDF、H5、流程图、发布工程。
- 现有插件仍是 v0.3.0，本规划不改变当前版本行为。
