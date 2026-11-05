# 发布清单（P2.4 前用）

当前状态：`package.json` 仍 `private: true`，只是本机 linked package，不发布。本清单是 P2.0 的工程骨架，发布前逐项勾。

## 1. 待用户决定

- 包名：`dsh-artifact-workbench`（推荐，反映多格式）还是保留 `dsh-ppt-workbench`。
- 许可证：MIT 或 Apache-2.0；决定后补 `LICENSE`。
- 仓库地址与主页：GitHub 仓库、README 截图、示例文件。
- 分发方式：npm、GitHub Release、DSH 插件市场（如果开放）。

## 2. 发布前必须通过

- `node --check index.js && node --check client.js`
- `node test/*.mjs` 全绿（Host、PPT、PDF、schema 迁移）
- Client harness：`/tmp/wb-harness/test-p1.py`、`test-p11.py`、新增 PDF 用例全绿
- 干净 profile 安装：`plugin_manager install_bundle <路径>`，打开 PPTX/PDF tab 无报错
- `dsh-plugin-upgrade-audit` E0–E3 回归
- 真实入口验收：PPTX 编辑/批注/自动保存；PDF 预览/批注/发送给 dsh

## 3. 包内容

- `index.js`、`client.js`、`lib/`、`locale/`、`icon.svg`、`cordis.patch.yml`
- `README.md`、`CHANGELOG.md`、`ROADMAP.md`、`LICENSE`、契约文档
- 可选：`examples/` 最小 PPTX/PDF、截图；不要把真实业务 deck 打进去。

## 4. 兼容与迁移

- 保留 PPT renderer key 与旧 body key 至少一个版本；已打开的 tab 不失效。
- 旧批注 `dsh-ppt-annotation@1` 自动迁移；不删除 orphan。
- `engines.dsh` 按实际验证版本收紧/放宽，发布前核对 DSH rc/alpha 线。
- 发布 tag 后回写 `CHANGELOG.md` 和 docs/飞书归档。

## 5. 命名迁移草案

如果改名 `dsh-artifact-workbench`：

1. 新包声明 `dsh.bundle.patch`、client inject、renderer/body key 使用新 id；旧 id 保留 alias 一个版本。
2. 安装验证：新 profile 安装新包，旧 tab/旧 sidecar 仍可读。
3. 旧包标记 deprecated，README 指到新包。
4. 迁移完成后再移除旧 key。
