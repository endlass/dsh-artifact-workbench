# Changelog

## 0.15.1 — 2026-11-10

- **Workspace boundary**: annotation/history/lock/temp/backup paths under
  `<artifact>.workbench` now reject a symlinked `.workbench` directory or
  sidecar file (`ensureSafeDir` / `assertNotSymlink`); the sidecar regression
  test was extended accordingly. This closes a path where a symlink inside the
  workspace could make plugin writes land outside it.
- **File permissions**: plugin storage root and `.workbench` directories are
  created `0700`; JSON sidecars and the runtime log are written `0600`.
- **H5 artifact responses** now send `Referrer-Policy: no-referrer` so the
  per-artifact URL token is not leaked to third-party resources through the
  Referer header, plus `Content-Security-Policy: sandbox allow-scripts` as
  defense in depth for direct/top-level opens.
- Added `.github/dependabot.yml` (GitHub Actions + npm weekly updates).
- **Removed libavoid (LGPL-2.1) from the vendored editor.**
  `editor/js/extensions.min.js` is now built by `scripts/build-drawio-extensions.mjs`
  from the upstream draw.io 31.4.5 bundle with the libavoid append
  (`libavoid.min.js` + `libavoid-routing.js` + `LibavoidRouting.js`) removed;
  `editor/js/libavoid-js/` and `licenses/lgpl-2.1.txt` are gone. The draw.io
  **Arrange → Layout → Orthogonal Routing** auto-routing action is therefore
  unavailable; ordinary orthogonal edge styles are draw.io core and unaffected.
  This removes the LGPL source/replaceability blocker recorded in
  `COMPLIANCE.md`. No annotation/artifact data change.

## 0.15.0 — 2026-11-10

**Rename release.** No behavior change beyond identifiers.

- Package/plugin id renamed from `dsh-ppt-workbench` to
  `dsh-artifact-workbench`, matching the project name and repository. This is a
  breaking identifier change: renderer key, Feishu tab key, API route prefix
  (`/api/dsh-artifact-workbench/*`), locale namespace and style tag now use the
  new name. See `MIGRATION.md`.
- Storage directory migrated automatically from
  `$DSH_HOME/storages/dsh-ppt-workbench` to
  `$DSH_HOME/storages/dsh-artifact-workbench` (explicit storage overrides are
  left untouched).
- Environment variables renamed to `ARTIFACT_WORKBENCH_*`; legacy
  `PPT_WORKBENCH_*` names are still read (new names take precedence).
- Annotation sidecars (`<artifact>.workbench/`) and the
  `dsh-artifact-annotation@2` schema are unchanged; legacy
  `dsh-ppt-annotation@1` migration still applies.
- `MIGRATION.md` added; READMEs, contracts, publishing and roadmap updated for
  the new name; `files` now includes `MIGRATION.md`.

## Unreleased — 2026-11-10 (licensing compliance)

- Added `licenses/` with full texts (MIT, Apache-2.0, Zlib, EPL-2.0,
  LGPL-2.1, CC-BY-4.0, OFL-1.1) and `licenses/README.md`, a per-component
  index of versions, locations and copyright lines.
- Rewrote `THIRD-PARTY-NOTICES.md` against the actual vendored tree: draw.io
  31.4.5 via `dsh-drawioedit` main `6029d77`; corrected earlier statements
  (draw.io branding, `index.html` patch, libavoid "runtime replaceable",
  spin.js version, missing drawio/dsh-drawioedit versions) and added missing
  components (WebCola, bmp-js, dagre/graphlib/lodash, es6-promise, Emscripten
  runtime, `orgchart.min.js`, python-pptx/React as runtime peers).
- Added `editor/PROVENANCE.md` (hash-verified provenance),
  `editor/MODIFICATIONS.md` (changes vs upstream, incl. removed internal
  CLAUDE.md notes), `editor/js/elk/LICENSE` + `editor/js/elk/SOURCE.md`,
  `editor/js/libavoid-js/SOURCE.md`, `editor/templates/ATTRIBUTION.md`, and
  an addendum to `editor/NOTICE` (upstream text kept verbatim).
- Fixed `licenses/OFL-1.1.txt` to the font's embedded 2010/no-RFN copyright
  notice and pinned the draw.io copy by SHA-256; added CC-BY-4.0 attribution
  for the diagram templates.
- Added `COMPLIANCE.md`: remaining open items; **npm publish / Release is
  gated** on resolving the libavoid LGPL-2.1 source-availability issue.
- No runtime behaviour changes.

## 0.14.5 — 2026-11-09

Open-source readiness release. No change to artifact formats or annotation
schema.

- Licensing and governance: MIT `LICENSE` (© 2026 Xingchen Zhao / endlass),
  `THIRD-PARTY-NOTICES.md` (draw.io webapp, libavoid LGPL-2.1, MathJax,
  DOMPurify, jQuery, JSZip, pako, CryptoJS, fonts, icons/stencils, templates),
  `SECURITY.md` (write boundary, data locations, external programs, network).
- Docs: README rewritten for newcomers, with a full English translation
  (`README.en.md`); refreshed `ROADMAP.md` and `PUBLISHING.md` (release
  checklist + naming migration + vendor size notes).
- Package metadata: MIT license, repository/homepage/bugs/author, keywords,
  `publishConfig.access=public`, `private` removed, `files` whitelist cleaned
  (docs and `licenses/` included, `test/` no longer published), version 0.14.5.
- Configurable external programs: `$STORAGE/config.json` (`chrome`, `drawio`,
  `libreoffice`, `larkCli`, `python`) is read in addition to the existing
  `PPT_WORKBENCH_*` environment variables and auto-detection; "open externally"
  now resolves LibreOffice/draw.io from config/env/candidate lists and supports
  non-macOS binaries instead of hard-coded `/Applications/...` paths.
  `PPT_WORKBENCH_STORAGE` now also overrides the plugin storage root;
  `PPT_WORKBENCH_RESOURCES`/`DSH_RESOURCES` can point at a non-default DSH
  installation.
- Tests: self-contained synthetic fixtures committed under `test/fixtures/`
  (12-slide PPTX + LibreOffice round-trip variant + 2-page HTML/PDF), so tests
  no longer depend on `research/` or `mortgage-calc/` paths outside the repo;
  plain `node test/*.mjs` with temp-dir output only.
- Engineering: `scripts/check.mjs` syntax checks every hand-written JS file;
  new `npm run test:smoke` (dependency-free subset, used by CI);
  `.github/workflows/ci.yml` for Node 22/24 (check + smoke + `npm pack
  --dry-run` content assertions); `.gitignore`; `test/README.md` with the
  environment matrix for tests that need local DSH/LibreOffice/draw.io/Chrome.

## 0.14.4 — 2026-11-09

- Client: conflict/error banner readability. The error banner previously relied on theme tokens (saturated red background + light text, ~3.6:1) and its action link inherited a low-contrast grey; the reload action was nearly invisible. Error banner now uses a fixed dark red (#9F1D15) with white text (~7.9:1), 13px/500 weight, and the action renders as a bordered pill button.
- No Host changes; annotations/editing behavior untouched.

## 0.14.3 — 2026-11-09

- P1-01: history snapshots are independent copies (not hardlinks), restore verifies snapshot SHA; source-render failure only rolls back when the file is still the version this request wrote, otherwise preserves external content in a conflict copy.
- Added history-immutability regression.

## 0.14.2 — 2026-11-09

- H5 artifact 改为“HTML 及其引用资源 allowlist”：只服务 HTML/CSS/JS/图片/字体/视频，拒绝未引用文件、隐藏目录、sidecar 和符号链接；未引用 CSS/资源不再可读。

## 0.14.1 — 2026-11-09

- P0 security/data fixes: realpath workspace containment, H5 artifact resource allowlist + symlink rejection, transactional annotation read-repair, corrupt sidecar preservation.
- P0 client: PPTX draftBaseSha, conflict blocks all save/edit entries, saving locks editor and preserves unsubmitted draft, submitted batch only clears.

## 0.14.0 — 2026-11-08

- 飞书用户 OAuth（Device Flow）：App ID/Secret 配置、device authorization、token 轮询、refresh、logout；设置页登录按钮/授权链接/账号状态。
- 凭据文件权限 600，Secret/token 不返回客户端、不进日志。

## 0.13.4 — 2026-11-08

- Plugins 设置页新增「飞书文档」卡：本机 lark-cli 状态/账号/应用、自动打开原生界面开关，OAuth 预留说明。

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
