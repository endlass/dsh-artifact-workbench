# P4 契约：drawio 内嵌编辑器（替换分页视图）

> **历史里程碑文档（已归档）**：本文写于对应里程碑开发期，用于并行开发者交接；文中的
> 「Lead / Client 分工」「只改某个文件」等协作约束仅对当时有效，实现细节可能已演进。
> 当前行为以 [README.md](README.md)、[SECURITY.md](SECURITY.md) 与代码为准。

日期：2026-11-05。目标：`.drawio` 不再走页图/分页，直接在右侧栏嵌入本机离线 drawio 编辑器；H5 的 iframe 批注在 P4.2 另做。

## 1. 资源与许可

- `editor/` 是 drawio webapp 的裁剪副本（Apache-2.0，来源 jgraph/drawio；裁剪自社区构建，见 `editor/NOTICE`）。发布时必须带 LICENSE/NOTICE，并在 README 标注上游版本与裁剪说明。
- Host 通过 DSH `webServer` 注册 prefix 路由：
  - `/plugins/dsh-artifact-workbench/editor` → 插件 `editor/` 目录静态文件；
  - 相对 URL 与页面同源，不使用 localhost/CSP 绕过。
- 该路由只读、无鉴权（客户端资源），但只暴露编辑器静态文件；不暴露工作区文件。

## 2. Host API

- 扩展现有 `GET source` / `POST source`：除 `.mmd/.mermaid`，也允许 `.drawio`（UTF-8，≤200KB；原子写/备份/CAS 不变）。
- `POST source` 增加 `render` 可选布尔：
  - 默认 `true`：保存后重新渲染并返回 deck（Mermaid 现有行为）；
  - `false`：只保存并返回 `{ok,path,sha256,size,source:{oldSha,newSha,bytes}}`，不渲染（drawio 编辑器用）。
- 原有 `/edit` 仍拒绝 drawio（不是结构化 PPT 编辑）。

## 3. Client drawio 编辑器

- 当 `deck.sourceFormat === 'drawio'` 时，不再渲染分页/缩略图/批注画布，改为整块 iframe 编辑器。
- iframe src（相对同源）：
  `/plugins/dsh-artifact-workbench/editor/index.html?embed=1&proto=json&spin=1&lang=zh&noSaveBtn=0&noExitBtn=1&saveAndExit=0`
- 打开流程：
  1. `GET source?sessionId&path` 取 XML + sha；
  2. iframe 收到 `{event:'init'}` 后 `postMessage({action:'load', xml, autosave:0, title:basename})`；
  3. 编辑器内自由拖拽/连线/样式；点工具栏「保存」（或 Cmd/Ctrl+S）时收到 `{event:'save', xml}`；
  4. POST source `{sessionId,path,baseSha,xml为text,render:false}`；成功后更新本地 baseSha，并回 postMessage `{action:'status', message:'已保存'}`。
- 失败/409：在 iframe 上方显示错误条，保留编辑器内容；不要关闭 iframe。
- 加载/保存状态：顶部小条「正在加载编辑器… / 已保存 / 保存中…」。
- 编辑器区域占满 body；不显示工作台的批注列表、编辑栏、页操作。
- 其他格式保持原行为（PPTX 编辑、PDF/H5/Mermaid 现有逻辑）。
- 不影响 `sourceFormat==='mermaid'` 的源码编辑面板。

## 4. 测试

- Host：source GET/POST 对 `.drawio` 正常；`render:false` 不触发 drawio 渲染、不返回 deck；CAS 409；webServer editor 路由 200/404。
- Client harness：mock drawio deck + source；验证 iframe src 正确、init 后发出 load、save 后 POST payload（baseSha/text/render:false）、保存成功更新状态、409 错误条、不渲染分页/缩略图。
- 真机：打开 `.drawio`，拖动节点并保存，文件 XML 变化；重开仍在。

## 5. 暂不做

- H5（P4.2）、Mermaid 拖拽、drawio 节点级批注。
