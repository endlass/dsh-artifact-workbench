# P1.1 直接编辑 UX + 外部 LibreOffice 契约（Client 改 client.js，Host 由 Lead 实现）

目标：解决“Apply→Save 两步感”，让编辑模式接近直接编辑；同时提供 LibreOffice 原生编辑兜底。

## 1. Host 新增（Lead 实现，已可用）

### `POST open-native`
body `{sessionId, path}`：
- 校验 session/path 存在、`.pptx`、workspace 内可写；
- macOS 固定用 `open -a "LibreOffice" <绝对路径>` 打开；返回 `{ok:true, app:'LibreOffice', path}`；
- 文件不存在 404；workspace 外 403；非 macOS/应用缺失 500/501；同一 deck 请求做 3s 去重限流；
- 测试/无 GUI 时 Host 支持 `PPT_WORKBENCH_OPEN_DRY_RUN=1`（返回 `{ok:true,dryRun:true}`，不启动）。
- 外部保存后依赖现有 `content.revision` 自动刷新；若 `content` revision 不更新，可再加 `GET meta` 轮询（先不假设，需实测）。

## 2. Client 交互

### 2.1 画布内文本编辑
- 编辑模式下**双击**可编辑文本形状（`editable && hasText && !hasTable && !hasChart`）：
  - 在画布对应 shape bbox 上覆盖一个 `<textarea>`（绝对定位于 `.wb-page`，按页面归一化坐标定位；字号尽量接近 shape 当前字号，带背景/描边）；
  - 初始值 `shape.text`，自动 focus + 全选/光标末尾；
  - `Esc` 取消；`Ctrl/Cmd+Enter` 或 blur 提交；普通 Enter 保留换行；
  - 提交时若文本改变，生成 `setText` op 追加 pendingOps，更新 pending 视图并进入自动保存；不改变选中状态；
  - 打开覆盖层时不得触发画布拖拽/框选/缩放；点击 overlay 内部不关闭。
- 非文本形状/组内/图片/表格/图表仍走 inspector，不提供双击。

### 2.2 画布内移动 / 缩放
- 选中顶层形状后，在形状内部按下并拖动（>3px）→ 移动；实时显示预览（可用 pending 视图/局部 state），pointerup 生成**一条** `setShapeBox {left,top}` op（EMU 取整）。
- 选中框 4 角手柄（建议 8 个手柄，至少 4 角）拖动 → 缩放，pointerup 生成一条 `setShapeBox {width,height,(left,top 如从左上缩放)}`。
- 最小尺寸 0.1in（91440 EMU）；旋转形状仍按未旋转包围盒处理；图片/组内/表格/图表不拖拽；pointer 拖动期间暂停 auto-save。
- 拖拽/缩放手势必须与 P0 的框选、画布滚动、点击选中区分：点击不移动 → 保持选中；拖拽阈值内不算移动。

### 2.3 Inspector 自动进草稿
- 文本/字号/粗斜/颜色/位置大小/备注/表格单元格字段：**blur 或 change 后 debounce 300ms 自动追加对应 op 到 pendingOps**（沿用现有 diff 逻辑，不要重复生成同一 op；相同值不产生 op）。
- 移除「应用到草稿」按钮（或改为不显眼的“刷新预览”），保存不再依赖它；保留「清空草稿」。
- 表格/图表只读展示逻辑保持。

### 2.4 自动保存
- 编辑栏新增开关「自动保存」（默认 ON，localStorage 持久化，例如 `dsh-ppt-wb-autosave`）。
- pendingOps 变化后 1500ms 空闲自动调用现有 `saveAll({silent:true})`；保存中显示「自动保存中」；成功后「已自动保存 HH:mm」；失败 toast + 保留草稿，**不要自动重试循环**（用户改动/手动保存后恢复）。
- 暂停条件：inline editor 打开、拖拽/缩放中、`busy`、`saving`、stale conflict、非编辑模式；手动 `⌘/Ctrl+S` 不受开关限制。
- 页操作仍立即单 op 保存；页操作 pending 锁定逻辑保持。
- 409 stale：显示现有冲突 banner，自动保存停止；重新加载后恢复。
- 保存成功后 adopt 响应；不要因自动保存弹过多 success toast（silent）。

### 2.5 外部 LibreOffice
- 编辑栏增加按钮「在 LibreOffice 中编辑」（icon 可选）。
- 点击时：若 pending>0 先 await saveAll()；成功后再 `POST open-native`；toast「已在 LibreOffice 打开，保存后会刷新」；失败 toast。
- 外部保存触发 deck sha/revision 变化时沿用现有刷新逻辑；若当前有 pending（理论上已先保存），走冲突 banner。
- 不在 Host 未就绪/非 macOS 时隐藏按钮？可显示但失败 toast；最好根据 `navigator.platform`/Host 能力，但简单即可。

## 3. 字典
新增 zh/en keys：直接编辑提示、自动保存开/关/保存中/已保存、外部打开、保存失败等；不要硬编码中文。

## 4. 测试（harness）
扩展 `/tmp/wb-harness`：
1. 双击文本 → overlay 出现、输入、blur → pending+1、mock `/edit` 1.5s 后收到 setText；
2. 拖动形状 40px → setShapeBox left/top 改变；拖角 → width/height 改变；点击不拖不产生 op；
3. inspector 改字号后 blur → 自动 pending（无需点 Apply）；
4. 自动保存开关 off → 改文本不自动 POST，手动保存才 POST；localStorage 持久化；
5. 自动保存冲突 → banner，不循环重试；
6. 外部按钮：先保存 pending 再 POST open-native，toast；
7. P0/P1 原有回归全过（浏览/批注/页操作/undo/redo/stale）。

交付：`node --check client.js`；报告 PASS/FAIL 数、截图；只改 client.js（可改 /tmp/wb-harness）。
