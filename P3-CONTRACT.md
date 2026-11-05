# P3 契约：Mermaid 源码编辑 + drawio 多页

日期：2026-11-05。范围：P2.3 收尾。**Client 只改 `client.js`；Lead 改 Host/lib/契约。**

## 1. drawio 多页

### Host

- `.drawio` 解析 `<diagram>` 页数；逐页调用 draw.io CLI：
  `drawio -x -f png -s 2 -b 8 -p <page> -o page-000N.png input.drawio`
- 页数上限 30；超过时 `truncated:true`，只渲染前 30 页。
- 缓存 `<sha>/pages/`；manifest 每页一项，可有不同宽高/`rectangle`。
- `deck.format='pdf'`、`sourceFormat='drawio'`、`editable=false`；`slideCount`=解析页数，`renderedPages`=实际渲染页数。
- Mermaid 仍单页；外部编辑走 `open-native`→draw.io。

### Client

- 现有多页画布/缩略图/翻页/批注复用；截断提示已有。无需新交互。

## 2. Mermaid 源码编辑

### Host API（已实现）

`GET source?sessionId&path`
- 仅 `.mmd/.mermaid`（diagram adapter）；workspace 内。
- 返回 `{ok,path,sha256,size,text}`；>200KB 413。

`POST source` body `{sessionId,path,baseSha,text}`
- baseSha 不一致 → 409 stale，不覆盖。
- UTF-8，≤200KB；单写者锁；temp→fsync→rename；旧文件备份到 `<path>.workbench/source-backups/`，仅留最近 5 份。
- 保存后重新渲染，返回同 `GET deck` 结构 + `source:{oldSha,newSha,bytes}`；渲染失败则回滚源文件并 422。
- 不进入 PPTX 编辑历史。

### Client

- `deck.sourceFormat==='mermaid'` 时工具栏显示「编辑源码」；不进入 PPTX 编辑模式。
- 底部抽屉/模态：GET source 填 textarea；保存 POST source；成功用响应替换 deck/slides/annotations 并关闭；取消有未保存确认；409 stale 保留文本并提示重新拉取；失败保留；⌘/Ctrl+S 保存。
- 保存后图片刷新；批注侧车按页保留。

## 3. 测试

- Host：`diagram-smoke`（多页 drawio）、`source-http`（GET/POST、stale、非 mermaid 拒绝）。
- Client：`test-p3.py`（源码面板打开/加载/保存/stale/取消确认；多页 drawio 回归）。
- 全量 P2/P1.1/P1/P0 回归。

## 4. 边界

- drawio 最多 30 页；Mermaid 无语法预校验（drawio CLI 渲染失败回滚并报错）。
- 源码编辑无历史/undo，仅备份。
- 不编辑 drawio 源 XML。
