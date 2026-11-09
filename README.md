# Artifact Workbench

**在 DeepSeek Harness 右侧栏里浏览、批注、编辑 Agent 生成的交付物。**

[English](README.en.md) · [更新日志](CHANGELOG.md) · [路线图](ROADMAP.md) · [安全策略](SECURITY.md) · [第三方声明](THIRD-PARTY-NOTICES.md)

> 项目名：Artifact Workbench。npm 包名与插件 id 沿用 `dsh-ppt-workbench`（历史原因，改名会破坏已打开的 tab 与旧批注侧车），仓库名为 `dsh-artifact-workbench`。

Artifact Workbench 是一个 [DSH（DeepSeek Harness）](https://github.com/deepseek-ai/deepseek-harness) 桌面端插件。它接管右侧栏的文档预览，把 `.pptx`、`.pdf`、`.html`、`.drawio`、`.mmd` 等交付物变成可批注（PPTX 还可直接编辑）的工作台：批注落在交付物旁边的 JSON 侧车里，可一键整理成修改指令发回给 Agent。

## 能力一览

| 格式 | 预览 | 批注 | 编辑 | 说明 |
| --- | --- | --- | --- | --- |
| `.pptx` | 页图（144 DPI） | ✅ 形状/区域/多选 | ✅ 结构化 + 原位编辑 | 顶层形状文本/字体/几何/表格/备注/页操作；自动保存；undo/redo |
| `.pdf` | 页图 | ✅ 点/区域 | — 只读 | 页码 + 归一化坐标锚点 |
| `.html` / `.htm` | 原页 iframe | ✅ DOM 选择器 | — 只读 | 报告类 H5；脚本在 sandbox iframe 中运行 |
| `.drawio` | 内嵌离线 drawio 编辑器 | ✅ 节点（mxCell）/整图 | ✅ 在编辑器中改 | 保存即写回源文件；冲突时保留副本 |
| `.mmd` / `.mermaid` | 页图 | ✅ 页/区域 | ✅ 源码面板 | 最近 5 份源码备份，渲染失败回滚 |
| 飞书 docx/wiki | 只读镜像 + 原生页面 | ✅ 评论/回复 | — | 可选；需要本机 `lark-cli` 或 OAuth 应用配置 |

通用能力：

- 自动跟随：Agent 或外部程序改写文件后，文档 tab 自动刷新并按 sha → shape id+name → 文本 → 几何的顺序修复批注锚点，修不回来的标为「待重新锚定」而不是静默删除。
- 发送给 DSH：把未解决批注（页码、形状引用、文本摘录、文件 SHA）整理成指令插入输入框，确认后发送。
- 外部程序兜底：PPTX/PDF 可「在 LibreOffice 中打开」，`.drawio`/`.mmd` 可「在 draw.io 中打开」；外部改动走同一套 revision/冲突机制。
- 安全边界：写操作（批注、编辑、撤销、源码保存）只允许落在当前会话 workspace 内；workspace 外文件只读。

## 系统要求

- **DSH 桌面版**（Electron）。插件依赖 DSH 右侧栏的 document preview / sidebar right 扩展点与 DSH 自带的 LibreOffice Kit。
- DSH **0.2.x**（开发验证：0.2.1-rc.5 → 0.2.2-rc.1，`package.json` 约束为 `>=0.2.0-rc.2 <0.3.0`）。
- 宿主 Node **>= 22**（插件运行在 DSH 主进程里，不需要用户自己装 Node）。
- macOS 为主力验证平台；Windows / Linux 有路径探测与启动分支，但尚未实机端到端验证。

## 安装

这是一个 DSH bundle 插件（`dsh.bundle.patch` + client inject），**只 `npm install` 不会自动装载**，需要由 DSH 插件管理安装。

### 方式 A：DSH 插件页（推荐）

1. 打开 DSH 的 Plugins / 插件页。
2. 新增插件 → install bundle，target 填 npm 包名与版本：`dsh-ppt-workbench@0.14.5`（或本地目录）。
3. 安装后无需重启；打开一个 `.pptx` 文档 tab 验证工作台出现。

### 方式 B：`plugin_manager` 工具

在 DSH 会话里让 Agent 调用（或手动使用插件管理工具）：

```text
action: install_bundle
target: dsh-ppt-workbench@0.14.5      # npm 源；本地开发时填仓库绝对路径
```

### 方式 C：本地 link（开发）

```bash
git clone https://github.com/endlass/dsh-artifact-workbench.git
cd dsh-artifact-workbench
npm run check && npm run test:smoke   # 可选：先自检
```

然后同方式 B，`target` 填仓库绝对路径。改 `index.js` / `lib/**` 后重启 DSH 生效；`client.js` 支持热替换。

安装后行为：`.pptx` 默认用 Artifact Workbench 打开，仍可从渲染器下拉切回内置预览；`.docx`、`.xlsx` 等不受影响。

## 外部依赖与路径配置

| 依赖 | 是否必需 | 用途 | 自动探测位置 |
| --- | --- | --- | --- |
| DSH 自带的 LibreOffice Kit | 必需（随 DSH 安装） | PPTX / PDF 页图渲染、inventory | `$DSH_RESOURCES/app.asar.unpacked/...` |
| python-pptx | 必需（随 DSH 运行时） | PPTX inventory / 编辑 op | DSH runtime python |
| **draw.io Desktop** | 打开 `.drawio`/`.mmd` 时必需 | 页图导出（内嵌编辑器本身离线可用） | `/Applications/draw.io.app`、`/usr/bin/drawio`、`/snap/bin/drawio`、Windows 默认安装位置 |
| **Chrome / Chromium** | 打开 `.html` 时必需 | H5 → PDF 快照（页数/缩略图） | `/Applications/Google Chrome.app`、`Chromium`、`Edge`、`google-chrome`、`chromium`、Windows 默认安装位置 |
| LibreOffice.app | 可选 | 「在 LibreOffice 中编辑」外部编辑 | `/Applications/LibreOffice.app`、Linux `libreoffice`/`soffice`、Windows 默认安装位置 |
| `lark-cli` | 可选 | 飞书文档/评论（P5 早期通道） | `~/.npm-global/bin`、`~/.local/bin`、`/usr/local/bin`、`/opt/homebrew/bin` |

路径可以在**配置文件**或**环境变量**里显式指定（环境变量优先）。DSH 桌面 GUI 不继承 shell 环境变量，桌面用户建议用配置文件。

### 配置文件

`$DSH_HOME/storages/dsh-ppt-workbench/config.json`（默认 `~/.dsh/storages/dsh-ppt-workbench/config.json`，首次使用可手动创建；改完重启插件/DSH 生效）：

```json
{
  "chrome": "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "drawio": "/Applications/draw.io.app/Contents/MacOS/draw.io",
  "libreoffice": "/Applications/LibreOffice.app",
  "larkCli": "/opt/homebrew/bin/lark-cli",
  "python": "/path/to/python3"
}
```

所有字段可选；不填则自动探测。文件只含本机路径，不含密钥。

## 配置项（环境变量）

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `DSH_HOME` | `~/.dsh` | DSH home；决定插件存储根 |
| `PPT_WORKBENCH_STORAGE` | `$DSH_HOME/storages/dsh-ppt-workbench` | 插件缓存/日志/凭据根目录 |
| `DSH_RESOURCES` / `PPT_WORKBENCH_RESOURCES` | DSH 安装资源目录（自动探测） | LibreOffice Kit 所在根 |
| `PPT_WORKBENCH_PYTHON` | DSH runtime python3 | python-pptx 解释器 |
| `PPT_WORKBENCH_CHROME` | 自动探测 | H5 快照用 Chrome/Chromium |
| `PPT_WORKBENCH_DRAWIO` | 自动探测 | draw.io Desktop CLI（页图导出） |
| `PPT_WORKBENCH_DRAWIO_APP` | 同 `PPT_WORKBENCH_DRAWIO` | draw.io 应用路径（「在 draw.io 中打开」） |
| `PPT_WORKBENCH_LIBREOFFICE` | 自动探测 | LibreOffice 应用路径（「在 LibreOffice 中打开」） |
| `PPT_WORKBENCH_LARK_CLI` | 自动探测 | `lark-cli` 路径 |
| `PPT_WORKBENCH_FEISHU_ACCOUNTS` | `https://accounts.feishu.cn` | 飞书 OAuth 账号端点（测试用） |
| `PPT_WORKBENCH_FEISHU_OPEN` | `https://open.feishu.cn` | 飞书 Open API 端点（测试用） |
| `PPT_WORKBENCH_OPEN_DRY_RUN` | 未设置 | 设为 `1` 时「外部打开」只返回元信息、不启动程序 |

## 数据与存储位置

| 数据 | 位置 | 说明 |
| --- | --- | --- |
| 渲染缓存 | `$DSH_HOME/storages/dsh-ppt-workbench/renders/<sha256>/` | 页 PNG、inventory、manifest；可随时删除 |
| 运行日志 | `$DSH_HOME/storages/dsh-ppt-workbench/workbench.log` | 路由名、SHA 前缀、耗时；不含文档正文与凭据 |
| 批注侧车 | `<交付物>.workbench/annotations.json` | 与交付物同目录（workspace 内），Agent 可直接读取 |
| 编辑历史 | `<交付物>.workbench/history.json` + `history/` | 独立副本快照，默认 30 条 |
| 编辑临时/锁 | `<交付物>.workbench/edit-tmp/`、`edit.lock` | 保存完成后清理 |
| 冲突副本 | `<交付物>.workbench/conflict/` | 检测到外部改写时保留 |
| 飞书凭据（可选） | `$DSH_HOME/storages/dsh-ppt-workbench/feishu-app.json`、`feishu-token.json` | 权限 `0600`，不返回客户端、不写日志 |

不写 Session 事件，不改 DSH 其他插件的数据。卸载插件后可手动删除上述缓存与 `.workbench` 目录。

## 隐私与权限边界

- **本地优先**：插件不做遥测、无后台网络请求。唯一的出站请求是用户主动启用的飞书集成（OAuth + Open API）。
- **写边界**：所有写操作要求交付物 `realpath` 位于当前会话 workspace 内（symlink 逃逸会被拒绝）；workspace 外只读。
- **路由鉴权**：Host 路由挂在 DSH 既有 connection server 上，沿用 DSH 的 owner-browser 鉴权，并额外校验 session 存活。
- **外部程序**：LibreOffice / draw.io / Chrome / lark-cli 以 argv 数组启动（不经 shell 拼接），文件路径只作为数据传入。
- **H5 隔离**：报告 HTML 在 `sandbox="allow-scripts"`（无 `allow-same-origin`）的 iframe 中运行，脚本读不到 DSH cookie/localStorage/父页面；静态资源按「HTML 及其引用资源」白名单提供，token 1 小时过期，隐藏目录/侧车/符号链接不可读。
- **飞书凭据**：App Secret 与 user token 以 `0600` 保存在插件存储目录，不返回客户端、不落日志。
- **drawio 编辑器**：`editor/` 是随插件分发的可信第三方代码（draw.io webapp），云端集成已裁剪、完全离线；它不受 sandbox 限制，审查 `editor/` 变更应与审查 `index.js`/`client.js` 同等对待。

更多细节与漏洞报告方式见 [SECURITY.md](SECURITY.md)。

## 使用流程

1. 让 Agent 生成 `foo.pptx` 并 `present`（或直接在回复里给文件链接）。
2. 点交付卡/文件链接 → 右侧栏「Artifact Workbench」。
3. 「批注」→ 点页面元素或拖拽框选落批注；底部抽屉管理线程/解决/筛选。
4. 「发送给 DSH」把未解决批注插入输入框，确认发送；Agent 改写后画布自动刷新。
5. 「编辑」→ 双击文本原位编辑，或选中形状拖拽/缩放/inspector 改属性；自动保存默认开启（1500ms 空闲），⌘/Ctrl+S 手动保存；需要原生交互时「在 LibreOffice 中编辑」。
6. 打开 `.drawio` 直接进入内嵌编辑器（可离线拖拽连线），选中节点后可在右侧面板写节点批注。
7. 飞书：配置 `lark-cli` 或 OAuth 应用后，可在右侧栏只读浏览 docx/wiki、管理评论。

## 已知限制

- PPTX 只支持顶层形状：组内形状、图片替换、动画/转场/SmartArt/媒体不编辑。
- 保存后整份 deck 重新渲染（12 页约 3–4 s），暂未做脏页增量渲染。
- PDF 文本层选择/搜索未接入；批注以页图坐标 + 可选文本摘录为主。
- H5 为只读批注，不改源文件；只服务本地引用资源，外链/CDN 资源不会自动放行。
- `.drawio` 最多 30 页参与页图管线（内嵌编辑器本身不限页）；节点批注按 mxCell id 锚定，节点被删后标为 orphan。
- Mermaid 源码保存不做语法预校验，渲染失败会回滚源文件；只保留最近 5 份备份。
- 外部原生编辑需要本机安装 LibreOffice / draw.io；非 macOS 平台尚未实机验证。
- 飞书集成仅支持 docx/wiki；需要自备应用或本机 `lark-cli` 授权。
- 不接管 `.xlsx`（Excel 只预览场景未实现）。
- 缺字体时只告警不失败；LibreOffice 与 PowerPoint 存在版式差异。
- 仓库体积较大（约 64 MB），其中 `editor/` 是 ~42 MB 的 draw.io vendor；`npm pack` 约 11.5 MB（压缩后）/ ~43 MB（解包）。这样做是为了离线可用与单包安装，暂不拆分为独立资源包。

## 卸载

1. DSH 插件页 / `plugin_manager` 停用或卸载 `dsh-ppt-workbench`。
2. 可选清理：`$DSH_HOME/storages/dsh-ppt-workbench/`（缓存、日志、飞书凭据）。
3. 可选清理各交付物旁的 `<交付物>.workbench/` 目录（批注与编辑历史）。
4. 插件不写注册表、不装系统服务、不改任何 DSH 全局配置。

## 开发与测试

```bash
npm run check       # 所有手写 JS 的语法检查（index/client/lib/test/scripts）
npm run test:smoke  # 无外部依赖子集（CI 同款）
npm test            # 全量测试：还需要 DSH 桌面版自带的 LibreOffice Kit、python-pptx、draw.io Desktop、Chrome
npm pack --dry-run  # 查看发布包文件与体积
```

测试全部是普通 `node test/*.mjs`；fixture 均为合成样张（`test/fixtures/`），不含真实业务数据。每个测试需要什么环境见 [test/README.md](test/README.md)。CI（GitHub Actions，Node 22/24）只跑 `npm run check`、`npm run test:smoke` 与 `npm pack --dry-run`，需要本机程序的测试不在 CI 中伪装通过。

CI 与发布流程见 [PUBLISHING.md](PUBLISHING.md)。

### 项目结构

```
index.js              Host 半：/api/dsh-ppt-workbench/* 路由（deck/slide/annotations/edit/history/undo/redo/open-native/source/feishu/health）
client.js             Client 半：右侧栏 renderer/body、浏览/批注/编辑/自动保存/drawio iframe/H5 iframe/飞书 tab
lib/render.mjs        LibreOffice Kit 渲染队列、PDF/H5/diagram 编排、外部程序探测
lib/artifacts/        adapter registry（pptx 可编辑 / pdf / html / diagram）
lib/annotations.mjs   批注侧车 schema v2、锚点修复、drawio cell 批注
lib/edit-backend.mjs  编辑后端抽象 + PPTX 后端（python-pptx）
lib/edit_ops.py       白名单编辑 op 实现
lib/history.mjs       独立快照、undo/redo
lib/deck-lock.mjs     单写者锁
lib/inventory.py      python-pptx 结构清单
lib/feishu*.mjs       飞书 lark-cli 封装 / Device Flow OAuth
lib/html-server.mjs   H5 静态资源白名单路由
lib/editor-server.mjs drawio editor 静态资源路由
editor/               裁剪版 draw.io webapp（Apache-2.0，第三方，见 THIRD-PARTY-NOTICES.md）
test/                 测试与合成 fixture
scripts/check.mjs     语法检查脚本
```

## 版本与兼容

- 当前版本 **0.14.5**（见 [CHANGELOG.md](CHANGELOG.md)）。
- DSH：`>=0.2.0-rc.2 <0.3.0`；宿主 Node `>=22`。
- 批注侧车 schema：`dsh-artifact-annotation@2`，兼容并自动迁移旧 `dsh-ppt-annotation@1`。
- 旧 renderer key / 旧 tab 兼容策略：保留 `dsh-ppt-workbench` 命名一个版本周期，详见 [PUBLISHING.md](PUBLISHING.md) 的命名迁移说明。

## 许可

本项目自有代码以 **MIT** 许可发布，© 2026 Xingchen Zhao (endlass)，完整文本见 [LICENSE](LICENSE)。

`editor/` 目录是 vendored draw.io webapp（draw.io 31.4.5，经 `dsh-drawioedit` main 打包），**不适用 MIT**：主体为 Apache-2.0，另含 EPL-2.0（ELK）、LGPL-2.1（libavoid）、CC-BY-4.0（模板）、OFL-1.1（字体）与 draw.io 图标/模板附加条款。逐组件清单、版权行与许可全文见 [licenses/README.md](licenses/README.md) 与 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)；来源与修改记录见 [editor/PROVENANCE.md](editor/PROVENANCE.md)、[editor/MODIFICATIONS.md](editor/MODIFICATIONS.md)。

合规状态与已知未决项（含 libavoid LGPL 源码可得性；npm/Release 发布前须解决）见 [COMPLIANCE.md](COMPLIANCE.md)。"draw.io" 是 draw.io Ltd 的注册商标（EU #018062448），本项目为独立集成，与 draw.io Ltd 无隶属/背书关系；`editor/` 中保留的上游品牌素材仅用于功能保真，不用于本项目自身品牌。
