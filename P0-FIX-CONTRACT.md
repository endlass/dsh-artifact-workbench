# P0 修复契约（v0.14.1）

来源：Codex 只读评审 2026-11-09。目标：只修 P0，不加功能。

## P0-01 工作区/符号链接（Lead）

- `inspectDeckMeta` 用真实路径判定 `writeAllowed`：`realpath(cwd)`、`realpath(target)`；目标不存在时检查最近存在父目录的 realpath；链接逃逸一律 false。
- `/edit`、`/annotations` POST、`/source` POST 等所有写入检查改用 `meta.writeAllowed`，不再用词法 `isInside`。
- 只读 GET（deck/annotations/readAnnotations）不得在 `writeAllowed=false` 时写 sidecar 修复；传 writeAllowed 给所有 adapter/read 函数。
- H5 artifact 服务：只服务 HTML 及已知静态资源扩展；拒绝 dotfile、`.workbench`、sidecar、未知扩展；realpath 必须落在 HTML 所在目录；拒绝目录/链接逃逸。token 仍限时。
- 测试：workspace 内 symlink → outside `/source` 写被拒；H5 sibling/symlink 读取被拒；只读 GET 不落盘。

## P0-02 批注事务（Lead）

- `readAnnotations` / `readDrawioAnnotations` / `readHtmlAnnotations` 的 load+repair+save 必须在同一个 `withAnnotationWrite` 临界区内；区内保存用 `saveAnnotationFileUnlocked`，不得嵌套加锁。
- `writeAllowed=false` 时只返回内存修复，不落盘。
- `mutate*` 已持锁，保持“锁内 load→repair→op→save”。
- 测试：并发 create + 新 SHA read-repair 多轮，新增批注最终必须存在；现有 concurrency 测试补内容断言。

## P0-03 PPTX 草稿版本/保存批次（Client）

- 首次产生 pending op 时记录 `draftBaseSha`（当时 deck.sha256）；整个草稿生命周期保存都用它，不能用刷新后的 deck.sha256。
- `conflict` 存在时：禁止手动/自动 save、page ops、undo/redo、新编辑；EditBar 保存按钮 disabled；只允许用户明确 reload/discard。
- 保存期间锁住所有编辑入口（画布拖拽/缩放/双击文字/inspector/页操作/源码），但保留 pending 草稿；成功后只清理已提交批次，绝不能清空保存期间新增的草稿。
- 保存失败/stale 保留草稿，不能清空；成功后 adopt 响应。
- 测试：冲突下手动 save 不发请求；保存中新增 op 不被清空（或入口被锁且草稿保留）；成功后 baseSha 更新为响应 sha；保存失败不清草稿。
