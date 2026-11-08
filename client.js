/**
 * dsh-ppt-workbench — Client 半（P1：浏览 + 批注 + 结构化编辑）
 *
 * 产品形态：作为 `.pptx` document renderer 的 body，在右侧栏文档 tab 内直接浏览
 * LibreOffice 渲染出的逐页 PNG，在页面上打 pin 批注，并在「编辑」模式下选中顶层形状、
 * 通过底部属性面板生成结构化 ops，保存回 PPTX（python-pptx 后端，支持 undo/redo）。
 *
 * 数据结构（Host 侧 /api/dsh-ppt-workbench/*）见同目录 CONTRACT.md / EDIT-CONTRACT.md：
 * - GET  deck?sessionId=&path=   -> { deck(含 history), slides, annotations, annotationsRepair }
 * - GET  slide?sha=&page=        -> image/png
 * - POST annotations             -> { annotations, annotationsRepair, deckSha }
 * - POST edit {baseSha, ops}     -> deck 全量 + { edit: { newSha, warnings, history } }
 * - GET  history / POST undo / POST redo
 *
 * 普通浏览器脚本（非 ESM）：window.__ModuleLoader__.load({ id, factory })。
 * 只依赖 react；不 import @deepseek-ai/*；样式只用宿主 --dsw-* token。
 */
window.__ModuleLoader__.load({
  id: 'dsh-ppt-workbench',
  factory(require) {
    var React = require('react');
    var h = React.createElement;

    var NS = 'dsh-ppt-workbench';
    var RENDERER_ID = 'dsh-ppt-workbench/pptx';
    var FEISHU_TAB_ID = 'dsh-ppt-workbench/feishu-doc';
    var FEISHU_AUTO_REFRESH_MS = 30000;
    var FEISHU_BLOCK_LIMIT = 200;
    var FEISHU_TAB_KIND = 'feishu-doc';
    var API_PREFIX = 'api/dsh-ppt-workbench/';
    var STYLE_TAG_ID = 'dsh-ppt-workbench/client.css';
    var EAGER_PAGES = 3;
    var RAIL_HIDE_WIDTH = 520;
    var DRAWER_HIDE_WIDTH = 480;
    var EMPTY_MAP = Object.freeze({});
    var EMPTY_LIST = Object.freeze([]);

    /** 运行时句柄：locale 服务在 apply 时注入，供模块级 tr() 使用。 */
    var runtime = { locale: null };

    // ------------------------------------------------------------------
    // 字典（中英双语；组件一律走模块级 tr()/translator()，不依赖 props.t）
    // ------------------------------------------------------------------
    var ZH = {
      'viewer.title': 'PPT 工作台',
      'author.me': '我',

      'status.loading': '正在渲染幻灯片…',
      'status.loadingHint': '首次打开需要几秒钟（LibreOffice 渲染），之后会使用缓存。',
      'status.refreshing': '正在刷新…',

      'error.title': '无法加载演示文稿',
      'error.retry': '重试',
      'error.code': '错误代码：{code}',
      'error.generic': '加载失败，请稍后重试。',
      'error.network': '网络请求失败，请检查连接后重试。',
      'error.noPath': '无法解析文件路径。',
      'error.noSession': '缺少会话信息，无法加载文件。',
      'error.session': '会话可能已关闭，请重新打开该会话后再试。',
      'error.notFound': '文件不存在，可能已被移动或删除。',
      'error.unsupported': '仅支持 .pptx 文件。',
      'error.hint': '也可以在文档工具栏切换到内置预览查看。',

      'banner.repair': '{repaired} 条批注已自动跟随，{orphaned} 条待重新锚定',
      'banner.repairOrphanedOnly': '{orphaned} 条批注待重新锚定',
      'banner.repairedOnly': '{repaired} 条批注已自动跟随到新版本',
      'banner.dismiss': '关闭提示',
      'banner.refreshFailed': '刷新失败：{message}',
      'banner.outside': '该文件不在会话工作区内：可以浏览，但批注为只读，无法保存。',

      'toolbar.nav': '翻页',
      'toolbar.page': '{page} / {total}',
      'toolbar.prev': '上一页',
      'toolbar.next': '下一页',
      'toolbar.zoom': '缩放',
      'toolbar.zoomFit': '适配',
      'toolbar.zoomFitTitle': '适配宽度',
      'toolbar.zoomActual': '100%',
      'toolbar.zoomActualTitle': '按实际像素显示（100%）',
      'toolbar.annotate': '批注',
      'toolbar.annotateTitle': '开启批注模式：点击页面添加批注',
      'toolbar.annotateOnTitle': '退出批注模式',
      'annotate.hint': '批注模式：点击元素添加批注 · 在页面上拖拽可框选多个元素 · Esc 退出',
      'toolbar.send': '发送给 dsh',
      'toolbar.sendTitle': '把未解决批注整理成指令插入输入框',
      'toolbar.sendDisabled': '没有未解决的批注',
      'toolbar.railShow': '显示缩略图',
      'toolbar.railHide': '隐藏缩略图',
      'toolbar.truncated': '已渲染前 {rendered} 页（共 {total} 页）',
      'toolbar.truncatedChip': '前 {rendered} 页',
      'toolbar.missingFonts': '缺字体 {count}',

      'fonts.title': '字体缺失',
      'fonts.hint': '以下字体在本机不可用，版式可能与 PowerPoint 不同：',
      'fonts.close': '关闭字体提示',

      'rail.aria': '幻灯片缩略图',
      'rail.pageAria': '跳到第 {page} 页',
      'rail.openTitle': '{count} 条未解决批注',

      'canvas.aria': '幻灯片画布',
      'canvas.empty': '没有可显示的幻灯片。',
      'canvas.shape': '元素',
      'canvas.truncatedNote': '已渲染前 {rendered} 页，剩余 {rest} 页未渲染（单次上限 100 页）。',

      'page.loading': '第 {page} 页加载中…',
      'page.failed': '第 {page} 页渲染失败',
      'page.retry': '重试',

      'pin.label': '第 {page} 页第 {index} 条批注：{body}',
      'pin.orphanLabel': '待重新锚定：{body}',

      'compose.title': '添加批注 · 第 {page} 页',
      'compose.shape': '锚定形状：{name}',
      'compose.free': '未锚定形状，记录点击位置',
      'compose.area': '框选区域（未命中元素）',
      'compose.shapesMany': '框选 {count} 个元素：{names}',
      'compose.placeholder': '写下要修改的内容…',
      'compose.save': '保存批注',
      'compose.saving': '正在保存…',
      'compose.cancel': '取消',
      'compose.hint': '⌘/Ctrl + Enter 保存 · Esc 取消',
      'compose.empty': '请先输入批注内容。',
      'compose.noWrite': '文件在会话工作区外，无法添加批注。',
      'compose.saved': '已添加批注。',

      'drawer.title': '批注',
      'drawer.filterOpen': '未解决',
      'drawer.filterResolved': '已解决',
      'drawer.filterOrphaned': '待重新锚定',
      'drawer.collapse': '收起批注面板',
      'drawer.expand': '展开批注面板',
      'drawer.empty': '还没有批注。打开「批注」模式后点击页面即可添加。',
      'drawer.emptyResolved': '还没有已解决的批注。',
      'drawer.emptyOrphaned': '没有待重新锚定的批注。',

      'annotation.page': '第 {page} 页',
      'annotation.freeAnchor': '未锚定形状',
      'annotation.areaAnchor': '框选区域',
      'annotation.orphanedHint': '原锚点已失效，文件更新后可重新锚定。',
      'annotation.resolve': '解决',
      'annotation.reopen': '重新打开',
      'annotation.reply': '回复',
      'annotation.delete': '删除',
      'annotation.deleteConfirm': '确认删除',
      'annotation.cancel': '取消',
      'annotation.replyPlaceholder': '回复这条批注…',
      'annotation.replySubmit': '发送回复',
      'annotation.replyCancel': '取消',
      'annotation.repliedToast': '已发送回复。',
      'annotation.resolvedToast': '已标记为解决。',
      'annotation.reopenedToast': '已重新打开。',
      'annotation.deletedToast': '已删除批注。',

      'send.none': '没有未解决的批注。',
      'send.inserted': '已插入输入框，请确认后发送。',
      'send.copied': '已复制，粘贴到输入框即可。',
      'send.manual': '无法自动插入，请手动复制以下内容：',
      'send.header': '请按以下批注修改 `{name}`（共 {count} 条，文件 SHA {sha}）：',
      'send.lineShape': '{index}. 第 {page} 页「{quote}」：{body}',
      'send.lineFree': '{index}. 第 {page} 页：{body}（未锚定形状）',
      'send.footer': '修改后请保持其他页内容不变，并重新 present。',

      'toolbar.edit': '编辑',
      'toolbar.editTitle': '开启编辑模式：点击元素选中并修改',
      'toolbar.editOnTitle': '退出编辑模式（有未保存修改时会先确认）',
      'edit.hint': '编辑模式 · 双击文本原位编辑 · 拖动移动/角点缩放 · ⌘/Ctrl+S 保存',
      'edit.title': '编辑',
      'edit.pending': '待保存 {count}',
      'edit.pendingOps': '{count} 条待保存修改',
      'edit.save': '保存',
      'edit.saving': '正在保存…',
      'edit.saved': '已保存。',
      'edit.noChanges': '没有待保存的修改。',
      'edit.applyCount': '将应用 {count} 处修改',
      'edit.clearDraft': '清空草稿',
      'edit.undo': '撤销',
      'edit.redo': '重做',
      'edit.undoDone': '已撤销。',
      'edit.redoDone': '已重做。',
      'edit.undoBlocked': '请先保存或清空草稿，再撤销/重做。',
      'edit.noHistory': '没有可撤销的历史',
      'edit.version': '版本 {version}',
      'edit.exit': '退出编辑',
      'edit.dirtyTitle': '有未保存的修改',
      'edit.dirtyBody': '当前有 {count} 处修改尚未保存，退出编辑模式会丢失。',
      'edit.dirtySave': '保存并退出',
      'edit.dirtyDiscard': '放弃并退出',
      'edit.dirtyCancel': '继续编辑',
      'edit.pageMenu': '页面',
      'edit.duplicateSlide': '复制当前页',
      'edit.deleteSlide': '删除当前页',
      'edit.deleteSlideConfirm': '确认删除第 {page} 页',
      'edit.moveUp': '上移当前页',
      'edit.moveDown': '下移当前页',
      'edit.insertSlide': '插入空白页',
      'edit.pageOpDone': '页面已更新。',
      'edit.pageOpBlocked': '请先保存或清空草稿，再执行页面操作。',
      'edit.readonly': '只读',
      'edit.editable': '可编辑',
      'edit.readonlyShape': '该元素（{type}）不支持直接编辑。',
      'edit.text': '文本',
      'edit.textHint': '最多 4000 字符',
      'edit.font': '字体',
      'edit.fontSize': '字号',
      'edit.pt': 'pt',
      'edit.bold': '粗体',
      'edit.italic': '斜体',
      'edit.color': '颜色',
      'edit.colorInherited': '继承主题色',
      'edit.geometry': '位置与大小（英寸）',
      'edit.left': '左',
      'edit.top': '上',
      'edit.width': '宽',
      'edit.height': '高',
      'edit.notes': '演讲者备注',
      'edit.notesFor': '第 {page} 页备注',
      'edit.notesHint': '最多 10000 字符',
      'edit.table': '表格',
      'edit.tableSize': '{rows} 行 × {cols} 列',
      'edit.chart': '图表数据（只读）',
      'edit.selectHint': '点击画布中的元素以选中',
      'edit.conflict': '文件已被外部修改，当前草稿基于旧版本；重新加载会丢弃草稿。',
      'edit.conflictTitle': '文件已被外部修改',
      'edit.conflictCopy': '冲突副本：{name}',
      'edit.reload': '重新加载（丢弃草稿）',
      'edit.badOp': '修改无法应用：{message}',
      'edit.badOpIndex': '（第 {index} 条）',
      'edit.failed': '保存失败：{message}',
      'edit.notSupported': '当前 Host 尚未提供编辑能力（/edit 不可用）。',
      'edit.finishAnnotation': '有未保存的批注内容，请先保存或取消。',
      'edit.previewOnly': '该文件不在会话工作区内，只能预览。',
      'toolbar.pdfBadge': 'PDF · 只读批注',
      'toolbar.htmlBadge': 'H5 · 只读批注',
      'toolbar.drawioBadge': 'drawio · 只读批注',
      'toolbar.mermaidBadge': 'Mermaid · 只读批注',
      'toolbar.editSource': '编辑源码',
      'toolbar.editSourceTitle': '编辑 Mermaid 源码并重新渲染',
      'drawio.loading': '正在加载编辑器…',
      'drawio.saving': '保存中…',
      'drawio.saved': '已保存',
      'drawio.savedAt': '已保存 {time}',
      'drawio.loadFailed': '加载编辑器失败：{message}',
      'drawio.saveFailed': '保存失败：{message}',
      'drawio.editorBadge': 'drawio 编辑器',
      'drawio.annotate': '批注',
      'drawio.annotateTitle': '选中节点后添加批注',
      'drawio.panelTitle': '节点批注',
      'drawio.panelClose': '关闭批注面板',
      'drawio.noSelection': '请先在画布中选中节点',
      'drawio.selected': '已选中：{label}',
      'drawio.selectedId': '节点 {id}',
      'drawio.placeholder': '写下对这个节点的修改意见…',
      'drawio.add': '添加批注',
      'drawio.adding': '正在添加…',
      'drawio.empty': '还没有节点批注。选中节点后可添加。',
      'drawio.selectHint': '点击条目会在编辑器中定位节点',
      'drawio.noLabel': '未命名节点',
      'drawio.orphaned': '节点可能已被删除',
      'drawio.annotationSaved': '批注已添加。',
      'drawio.annotationFailed': '添加批注失败：{message}',
      'drawio.sendTitle': '发送未解决的节点批注给 dsh',
      'send.drawioHeader': '请按以下节点批注修改 `{name}`（共 {count} 条）：',
      'send.drawioLine': '{index}. 节点「{label}」(cell {cellId}): {body}',

      'html.badge': 'H5 · 原页批注',
      'html.annotateMode': '批注模式',
      'html.annotateOn': '退出批注模式，恢复页面交互',
      'html.annotateOff': '开启批注模式：点击页面元素添加批注',
      'html.panelTitle': '网页批注',
      'html.panelClose': '关闭批注面板',
      'html.panelShow': '打开批注面板',
      'html.loading': '正在加载页面…',
      'html.loadFailed': '加载页面失败：{message}',
      'html.retry': '重试',
      'html.noDraft': '在批注模式下点击页面元素',
      'html.draft': '已选元素：{target}',
      'html.placeholder': '写下对这个元素的修改意见…',
      'html.add': '添加批注',
      'html.adding': '正在添加…',
      'html.empty': '还没有网页批注。开启批注模式后点击元素即可添加。',
      'html.selectHint': '点击条目会滚动到对应位置',
      'html.wholePage': '页面整体',
      'html.annotationSaved': '批注已添加。',
      'html.sendTitle': '发送未解决的网页批注给 dsh',
      'send.htmlHeader': '请按以下网页元素批注修改 `{name}`（共 {count} 条）：',
      'send.htmlLine': '{index}. 网页元素「{target}」: {body}',
      'drawio.selectedMany': '已选中 {count} 个元素（{label} 等）',
      'drawio.wholeDiagram': '整张图（未选中元素）',
      'drawio.groupCount': '{count} 个元素',
      'drawio.stale': '文件已被外部修改，保存被拒绝；编辑器内容仍在，可重新加载后再保存。',
      'drawio.reload': '重新加载文件',
      'drawio.editorTitle': 'drawio 编辑器',
      'drawio.retry': '重试',
      'source.title': 'Mermaid 源码',
      'source.aria': 'Mermaid 源码编辑器',
      'source.placeholder': '在这里编辑 Mermaid 源码…',
      'source.loading': '正在加载源码…',
      'source.save': '保存源码',
      'source.saving': '保存中…',
      'source.saved': '源码已保存，正在刷新渲染。',
      'source.cancel': '取消',
      'source.close': '关闭源码面板',
      'source.dirty': '有未保存修改',
      'source.hint': '⌘/Ctrl+S 保存 · 取消会丢弃未保存修改',
      'source.saveFailed': '保存失败：{message}',
      'source.loadFailed': '无法加载源码：{message}',
      'source.notSupported': '当前文件不支持源码编辑。',
      'source.stale': '源码已被外部修改，本地文本未丢失；重新加载会丢弃本地修改。',
      'source.staleTitle': '源码冲突',
      'source.reload': '重新加载源码',
      'source.discardTitle': '放弃未保存的源码修改？',
      'source.discardBody': '关闭面板会丢失当前未保存的文本。',
      'source.discard': '放弃并关闭',
      'source.keepEditing': '继续编辑',

      'toolbar.openDrawio': '在 draw.io 中编辑',
      'toolbar.openDrawioTitle': '用 draw.io 打开流程图，保存后工作台会刷新',
      'toolbar.openDrawioDone': '已在 draw.io 打开，保存后会刷新。',
      'toolbar.openNativeFailed': '无法打开外部编辑器：{message}',
      'annotate.hintPdf': '批注模式：点击页面添加位置批注 · 拖拽框选区域 · Esc 退出',
      'compose.pdfPoint': '页面位置批注',
      'compose.pdfArea': '页面区域批注',
      'annotation.pdfPoint': '页面位置',
      'annotation.pdfArea': '页面区域',
      'send.pdfQuote': '原文摘录：「{quote}」',
      'send.linePdfPoint': '{index}. 第 {page} 页（页面位置 {x}%、{y}%）：{body}',
      'send.linePdfArea': '{index}. 第 {page} 页（页面区域 {x1}%–{x2}%、{y1}%–{y2}%）：{body}',
      'edit.pdfReadonly': 'PDF 为只读批注模式，不能编辑。',
      'edit.unknown': '未知错误',
      'edit.draftCleared': '已清空草稿。',
      'edit.saveSaving': '保存中…',
      'edit.saveSavedAt': '已保存 {time}',
      'edit.autoSave': '自动保存',
      'edit.autoSaveOnTitle': '自动保存已开启（点击关闭）',
      'edit.autoSaveOffTitle': '自动保存已关闭（点击开启）',
      'edit.autoDraftHint': '修改会自动加入草稿',
      'edit.inlineAria': '原位编辑文本',
      'edit.inlineHint': '⌘/Ctrl+Enter 或点击别处保存 · Esc 取消',
      'edit.resizeHandle': '调整大小',
      'edit.sizeLive': '{w} × {h} in',
      'edit.openNative': '在 LibreOffice 中编辑',
      'edit.openNativeTitle': '保存当前修改并用 LibreOffice 打开',
      'edit.openNativeOpening': '正在打开…',
      'edit.openNativeDone': '已在 LibreOffice 打开，保存后会刷新。',
      'edit.openNativeFailed': '无法在 LibreOffice 中打开：{message}',
      'edit.openNativeUnsupported': '当前环境不支持在 LibreOffice 中打开。',
      'feishu.tabTitle': '飞书文档',
      'feishu.guideTitle': '飞书文档',
      'feishu.guideDescription': '读取飞书文档正文与评论',
      'feishu.urlPlaceholder': '粘贴飞书文档 URL（docx / wiki）',
      'feishu.open': '打开',
      'feishu.opening': '正在读取…',
      'feishu.empty': '粘贴飞书文档链接后点击「打开」，读取正文与评论。',
      'feishu.loading': '正在读取飞书文档…',
      'feishu.loadFailed': '读取失败：{message}',
      'feishu.retry': '重试',
      'feishu.refresh': '刷新',
      'feishu.settingsAppId': 'App ID',
      'feishu.settingsSecret': 'App Secret',
      'feishu.settingsSecretHint': '已配置；留空表示保留当前 Secret',
      'feishu.settingsSave': '保存应用配置',
      'feishu.settingsSaved': '应用配置已保存',
      'feishu.settingsLogin': '登录飞书',
      'feishu.settingsLogout': '退出登录',
      'feishu.settingsConfigured': '已配置',
      'feishu.settingsNotConfigured': '未配置',
      'feishu.settingsLoginPending': '等待授权…',
      'feishu.settingsLoginOk': '已登录：{name}',
      'feishu.settingsVerification': '打开授权链接：{url}',
      'feishu.settingsError': '操作失败：{message}',
      'feishu.settingsTitle': '飞书文档',
      'feishu.settingsSummary': '飞书文档接入：本机 lark-cli 状态、默认打开方式与未来 OAuth 配置。',
      'feishu.settingsAuth': '认证方式',
      'feishu.settingsCli': '本机 lark-cli（当前）',
      'feishu.settingsOauth': '飞书应用 OAuth（规划中）',
      'feishu.settingsUser': '账号：{name}',
      'feishu.settingsApp': '应用：{appId}',
      'feishu.settingsStatus': '状态：{status}',
      'feishu.settingsRefresh': '重新检测',
      'feishu.settingsAutoNative': '加载后自动打开原生界面',
      'feishu.settingsOauthHint': '发布版将支持 App ID/Secret 与 OAuth 登录；当前先复用本机 lark-cli 授权。',
      'feishu.menuOpen': '在 Artifact Workbench 打开',
      'feishu.menuNative': '在侧栏原生界面打开',
      'feishu.menuExternal': '在飞书浏览器打开',
      'feishu.openNative': '侧栏原生打开',
      'feishu.autoNative': '自动打开原生界面',
      'feishu.autoNativeTitle': '文档加载成功后自动在 DSH Browser tab 打开飞书原生页面',
      'feishu.openNativeTitle': '在 DSH 内置浏览器中以飞书原生界面打开（可在内登录）',
      'feishu.external': '在飞书打开',
      'feishu.externalTitle': '在飞书原生页面打开该文档',
      'feishu.revision': '版本 {revision}',
      'feishu.docId': '文档 {id}',
      'feishu.comments': '评论',
      'feishu.commentsCount': '共 {count} 条 · 未解决 {open}',
      'feishu.noComments': '还没有评论。',
      'feishu.quote': '引用',
      'feishu.solved': '已解决',
      'feishu.openStatus': '未解决',
      'feishu.reply': '回复',
      'feishu.replyPlaceholder': '回复这条评论…',
      'feishu.replySubmit': '发送回复',
      'feishu.replyCancel': '取消',
      'feishu.resolve': '解决',
      'feishu.reopen': '重开',
      'feishu.commentPlaceholder': '写一条全文评论…',
      'feishu.commentSubmit': '发表评论',
      'feishu.commentEmpty': '评论内容不能为空。',
      'feishu.postFailed': '操作失败：{message}',
      'feishu.commentAdded': '评论已添加。',
      'feishu.replyAdded': '回复已发送。',
      'feishu.resolved': '已标记解决。',
      'feishu.reopened': '已重新打开。',
      'feishu.noReplies': '（无回复内容）',
      'feishu.badUrl': '请输入有效的飞书文档链接。',
      'feishu.anonymous': '未知作者',
      'feishu.blockSelect': '评论位置',
      'feishu.blockFull': '全文评论',
      'feishu.blockOption': '{index}. {text}',
      'feishu.blockTarget': '评论位置：{text}',
      'feishu.blockClear': '改回全文评论',
      'feishu.blockRef': '块引用',
      'feishu.noBlocks': '没有可选的块，将使用全文评论。',
      'feishu.autoRefresh': '自动刷新 · 30s',
      'feishu.autoPaused': '自动刷新已暂停',
      'feishu.autoRefreshed': '上次刷新 {time}',
      'feishu.revisionChanged': '文档已更新：版本 {previous} → {next}',
      'feishu.send': '发送给 dsh',
      'feishu.sendTitle': '把未解决的评论发送给 dsh',
      'feishu.sendEmpty': '没有未解决的评论。',
      'feishu.manualCopy': '无法自动插入输入框，已显示文本供手动复制。',
      'feishu.manualClose': '关闭',
      'send.feishuHeader': '请按以下飞书文档评论修改 `{title}`：',
      'send.feishuMeta': '文档：{url}',
      'send.feishuRevision': '版本：{revision}',
      'send.feishuSummary': '正文摘要：{excerpt}',
      'send.feishuComments': '未解决评论（{count} 条）：',
      'send.feishuLine': '{index}. 块「{block}」：{body}',
      'send.feishuFooter': '修改后请在飞书文档中直接编辑并回传。',
      'feishu.markdownTitle': '正文',
      'toast.close': '关闭提示',

    };

    var EN = {
      'viewer.title': 'PPT Workbench',
      'author.me': 'Me',

      'status.loading': 'Rendering slides…',
      'status.loadingHint': 'The first open takes a few seconds (LibreOffice render); later opens use the cache.',
      'status.refreshing': 'Refreshing…',

      'error.title': 'Could not load the presentation',
      'error.retry': 'Retry',
      'error.code': 'Error code: {code}',
      'error.generic': 'Loading failed. Please retry.',
      'error.network': 'Network request failed. Check the connection and retry.',
      'error.noPath': 'Unable to resolve the file path.',
      'error.noSession': 'Missing session information; cannot load the file.',
      'error.session': 'The session may be closed. Reopen the session and try again.',
      'error.notFound': 'The file does not exist; it may have been moved or deleted.',
      'error.unsupported': 'Only .pptx files are supported.',
      'error.hint': 'You can also switch to the built-in preview from the document toolbar.',

      'banner.repair': '{repaired} annotations moved with the deck, {orphaned} need re-anchoring',
      'banner.repairOrphanedOnly': '{orphaned} annotations need re-anchoring',
      'banner.repairedOnly': '{repaired} annotations moved to the new version',
      'banner.dismiss': 'Dismiss',
      'banner.refreshFailed': 'Refresh failed: {message}',
      'banner.outside': 'This file is outside the session workspace: browsing works, but annotations are read-only.',

      'toolbar.nav': 'Pagination',
      'toolbar.page': '{page} / {total}',
      'toolbar.prev': 'Previous slide',
      'toolbar.next': 'Next slide',
      'toolbar.zoom': 'Zoom',
      'toolbar.zoomFit': 'Fit',
      'toolbar.zoomFitTitle': 'Fit to width',
      'toolbar.zoomActual': '100%',
      'toolbar.zoomActualTitle': 'Actual pixel size (100%)',
      'toolbar.annotate': 'Annotate',
      'toolbar.annotateTitle': 'Turn on annotation mode: click a slide to add a note',
      'toolbar.annotateOnTitle': 'Leave annotation mode',
      'annotate.hint': 'Annotation mode: click an element, or drag a box to select several · Esc to exit',
      'toolbar.send': 'Send to dsh',
      'toolbar.sendTitle': 'Turn open annotations into a prompt in the composer',
      'toolbar.sendDisabled': 'No open annotations',
      'toolbar.railShow': 'Show thumbnails',
      'toolbar.railHide': 'Hide thumbnails',
      'toolbar.truncated': 'Only the first {rendered} pages are rendered ({total} total)',
      'toolbar.truncatedChip': 'first {rendered}',
      'toolbar.missingFonts': 'Missing fonts: {count}',

      'fonts.title': 'Missing fonts',
      'fonts.hint': 'These fonts are unavailable on this machine; layout may differ from PowerPoint:',
      'fonts.close': 'Close font notice',

      'rail.aria': 'Slide thumbnails',
      'rail.pageAria': 'Go to slide {page}',
      'rail.openTitle': '{count} open annotations',

      'canvas.aria': 'Slide canvas',
      'canvas.empty': 'No slides to display.',
      'canvas.shape': 'Element',
      'canvas.truncatedNote': 'The first {rendered} pages are rendered; {rest} more are not (100-page limit).',

      'page.loading': 'Loading slide {page}…',
      'page.failed': 'Slide {page} failed to render',
      'page.retry': 'Retry',

      'pin.label': 'Annotation {index} on slide {page}: {body}',
      'pin.orphanLabel': 'Needs re-anchoring: {body}',

      'compose.title': 'Add annotation · slide {page}',
      'compose.shape': 'Anchored to shape: {name}',
      'compose.free': 'No shape hit; records the click position',
      'compose.area': 'Marquee area (no element hit)',
      'compose.shapesMany': 'Marquee selected {count} elements: {names}',
      'compose.placeholder': 'What should change here…',
      'compose.save': 'Save annotation',
      'compose.saving': 'Saving…',
      'compose.cancel': 'Cancel',
      'compose.hint': '⌘/Ctrl + Enter to save · Esc to cancel',
      'compose.empty': 'Type the annotation first.',
      'compose.noWrite': 'This file is outside the session workspace; annotations cannot be saved.',
      'compose.saved': 'Annotation added.',

      'drawer.title': 'Annotations',
      'drawer.filterOpen': 'Open',
      'drawer.filterResolved': 'Resolved',
      'drawer.filterOrphaned': 'Needs anchor',
      'drawer.collapse': 'Collapse annotations panel',
      'drawer.expand': 'Expand annotations panel',
      'drawer.empty': 'No annotations yet. Turn on "Annotate" and click a slide to add one.',
      'drawer.emptyResolved': 'No resolved annotations yet.',
      'drawer.emptyOrphaned': 'No annotations need re-anchoring.',

      'annotation.page': 'Slide {page}',
      'annotation.freeAnchor': 'No shape anchor',
      'annotation.areaAnchor': 'Marquee area',
      'annotation.orphanedHint': 'The old anchor is gone; it can be re-anchored after the file changes.',
      'annotation.resolve': 'Resolve',
      'annotation.reopen': 'Reopen',
      'annotation.reply': 'Reply',
      'annotation.delete': 'Delete',
      'annotation.deleteConfirm': 'Confirm delete',
      'annotation.cancel': 'Cancel',
      'annotation.replyPlaceholder': 'Reply to this annotation…',
      'annotation.replySubmit': 'Send reply',
      'annotation.replyCancel': 'Cancel',
      'annotation.repliedToast': 'Reply sent.',
      'annotation.resolvedToast': 'Marked as resolved.',
      'annotation.reopenedToast': 'Reopened.',
      'annotation.deletedToast': 'Annotation deleted.',

      'send.none': 'There are no open annotations.',
      'send.inserted': 'Inserted into the composer. Review it, then send.',
      'send.copied': 'Copied. Paste it into the composer.',
      'send.manual': 'Could not insert automatically. Copy the text below:',
      'send.header': 'Please update `{name}` according to these annotations ({count} total, file SHA {sha}):',
      'send.lineShape': '{index}. Slide {page} "{quote}": {body}',
      'send.lineFree': '{index}. Slide {page}: {body} (no shape anchor)',
      'send.footer': 'Keep the other slides unchanged, and re-present the deck afterwards.',

      'toolbar.edit': 'Edit',
      'toolbar.editTitle': 'Edit mode: click an element to select and change it',
      'toolbar.editOnTitle': 'Leave edit mode (asks before discarding changes)',
      'edit.hint': 'Edit mode · double-click text to edit · drag to move / corners to resize · ⌘/Ctrl+S saves',
      'edit.title': 'Edit',
      'edit.pending': '{count} pending',
      'edit.pendingOps': '{count} pending changes',
      'edit.save': 'Save',
      'edit.saving': 'Saving…',
      'edit.saved': 'Saved.',
      'edit.noChanges': 'Nothing to save.',
      'edit.applyCount': '{count} changes ready',
      'edit.clearDraft': 'Clear draft',
      'edit.undo': 'Undo',
      'edit.redo': 'Redo',
      'edit.undoDone': 'Undone.',
      'edit.redoDone': 'Redone.',
      'edit.undoBlocked': 'Save or clear the draft before undo/redo.',
      'edit.noHistory': 'No undo history',
      'edit.version': 'Version {version}',
      'edit.exit': 'Exit edit',
      'edit.dirtyTitle': 'Unsaved changes',
      'edit.dirtyBody': '{count} changes are not saved yet; leaving edit mode discards them.',
      'edit.dirtySave': 'Save & exit',
      'edit.dirtyDiscard': 'Discard & exit',
      'edit.dirtyCancel': 'Keep editing',
      'edit.pageMenu': 'Slide',
      'edit.duplicateSlide': 'Duplicate current slide',
      'edit.deleteSlide': 'Delete current slide',
      'edit.deleteSlideConfirm': 'Confirm delete slide {page}',
      'edit.moveUp': 'Move current slide up',
      'edit.moveDown': 'Move current slide down',
      'edit.insertSlide': 'Insert blank slide',
      'edit.pageOpDone': 'Slide updated.',
      'edit.pageOpBlocked': 'Save or clear the draft before page operations.',
      'edit.readonly': 'Read-only',
      'edit.editable': 'Editable',
      'edit.readonlyShape': 'This element ({type}) cannot be edited directly.',
      'edit.text': 'Text',
      'edit.textHint': 'Up to 4000 characters',
      'edit.font': 'Font',
      'edit.fontSize': 'Size',
      'edit.pt': 'pt',
      'edit.bold': 'Bold',
      'edit.italic': 'Italic',
      'edit.color': 'Color',
      'edit.colorInherited': 'Inherit theme color',
      'edit.geometry': 'Position & size (inches)',
      'edit.left': 'Left',
      'edit.top': 'Top',
      'edit.width': 'Width',
      'edit.height': 'Height',
      'edit.notes': 'Speaker notes',
      'edit.notesFor': 'Slide {page} notes',
      'edit.notesHint': 'Up to 10,000 characters',
      'edit.table': 'Table',
      'edit.tableSize': '{rows} rows × {cols} columns',
      'edit.chart': 'Chart data (read-only)',
      'edit.selectHint': 'Click an element on the canvas to select it',
      'edit.conflict': 'The file changed outside this tab. Your draft is based on an older version; reloading discards it.',
      'edit.conflictTitle': 'File changed externally',
      'edit.conflictCopy': 'Conflict copy: {name}',
      'edit.reload': 'Reload (discard draft)',
      'edit.badOp': 'The change could not be applied: {message}',
      'edit.badOpIndex': ' (op #{index})',
      'edit.failed': 'Save failed: {message}',
      'edit.notSupported': 'Editing is not available in this Host yet (/edit is missing).',
      'edit.finishAnnotation': 'Finish or cancel the annotation draft first.',
      'edit.previewOnly': 'This file is outside the session workspace; preview only.',
      'toolbar.pdfBadge': 'PDF · annotations only',
      'toolbar.htmlBadge': 'H5 · annotations only',
      'toolbar.drawioBadge': 'drawio · annotations only',
      'toolbar.mermaidBadge': 'Mermaid · annotations only',
      'toolbar.editSource': 'Edit source',
      'toolbar.editSourceTitle': 'Edit the Mermaid source and re-render',
      'drawio.loading': 'Loading editor…',
      'drawio.saving': 'Saving…',
      'drawio.saved': 'Saved',
      'drawio.savedAt': 'Saved {time}',
      'drawio.loadFailed': 'Could not load the editor: {message}',
      'drawio.saveFailed': 'Save failed: {message}',
      'drawio.editorBadge': 'drawio editor',
      'drawio.annotate': 'Annotate',
      'drawio.annotateTitle': 'Select a node, then add an annotation',
      'drawio.panelTitle': 'Node annotations',
      'drawio.panelClose': 'Close annotations panel',
      'drawio.noSelection': 'Select a node on the canvas first',
      'drawio.selected': 'Selected: {label}',
      'drawio.selectedId': 'Node {id}',
      'drawio.placeholder': 'What should change about this node…',
      'drawio.add': 'Add annotation',
      'drawio.adding': 'Adding…',
      'drawio.empty': 'No node annotations yet. Select a node to add one.',
      'drawio.selectHint': 'Click an entry to locate the node in the editor',
      'drawio.noLabel': 'Unnamed node',
      'drawio.orphaned': 'The node may have been deleted',
      'drawio.annotationSaved': 'Annotation added.',
      'drawio.annotationFailed': 'Could not add the annotation: {message}',
      'drawio.sendTitle': 'Send open node annotations to dsh',
      'send.drawioHeader': 'Please update `{name}` according to these node annotations ({count} total):',
      'send.drawioLine': '{index}. Node "{label}" (cell {cellId}): {body}',

      'html.badge': 'H5 · page annotations',
      'html.annotateMode': 'Annotate',
      'html.annotateOn': 'Exit annotation mode and restore page interaction',
      'html.annotateOff': 'Turn on annotation mode and click a page element',
      'html.panelTitle': 'Page annotations',
      'html.panelClose': 'Close annotations panel',
      'html.panelShow': 'Open annotations panel',
      'html.loading': 'Loading page…',
      'html.loadFailed': 'Could not load the page: {message}',
      'html.retry': 'Retry',
      'html.noDraft': 'Click a page element in annotation mode',
      'html.draft': 'Selected element: {target}',
      'html.placeholder': 'What should change about this element…',
      'html.add': 'Add annotation',
      'html.adding': 'Adding…',
      'html.empty': 'No page annotations yet. Turn on annotation mode and click an element.',
      'html.selectHint': 'Click an entry to scroll to its position',
      'html.wholePage': 'Whole page',
      'html.annotationSaved': 'Annotation added.',
      'html.sendTitle': 'Send open page annotations to dsh',
      'send.htmlHeader': 'Please update `{name}` according to these page annotations ({count} total):',
      'send.htmlLine': '{index}. Page element "{target}": {body}',
      'drawio.selectedMany': '{count} elements selected ({label} etc.)',
      'drawio.wholeDiagram': 'Whole diagram (no selection)',
      'drawio.groupCount': '{count} elements',
      'drawio.stale': 'The file changed on disk and the save was rejected. Your editor content is kept; reload before saving.',
      'drawio.reload': 'Reload file',
      'drawio.editorTitle': 'drawio editor',
      'drawio.retry': 'Retry',
      'source.title': 'Mermaid source',
      'source.aria': 'Mermaid source editor',
      'source.placeholder': 'Edit the Mermaid source here…',
      'source.loading': 'Loading source…',
      'source.save': 'Save source',
      'source.saving': 'Saving…',
      'source.saved': 'Source saved; re-rendering.',
      'source.cancel': 'Cancel',
      'source.close': 'Close source panel',
      'source.dirty': 'Unsaved changes',
      'source.hint': '⌘/Ctrl+S saves · Cancel discards unsaved changes',
      'source.saveFailed': 'Save failed: {message}',
      'source.loadFailed': 'Could not load the source: {message}',
      'source.notSupported': 'Source editing is not available for this file.',
      'source.stale': 'The source changed outside this panel; your text is kept locally. Reloading discards local changes.',
      'source.staleTitle': 'Source conflict',
      'source.reload': 'Reload source',
      'source.discardTitle': 'Discard unsaved source changes?',
      'source.discardBody': 'Closing the panel will lose the unsaved text.',
      'source.discard': 'Discard & close',
      'source.keepEditing': 'Keep editing',

      'toolbar.openDrawio': 'Edit in draw.io',
      'toolbar.openDrawioTitle': 'Open the diagram in draw.io; save there and the workbench refreshes',
      'toolbar.openDrawioDone': 'Opened in draw.io; save there and the workbench refreshes.',
      'toolbar.openNativeFailed': 'Could not open the external editor: {message}',
      'annotate.hintPdf': 'Annotation mode: click the page to add a point note · drag to select an area · Esc to exit',
      'compose.pdfPoint': 'Page point annotation',
      'compose.pdfArea': 'Page area annotation',
      'annotation.pdfPoint': 'Page point',
      'annotation.pdfArea': 'Page area',
      'send.pdfQuote': 'Quote: "{quote}"',
      'send.linePdfPoint': '{index}. Page {page} (point {x}%, {y}%): {body}',
      'send.linePdfArea': '{index}. Page {page} (area {x1}%–{x2}%, {y1}%–{y2}%): {body}',
      'edit.pdfReadonly': 'PDF is annotations-only and cannot be edited.',
      'edit.unknown': 'Unknown error',
      'edit.draftCleared': 'Draft cleared.',
      'edit.saveSaving': 'Saving…',
      'edit.saveSavedAt': 'Saved {time}',
      'edit.autoSave': 'Auto-save',
      'edit.autoSaveOnTitle': 'Auto-save is on (click to turn off)',
      'edit.autoSaveOffTitle': 'Auto-save is off (click to turn on)',
      'edit.autoDraftHint': 'Changes are added to the draft automatically',
      'edit.inlineAria': 'Edit text in place',
      'edit.inlineHint': '⌘/Ctrl+Enter or click elsewhere to save · Esc to cancel',
      'edit.resizeHandle': 'Resize',
      'edit.sizeLive': '{w} × {h} in',
      'edit.openNative': 'Edit in LibreOffice',
      'edit.openNativeTitle': 'Save changes and open in LibreOffice',
      'edit.openNativeOpening': 'Opening…',
      'edit.openNativeDone': 'Opened in LibreOffice; changes refresh after you save there.',
      'edit.openNativeFailed': 'Could not open LibreOffice: {message}',
      'edit.openNativeUnsupported': 'Opening in LibreOffice is not supported in this environment.',
      'feishu.tabTitle': 'Feishu document',
      'feishu.guideTitle': 'Feishu document',
      'feishu.guideDescription': 'Read a Feishu document body and comments',
      'feishu.urlPlaceholder': 'Paste a Feishu document URL (docx / wiki)',
      'feishu.open': 'Open',
      'feishu.opening': 'Opening…',
      'feishu.empty': 'Paste a Feishu document link and press Open to read its body and comments.',
      'feishu.loading': 'Reading the Feishu document…',
      'feishu.loadFailed': 'Could not read the document: {message}',
      'feishu.retry': 'Retry',
      'feishu.refresh': 'Refresh',
      'feishu.settingsAppId': 'App ID',
      'feishu.settingsSecret': 'App Secret',
      'feishu.settingsSecretHint': 'Configured; leave blank to keep the current secret',
      'feishu.settingsSave': 'Save app config',
      'feishu.settingsSaved': 'App config saved',
      'feishu.settingsLogin': 'Sign in with Feishu',
      'feishu.settingsLogout': 'Sign out',
      'feishu.settingsConfigured': 'Configured',
      'feishu.settingsNotConfigured': 'Not configured',
      'feishu.settingsLoginPending': 'Waiting for authorization…',
      'feishu.settingsLoginOk': 'Signed in: {name}',
      'feishu.settingsVerification': 'Open the authorization link: {url}',
      'feishu.settingsError': 'Action failed: {message}',
      'feishu.settingsTitle': 'Feishu documents',
      'feishu.settingsSummary': 'Feishu document access: local lark-cli status, default open mode, and the future OAuth setup.',
      'feishu.settingsAuth': 'Authentication',
      'feishu.settingsCli': 'Local lark-cli (current)',
      'feishu.settingsOauth': 'Feishu app OAuth (planned)',
      'feishu.settingsUser': 'User: {name}',
      'feishu.settingsApp': 'App: {appId}',
      'feishu.settingsStatus': 'Status: {status}',
      'feishu.settingsRefresh': 'Check again',
      'feishu.settingsAutoNative': 'Auto-open the native page after loading',
      'feishu.settingsOauthHint': 'The published build will support App ID/Secret and OAuth login. For now this uses the local lark-cli authorization.',
      'feishu.menuOpen': 'Open in Artifact Workbench',
      'feishu.menuNative': 'Open in native pane',
      'feishu.menuExternal': 'Open in Feishu browser',
      'feishu.openNative': 'Open native pane',
      'feishu.autoNative': 'Auto-open native page',
      'feishu.autoNativeTitle': 'Open the native Feishu page in the DSH browser tab after a document loads',
      'feishu.openNativeTitle': 'Open the native Feishu page in the DSH browser tab',
      'feishu.external': 'Open in Feishu',
      'feishu.externalTitle': 'Open this document in Feishu',
      'feishu.revision': 'Revision {revision}',
      'feishu.docId': 'Doc {id}',
      'feishu.comments': 'Comments',
      'feishu.commentsCount': '{count} comments · {open} open',
      'feishu.noComments': 'No comments yet.',
      'feishu.quote': 'Quote',
      'feishu.solved': 'Resolved',
      'feishu.openStatus': 'Open',
      'feishu.reply': 'Reply',
      'feishu.replyPlaceholder': 'Reply to this comment…',
      'feishu.replySubmit': 'Send reply',
      'feishu.replyCancel': 'Cancel',
      'feishu.resolve': 'Resolve',
      'feishu.reopen': 'Reopen',
      'feishu.commentPlaceholder': 'Write a document-wide comment…',
      'feishu.commentSubmit': 'Post comment',
      'feishu.commentEmpty': 'Comment text cannot be empty.',
      'feishu.postFailed': 'Action failed: {message}',
      'feishu.commentAdded': 'Comment posted.',
      'feishu.replyAdded': 'Reply sent.',
      'feishu.resolved': 'Marked as resolved.',
      'feishu.reopened': 'Reopened.',
      'feishu.noReplies': '(no comment text)',
      'feishu.badUrl': 'Enter a valid Feishu document URL.',
      'feishu.anonymous': 'Unknown author',
      'feishu.blockSelect': 'Comment target',
      'feishu.blockFull': 'Whole document',
      'feishu.blockOption': '{index}. {text}',
      'feishu.blockTarget': 'Target: {text}',
      'feishu.blockClear': 'Back to whole document',
      'feishu.blockRef': 'Block',
      'feishu.noBlocks': 'No block targets; comments will target the whole document.',
      'feishu.autoRefresh': 'Auto-refresh · 30s',
      'feishu.autoPaused': 'Auto-refresh paused',
      'feishu.autoRefreshed': 'Refreshed {time}',
      'feishu.revisionChanged': 'Document updated: revision {previous} → {next}',
      'feishu.send': 'Send to dsh',
      'feishu.sendTitle': 'Send open comments to dsh',
      'feishu.sendEmpty': 'No open comments.',
      'feishu.manualCopy': 'Could not insert automatically; the text is shown for manual copy.',
      'feishu.manualClose': 'Close',
      'send.feishuHeader': 'Please update the Feishu document `{title}` according to these comments:',
      'send.feishuMeta': 'Document: {url}',
      'send.feishuRevision': 'Revision: {revision}',
      'send.feishuSummary': 'Body excerpt: {excerpt}',
      'send.feishuComments': 'Open comments ({count}):',
      'send.feishuLine': '{index}. Block "{block}": {body}',
      'send.feishuFooter': 'Edit the document in Feishu and reply when done.',
      'feishu.markdownTitle': 'Body',
      'toast.close': 'Dismiss',

    };

    // ------------------------------------------------------------------
    // i18n：模块级翻译器（宿主切语言会同步 document.documentElement.lang）
    // ------------------------------------------------------------------
    function language() {
      try {
        var locale = runtime.locale;
        if (locale && typeof locale.getSnapshot === 'function') {
          var snapshot = locale.getSnapshot();
          if (snapshot && typeof snapshot.active === 'string' && snapshot.active) {
            return snapshot.active.toLowerCase();
          }
        }
      } catch (error) {
        /* ignore */
      }
      try {
        return String(document.documentElement.lang || 'zh').toLowerCase();
      } catch (error) {
        return 'zh';
      }
    }

    function lookup(key, lang) {
      var dict = String(lang || '').indexOf('zh') === 0 ? ZH : EN;
      var value = dict[key];
      if (value === undefined) value = ZH[key];
      return value === undefined ? key : value;
    }

    function translate(key, params, lang) {
      var template = lookup(key, lang);
      if (!params) return template;
      return template.replace(/\{(\w+)\}/g, function (match, name) {
        return params[name] === undefined || params[name] === null ? match : String(params[name]);
      });
    }

    function tr(key, params) {
      return translate(key, params, language());
    }

    function translator(lang) {
      return function (key, params) {
        return translate(key, params, lang);
      };
    }

    /** 语言切换时触发一次重渲染（locale 服务不可用时退化为一次性渲染）。 */
    function useLocaleRevision() {
      var state = React.useState(0);
      var setRevision = state[1];
      React.useEffect(function () {
        var locale = runtime.locale;
        if (!locale || typeof locale.subscribe !== 'function') return undefined;
        var unsubscribe = null;
        try {
          unsubscribe = locale.subscribe(function () {
            setRevision(function (value) {
              return value + 1;
            });
          });
        } catch (error) {
          unsubscribe = null;
        }
        return function () {
          try {
            if (typeof unsubscribe === 'function') unsubscribe();
          } catch (error) {
            /* ignore */
          }
        };
      }, []);
      return state[0];
    }

    // ------------------------------------------------------------------
    // HTTP / 地址
    // ------------------------------------------------------------------
    function apiUrl(path) {
      try {
        return new URL(API_PREFIX + path, document.baseURI).href;
      } catch (error) {
        return '/' + API_PREFIX + path;
      }
    }

    function drawioEditorUrl() {
      var lang = String(language()).indexOf('zh') === 0 ? 'zh' : 'en';
      var relative = 'plugins/dsh-ppt-workbench/editor/index.html?embed=1&proto=json&spin=1&lang=' + lang +
        '&noSaveBtn=0&noExitBtn=1&saveAndExit=0';
      try {
        return new URL(relative, document.baseURI).href;
      } catch (error) {
        return '/' + relative;
      }
    }

    function jsonFetch(path, options) {
      return fetch(apiUrl(path), Object.assign({ credentials: 'include' }, options || {})).then(
        function (response) {
          return response.text().then(function (text) {
            var data;
            try {
              data = JSON.parse(text);
            } catch (error) {
              data = { raw: String(text).slice(0, 2000) };
            }
            return { status: response.status, ok: response.ok, data: data };
          });
        },
      );
    }

    /**
     * Feishu API paths: the Host currently registers `feishu-*` names; the
     * contract documents `feishu/*`. Try the documented path and fall back to the
     * dashed alias on 404 so both wire shapes work.
     */
    function feishuFetch(kind, query, options) {
      var suffix = '';
      if (query && typeof query === 'object') {
        var parts = [];
        Object.keys(query).forEach(function (key) {
          if (query[key] === undefined || query[key] === null || query[key] === '') return;
          parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(query[key])));
        });
        if (parts.length) suffix = '?' + parts.join('&');
      }
      var paths = ['feishu/' + kind + suffix, 'feishu-' + kind + suffix];
      var index = 0;
      function attempt() {
        return jsonFetch(paths[index], options).then(function (result) {
          if (!result.ok && result.status === 404 && index + 1 < paths.length) {
            index += 1;
            return attempt();
          }
          return result;
        });
      }
      return attempt();
    }

    /** `dsh-resource://file/session/<sid>/<encoded path>`，编码规则对齐宿主 sessionFileAddress。 */
    function decodeFilePath(address) {
      if (typeof address !== 'string') return address;
      var prefix = 'dsh-resource://file/';
      if (address.indexOf(prefix) !== 0) return address;
      var rest = address.slice(prefix.length);
      var slash = rest.indexOf('/');
      if (slash < 0) return rest;
      var scope = rest.slice(0, slash);
      var tail = rest.slice(slash + 1);
      if (scope !== 'session') return tail;
      var second = tail.indexOf('/');
      if (second < 0) return tail;
      var encoded = tail.slice(second + 1).split('/').map(function (part) {
        try {
          return decodeURIComponent(part);
        } catch (error) {
          return part;
        }
      }).join('/');
      return encoded;
    }

    function sessionIdFromAddress(address) {
      if (typeof address !== 'string') return undefined;
      var marker = 'dsh-resource://file/session/';
      if (address.indexOf(marker) !== 0) return undefined;
      var rest = address.slice(marker.length);
      var slash = rest.indexOf('/');
      var raw = slash < 0 ? rest : rest.slice(0, slash);
      try {
        return decodeURIComponent(raw);
      } catch (error) {
        return raw;
      }
    }

    function basename(path) {
      if (typeof path !== 'string' || !path) return '';
      var parts = path.replace(/\\/g, '/').split('/');
      return parts[parts.length - 1] || path;
    }

    // ------------------------------------------------------------------
    // 小工具
    // ------------------------------------------------------------------
    function clamp01(value) {
      var number = Number(value);
      if (!Number.isFinite(number)) return 0;
      if (number < 0) return 0;
      if (number > 1) return 1;
      return number;
    }

    function truncate(text, max) {
      var value = String(text === undefined || text === null ? '' : text).replace(/\s+/g, ' ').trim();
      if (!max || value.length <= max) return value;
      return value.slice(0, max - 1) + '…';
    }

    function shaShort(sha) {
      var value = String(sha || '');
      return value ? value.slice(0, 8) + '…' : 'unknown';
    }

    function pad2(value) {
      return value < 10 ? '0' + value : String(value);
    }

    function formatTime(value) {
      if (!value) return '';
      var date = new Date(value);
      if (!Number.isFinite(date.getTime())) return '';
      var now = new Date();
      var sameDay = date.getFullYear() === now.getFullYear() &&
        date.getMonth() === now.getMonth() &&
        date.getDate() === now.getDate();
      var clock = pad2(date.getHours()) + ':' + pad2(date.getMinutes());
      if (sameDay) return clock;
      return (date.getMonth() + 1) + '-' + pad2(date.getDate()) + ' ' + clock;
    }

    function normalizeError(resultOrError) {
      if (resultOrError && resultOrError.data && typeof resultOrError.data === 'object') {
        var data = resultOrError.data;
        if (data.code || data.ok === false) {
          return {
            code: String(data.code || 'http-' + (resultOrError.status || 0)),
            message: String(data.message || tr('error.generic')),
            status: resultOrError.status,
            currentSha: typeof data.currentSha === 'string' ? data.currentSha : undefined,
            opIndex: Number.isInteger(data.opIndex) ? data.opIndex : undefined,
          };
        }
        if (data.raw) {
          return {
            code: 'http-' + (resultOrError.status || 0),
            message: truncate(data.raw, 200) || tr('error.generic'),
            status: resultOrError.status,
          };
        }
      }
      if (resultOrError && resultOrError.code) {
        return {
          code: String(resultOrError.code),
          message: String(resultOrError.message || tr('error.generic')),
          status: resultOrError.status,
        };
      }
      if (resultOrError && resultOrError.name === 'AbortError') {
        return { code: 'aborted', message: '' };
      }
      return {
        code: 'network',
        message: resultOrError && resultOrError.message ? String(resultOrError.message) : tr('error.generic'),
      };
    }

    function errorHint(error, t) {
      if (!error) return '';
      switch (error.code) {
        case 'session-not-live':
        case 'missing-session':
          return t('error.session');
        case 'not-found':
          return t('error.notFound');
        case 'unsupported-format':
          return t('error.unsupported');
        case 'outside-workspace':
          return t('compose.noWrite');
        case 'network':
          return t('error.network');
        default:
          return t('error.hint');
      }
    }


    // ------------------------------------------------------------------
    // 编辑辅助（P1：python-pptx 结构化编辑）
    // ------------------------------------------------------------------
    var EMU_PER_INCH = 914400;

    function isShapeEditable(shape) {
      if (!shape) return false;
      if (shape.editable === false) return false;
      if (Array.isArray(shape.groupPath) && shape.groupPath.length > 0) return false;
      if (shape.hasPicture || shape.hasChart || shape.hasTable) return false;
      if (String(shape.type || '').indexOf('GROUP') >= 0) return false;
      // 没有文本框的对象（媒体/组合等）不提供文本与字体编辑
      if (shape.hasText === false) return false;
      return true;
    }

    /** 编辑模式下可被选中的顶层形状（表格/图表/图片可选中，只读展示）。 */
    function isShapeSelectable(shape) {
      if (!shape) return false;
      if (Array.isArray(shape.groupPath) && shape.groupPath.length > 0) return false;
      if (shape.editable === false && !shape.hasTable && !shape.hasChart && !shape.hasPicture) return false;
      return true;
    }

    function hitEditableShape(slide, pointXEmu, pointYEmu) {
      if (!slide || !Array.isArray(slide.shapes)) return null;
      for (var index = slide.shapes.length - 1; index >= 0; index -= 1) {
        var shape = slide.shapes[index];
        if (!shape || !isShapeSelectable(shape)) continue;
        var left = Number(shape.left);
        var top = Number(shape.top);
        var width = Number(shape.width);
        var height = Number(shape.height);
        if (![left, top, width, height].every(Number.isFinite)) continue;
        if (pointXEmu >= left && pointXEmu <= left + width && pointYEmu >= top && pointYEmu <= top + height) {
          return shape;
        }
      }
      return null;
    }

    function emuToInches(value) {
      var number = Number(value);
      if (!Number.isFinite(number)) return '';
      return String(Math.round((number / EMU_PER_INCH) * 100) / 100);
    }

    function inchesToEmu(value) {
      if (value === '' || value === null || value === undefined) return null;
      var number = Number(String(value).replace(',', '.'));
      if (!Number.isFinite(number)) return null;
      return Math.round(number * EMU_PER_INCH);
    }

    function normalizeHexColor(value) {
      var text = String(value === undefined || value === null ? '' : value).trim().replace(/^#/, '');
      if (/^[0-9a-fA-F]{6}$/.test(text)) return text.toUpperCase();
      if (/^[0-9a-fA-F]{3}$/.test(text)) {
        return (text.charAt(0) + text.charAt(0) + text.charAt(1) + text.charAt(1) + text.charAt(2) + text.charAt(2)).toUpperCase();
      }
      return '';
    }

    function shapeFont(shape) {
      return shape && shape.font && typeof shape.font === 'object' ? shape.font : {};
    }

    function shapeFullText(shape) {
      if (!shape) return '';
      if (typeof shape.text === 'string') return shape.text;
      return typeof shape.textPreview === 'string' ? shape.textPreview : '';
    }

    function shapeKeyOf(slideIndex, shapeId) {
      return String(slideIndex) + ':' + String(shapeId);
    }

    function findShapeAt(slides, slideIndex, shapeId) {
      if (!Array.isArray(slides) || !Number.isInteger(slideIndex)) return null;
      var slide = slides[slideIndex];
      if (!slide || !Array.isArray(slide.shapes)) return null;
      for (var index = 0; index < slide.shapes.length; index += 1) {
        var shape = slide.shapes[index];
        if (shape && shape.shapeId === shapeId) return shape;
      }
      return null;
    }

    /** 把 pendingOps 叠加到 inventory 上，供选中框、属性面板与 hover 使用。 */
    function buildPendingView(slides, pendingOps) {
      if (!Array.isArray(slides)) return { slides: EMPTY_LIST, notes: new Map() };
      if (!Array.isArray(pendingOps) || pendingOps.length === 0) {
        return { slides: slides, notes: new Map() };
      }
      var cloned = null;
      var index = null;
      var notes = new Map();
      function ensure() {
        if (cloned) return;
        cloned = slides.map(function (slide) {
          return Object.assign({}, slide, {
            shapes: Array.isArray(slide.shapes)
              ? slide.shapes.map(function (shape) { return Object.assign({}, shape); })
              : [],
          });
        });
        index = new Map();
        cloned.forEach(function (slide, slideIndex) {
          (slide.shapes || []).forEach(function (shape) {
            index.set(shapeKeyOf(slideIndex, shape.shapeId), shape);
          });
        });
      }
      pendingOps.forEach(function (op) {
        if (!op) return;
        if (op.op === 'setNotes') {
          ensure();
          notes.set(op.slideIndex, String(op.text === undefined ? '' : op.text));
          return;
        }
        if (!Number.isInteger(op.slideIndex) || !Number.isInteger(op.shapeId)) return;
        ensure();
        var shape = index.get(shapeKeyOf(op.slideIndex, op.shapeId));
        if (!shape) return;
        if (op.op === 'setText') {
          shape.text = String(op.text === undefined ? '' : op.text);
          shape.textPreview = truncate(shape.text, 80);
        } else if (op.op === 'setFont') {
          var font = Object.assign({}, shape.font || {});
          if (op.sizePt !== undefined) font.sizePt = op.sizePt;
          if (op.bold !== undefined) font.bold = !!op.bold;
          if (op.italic !== undefined) font.italic = !!op.italic;
          if (op.color !== undefined) font.color = op.color;
          shape.font = font;
        } else if (op.op === 'setShapeBox') {
          ['left', 'top', 'width', 'height'].forEach(function (field) {
            if (op[field] !== undefined) shape[field] = op[field];
          });
        } else if (op.op === 'setTableCell') {
          if (!shape.table || !Array.isArray(shape.table.cells)) return;
          if (!Number.isInteger(op.row) || !Number.isInteger(op.col)) return;
          var cells = shape.table.cells.map(function (row) { return Array.isArray(row) ? row.slice() : []; });
          while (cells.length <= op.row) cells.push([]);
          while (cells[op.row].length <= op.col) cells[op.row].push('');
          cells[op.row][op.col] = String(op.text === undefined ? '' : op.text);
          shape.table = Object.assign({}, shape.table, {
            cells: cells,
            rows: Math.max(Number(shape.table.rows) || 0, cells.length),
            cols: Math.max(Number(shape.table.cols) || 0, cells[0] ? cells[0].length : 0),
          });
        }
      });
      return { slides: cloned || slides, notes: notes };
    }

    function findViewShape(viewSlides, slideIndex, shapeId) {
      return findShapeAt(viewSlides, slideIndex, shapeId);
    }

    /** 形状 -> 表单字符串（英寸、pt、hex）。 */
    function shapeForm(shape) {
      var font = shapeFont(shape);
      var table = shape && shape.table && Array.isArray(shape.table.cells) ? shape.table.cells : null;
      return {
        text: shapeFullText(shape),
        sizePt: font.sizePt === undefined || font.sizePt === null ? '' : String(font.sizePt),
        bold: !!font.bold,
        italic: !!font.italic,
        color: normalizeHexColor(font.color),
        left: emuToInches(shape && shape.left),
        top: emuToInches(shape && shape.top),
        width: emuToInches(shape && shape.width),
        height: emuToInches(shape && shape.height),
        cells: table ? table.map(function (row) { return (Array.isArray(row) ? row : []).map(function (value) { return String(value === undefined || value === null ? '' : value); }); }) : [],
      };
    }

    /** 表单与 inventory 的差异 -> 结构化 ops。 */
    function shapeFormOps(shape, form, slideIndex) {
      var ops = [];
      if (!shape || !Number.isInteger(shape.shapeId) || !form) return ops;
      if (!Number.isInteger(slideIndex)) return ops;
      var shapeId = shape.shapeId;
      if (typeof form.text === 'string' && form.text.length <= 4000 && form.text !== shapeFullText(shape)) {
        ops.push({ op: 'setText', slideIndex: slideIndex, shapeId: shapeId, text: form.text });
      }
      var font = shapeFont(shape);
      var fontOp = { op: 'setFont', slideIndex: slideIndex, shapeId: shapeId };
      var fontChanged = false;
      var size = Number(String(form.sizePt === undefined ? '' : form.sizePt).replace(',', '.'));
      if (Number.isFinite(size) && size > 0 && size <= 400 && size !== Number(font.sizePt)) {
        fontOp.sizePt = size;
        fontChanged = true;
      }
      if (!!form.bold !== !!font.bold) {
        fontOp.bold = !!form.bold;
        fontChanged = true;
      }
      if (!!form.italic !== !!font.italic) {
        fontOp.italic = !!form.italic;
        fontChanged = true;
      }
      var color = normalizeHexColor(form.color);
      if (color && color !== normalizeHexColor(font.color)) {
        fontOp.color = color;
        fontChanged = true;
      }
      if (fontChanged) ops.push(fontOp);
      var boxOp = { op: 'setShapeBox', slideIndex: slideIndex, shapeId: shapeId };
      var boxChanged = false;
      ['left', 'top', 'width', 'height'].forEach(function (field) {
        var originalEmu = Number(shape[field]);
        var displayed = emuToInches(originalEmu);
        var raw = form[field] === undefined || form[field] === null ? '' : String(form[field]).trim();
        // 表单按 2 位小数的英寸展示；未改动的字段直接跳过，避免四舍五入造成伪 diff。
        if (raw === displayed) return;
        var emu = inchesToEmu(raw);
        if (emu !== null && emu !== originalEmu) {
          boxOp[field] = emu;
          boxChanged = true;
        }
      });
      if (boxChanged) ops.push(boxOp);
      if (shape.table && Array.isArray(shape.table.cells) && Array.isArray(form.cells)) {
        var oldCells = shape.table.cells;
        form.cells.forEach(function (row, rowIndex) {
          if (!Array.isArray(row)) return;
          row.forEach(function (value, colIndex) {
            var old = oldCells[rowIndex] && oldCells[rowIndex][colIndex];
            var oldText = old === undefined || old === null ? '' : String(old);
            var text = String(value === undefined || value === null ? '' : value);
            if (text.length <= 1000 && text !== oldText) {
              ops.push({ op: 'setTableCell', slideIndex: slideIndex, shapeId: shapeId, row: rowIndex, col: colIndex, text: text });
            }
          });
        });
      }
      return ops;
    }

    function notesFormOp(slideIndex, notes, currentNotes) {
      if (!Number.isInteger(slideIndex)) return [];
      var text = String(notes === undefined || notes === null ? '' : notes);
      if (text.length > 10000) return [];
      if (text === String(currentNotes === undefined || currentNotes === null ? '' : currentNotes)) return [];
      return [{ op: 'setNotes', slideIndex: slideIndex, text: text }];
    }

    function extractHistory(data) {
      if (!data) return null;
      var source = data.edit && data.edit.history
        ? data.edit.history
        : data.deck && data.deck.history
          ? data.deck.history
          : data.history;
      if (!source) return null;
      return {
        version: Number(source.version) || 0,
        cursor: Number(source.cursor) || 0,
        canUndo: source.canUndo === true,
        canRedo: source.canRedo === true,
      };
    }

    var AUTOSAVE_STORAGE_KEY = 'dsh-ppt-wb-autosave';
    var MIN_SHAPE_EMU = 91440; // 0.1in

    function readAutosavePref() {
      try {
        return window.localStorage.getItem(AUTOSAVE_STORAGE_KEY) !== 'off';
      } catch (error) {
        return true;
      }
    }

    function writeAutosavePref(enabled) {
      try {
        window.localStorage.setItem(AUTOSAVE_STORAGE_KEY, enabled ? 'on' : 'off');
      } catch (error) {
        /* localStorage 不可用时仅内存生效 */
      }
    }

    function formatClock(timestamp) {
      var date = new Date(timestamp);
      if (!Number.isFinite(date.getTime())) return '';
      return pad2(date.getHours()) + ':' + pad2(date.getMinutes());
    }

    function clampNumber(value, min, max) {
      if (!Number.isFinite(value)) return min;
      if (value < min) return min;
      if (value > max) return max;
      return value;
    }

    /** pendingOps 去重键：同一目标的同类 op 合并，避免自动草稿堆叠。 */
    function pendingOpKey(op) {
      if (!op || typeof op.op !== 'string') return '';
      if (op.op === 'setNotes') return 'setNotes:' + op.slideIndex;
      if (op.op === 'setTableCell') {
        return 'setTableCell:' + op.slideIndex + ':' + op.shapeId + ':' + op.row + ':' + op.col;
      }
      if (op.shapeId === undefined || op.shapeId === null) {
        return op.op + ':' + op.slideIndex;
      }
      return op.op + ':' + op.slideIndex + ':' + op.shapeId;
    }

    function mergePendingOps(existing, incoming) {
      var result = Array.isArray(existing) ? existing.slice() : [];
      if (!Array.isArray(incoming)) return result;
      incoming.forEach(function (op) {
        if (!op) return;
        var key = pendingOpKey(op);
        var replaced = false;
        if (key) {
          for (var index = result.length - 1; index >= 0; index -= 1) {
            if (pendingOpKey(result[index]) === key) {
              result[index] = result[index].op === 'setFont' || result[index].op === 'setShapeBox'
                ? Object.assign({}, result[index], op)
                : op;
              replaced = true;
              break;
            }
          }
        }
        if (!replaced) result.push(op);
      });
      return result;
    }

    function boxPercentStyle(box, slideWidthEmu, slideHeightEmu) {
      if (!box || !slideWidthEmu || !slideHeightEmu) return null;
      return {
        left: (Number(box.left) / slideWidthEmu) * 100 + '%',
        top: (Number(box.top) / slideHeightEmu) * 100 + '%',
        width: (Number(box.width) / slideWidthEmu) * 100 + '%',
        height: (Number(box.height) / slideHeightEmu) * 100 + '%',
      };
    }

    function handlePositionStyle(dir, box) {
      var x = parseFloat(box.left);
      var y = parseFloat(box.top);
      var w = parseFloat(box.width);
      var h = parseFloat(box.height);
      var cx = dir.indexOf('w') >= 0 ? x : dir.indexOf('e') >= 0 ? x + w : x + w / 2;
      var cy = dir.indexOf('n') >= 0 ? y : dir.indexOf('s') >= 0 ? y + h : y + h / 2;
      return { left: cx + '%', top: cy + '%' };
    }

    function shapeCanInlineEdit(shape) {
      if (!shape) return false;
      if (!isShapeEditable(shape)) return false;
      if (shape.hasText === false) return false;
      if (shape.hasTable || shape.hasChart || shape.hasPicture) return false;
      return true;
    }

    function editErrorText(error, t) {
      if (!error) return t('edit.unknown');
      if (error.code === 'stale') return '';
      if (error.code === 'bad-op') {
        var suffix = error.opIndex === undefined || error.opIndex === null
          ? ''
          : t('edit.badOpIndex', { index: Number(error.opIndex) + 1 });
        return t('edit.badOp', { message: error.message || t('edit.unknown') }) + suffix;
      }
      if (error.code === 'no-history') return t('edit.noHistory');
      if (error.code === 'outside-workspace') return t('edit.previewOnly');
      if (error.code === 'not-found') return t('error.notFound');
      if (error.code === 'session-not-live') return t('error.session');
      if (error.code === 'unsupported-format') return t('error.unsupported');
      if (error.code === 'http-404' || error.code === 'not-implemented') return t('edit.notSupported');
      return t('edit.failed', { message: error.message || t('edit.unknown') });
    }

    // ------------------------------------------------------------------
    // 样式（只用 --dsw-* token；亮/暗主题共用）
    // ------------------------------------------------------------------
    var CSS = [
      '[data-ppt-workbench]{box-sizing:border-box}',
      '[data-ppt-workbench] *{box-sizing:border-box}',
      '.wb-root{position:relative;display:flex;flex-direction:column;width:100%;height:100%;min-height:0;overflow:hidden;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);font-family:var(--dsw-alias-font-family,var(--dsw-font-family,inherit));font-size:13px;line-height:1.5;white-space:normal;text-align:left}',
      '.wb-root button{font-family:inherit}',
      '.wb-progress{position:absolute;top:0;left:0;right:0;height:2px;overflow:hidden;z-index:30;background:var(--dsw-alias-bg-layer-2,transparent)}',
      '.wb-progress::after{content:"";position:absolute;top:0;bottom:0;width:40%;background:var(--dsw-alias-brand-primary,#4d6bfe);animation:wb-indeterminate 1.1s ease-in-out infinite}',
      '@keyframes wb-indeterminate{0%{left:-40%}100%{left:100%}}',
      '.wb-banner{flex:none;display:flex;align-items:flex-start;gap:8px;padding:6px 10px;font-size:12px;line-height:1.45;border-bottom:.5px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));background:var(--dsw-alias-bg-layer-2,#f4f4f5);color:var(--dsw-alias-label-primary,#1a1a1a)}',
      '.wb-banner[data-kind="warn"]{background:var(--dsw-alias-state-warn-tertiary,#fff7e6);color:var(--dsw-alias-label-primary,#1a1a1a)}',
      '.wb-banner[data-kind="error"]{background:var(--dsw-alias-state-error-secondary,#fdecec);color:var(--dsw-alias-state-error-primary,#d92d20)}',
      '.wb-bannerIcon{flex:none;line-height:1.3}',
      '.wb-bannerText{flex:1 1 auto;min-width:0;word-break:break-word}',
      '.wb-toolbar{position:relative;z-index:20;flex:none;display:flex;align-items:center;flex-wrap:wrap;gap:6px 8px;padding:6px 10px;min-height:40px;border-bottom:.5px solid var(--dsw-alias-border-l3,rgba(128,128,128,.3));background:var(--dsw-alias-bg-base,#fff)}',
      '.wb-group{display:inline-flex;align-items:center;gap:2px;flex:none}',
      '.wb-spacer{flex:1 1 auto;min-width:4px}',
      '.wb-btn{appearance:none;-webkit-appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:5px;height:26px;padding:0 8px;border:.5px solid transparent;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-secondary,#555);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}',
      '.wb-btn:hover:not([disabled]){background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14));color:var(--dsw-alias-label-primary,#1a1a1a)}',
      '.wb-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:1px}',
      '.wb-btn[disabled]{opacity:.45;cursor:default}',
      '.wb-btn[aria-pressed="true"]{background:var(--dsw-alias-interactive-bg-active,rgba(77,107,254,.16));color:var(--dsw-alias-brand-primary,#4d6bfe);border-color:var(--dsw-alias-brand-primary,#4d6bfe)}',
      '.wb-btn.wb-primary{background:var(--dsw-alias-button-primary-fill,#4d6bfe);color:var(--dsw-alias-label-primary-inverted,#fff);border-color:transparent}',
      '.wb-btn.wb-primary:hover:not([disabled]){background:var(--dsw-alias-button-primary-hover,#3b5bf0);color:var(--dsw-alias-label-primary-inverted,#fff)}',
      '.wb-btn.wb-icon{width:26px;padding:0}',
      '.wb-count{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary,#555);font-size:12px;min-width:52px;text-align:center;white-space:nowrap}',
      '.wb-chip{display:inline-flex;align-items:center;gap:4px;height:22px;padding:0 8px;border-radius:999px;border:.5px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));background:var(--dsw-alias-bg-layer-2,#f4f4f5);color:var(--dsw-alias-label-secondary,#555);font-size:11px;cursor:pointer;white-space:nowrap}',
      '.wb-chip:hover{color:var(--dsw-alias-label-primary,#1a1a1a);background:var(--dsw-alias-bg-layer-3,#e9e9ea)}',
      '.wb-chip[data-info="true"]{cursor:default;color:var(--dsw-alias-label-tertiary,#888)}',
      '.wb-chip.wb-chipWarn{color:var(--dsw-alias-state-warn-label,#b45309);border-color:var(--dsw-alias-state-warn-secondary,rgba(217,119,6,.4));background:var(--dsw-alias-state-warn-tertiary,#fff7e6)}',
      '.wb-chipWrap{position:relative;display:inline-flex}',
      '.wb-miniSpinner{width:10px;height:10px;border-radius:50%;border:1.5px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));border-top-color:var(--dsw-alias-brand-primary,#4d6bfe);animation:wb-spin .8s linear infinite;display:inline-block}',
      '.wb-popover{position:absolute;top:calc(100% + 6px);right:0;z-index:50;width:min(300px,calc(100vw - 40px));padding:12px;border-radius:var(--dsw-radius-lg,10px);border:.5px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));background:var(--dsw-alias-bg-layer-2,#fff);box-shadow:var(--dsw-elevation-prominent,0 8px 28px rgba(0,0,0,.2));color:var(--dsw-alias-label-primary,#1a1a1a);font-size:12px;line-height:1.5;text-align:left}',
      '.wb-popoverHead{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px}',
      '.wb-popoverHint{margin:0 0 8px;color:var(--dsw-alias-label-secondary,#555)}',
      '.wb-fontList{margin:0;padding:0;list-style:none;max-height:180px;overflow:auto}',
      '.wb-fontItem{padding:4px 0;border-top:.5px solid var(--dsw-alias-border-l2,rgba(128,128,128,.2));font-family:var(--dsw-alias-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11.5px;word-break:break-all}',
      '.wb-main{position:relative;flex:1 1 auto;min-height:0;display:flex;overflow:hidden}',
      '.wb-rail{flex:none;width:96px;border-right:.5px solid var(--dsw-alias-border-l3,rgba(128,128,128,.3));overflow-y:auto;overflow-x:hidden;background:var(--dsw-alias-bg-layer-1,#f7f7f8);padding:8px 6px;display:flex;flex-direction:column;gap:8px;scrollbar-width:thin}',
      '.wb-thumb{appearance:none;position:relative;flex:none;width:100%;padding:0;border:2px solid transparent;border-radius:5px;background:var(--dsw-alias-bg-layer-3,#eee);cursor:pointer;overflow:hidden;display:block}',
      '.wb-thumb:hover{border-color:var(--dsw-alias-border-l2,rgba(128,128,128,.4))}',
      '.wb-thumb.isCurrent{border-color:var(--dsw-alias-brand-primary,#4d6bfe)}',
      '.wb-thumb img{display:block;width:100%;height:100%;object-fit:contain;background:#fff}',
      '.wb-thumbLoading{display:block;width:100%;height:100%;background:linear-gradient(90deg,var(--dsw-alias-bg-skeleton,#ececec) 25%,var(--dsw-alias-bg-layer-2,#f6f6f6) 37%,var(--dsw-alias-bg-skeleton,#ececec) 63%);background-size:400% 100%;animation:wb-shimmer 1.4s ease infinite}',
      '.wb-thumbNum{position:absolute;left:3px;top:2px;font-size:10px;line-height:1.3;padding:0 3px;border-radius:3px;background:rgba(0,0,0,.5);color:#fff}',
      '.wb-thumbDot{position:absolute;right:3px;bottom:3px;width:6px;height:6px;border-radius:3px;background:var(--dsw-alias-brand-primary,#4d6bfe);box-shadow:0 0 0 1px rgba(255,255,255,.85)}',
      '.wb-canvas{position:relative;flex:1 1 0;min-width:0;min-height:0;overflow:auto;background:var(--dsw-alias-bg-document-preview,var(--dsw-alias-bg-layer-1,#f0f0f2));outline:none;scrollbar-width:thin}',
      '.wb-canvas:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:-2px}',
      '.wb-canvas.wb-annotating .wb-page{cursor:crosshair;touch-action:none;user-select:none}',
      '.wb-annotateHint{flex:none;display:flex;align-items:center;gap:6px;padding:5px 10px;font-size:11.5px;line-height:1.45;color:var(--dsw-alias-label-secondary,#555);background:var(--dsw-alias-bg-layer-2,#f4f4f5);border-bottom:.5px solid var(--dsw-alias-border-l3,rgba(128,128,128,.3))}',
      '.wb-shapeHover{position:absolute;border:1.5px dashed var(--dsw-alias-brand-primary,#4d6bfe);background:rgba(77,107,254,.08);border-radius:2px;pointer-events:none;z-index:2}',
      '.wb-shapeName{position:absolute;left:0;top:-19px;max-width:100%;font-size:10.5px;line-height:16px;padding:0 5px;border-radius:3px;background:var(--dsw-alias-brand-primary,#4d6bfe);color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.wb-shapeSel{position:absolute;border:2px solid var(--dsw-alias-brand-primary,#4d6bfe);background:rgba(77,107,254,.10);border-radius:2px;pointer-events:none;z-index:3}',
      '.wb-areaSel{position:absolute;border:1.5px dashed var(--dsw-alias-brand-primary,#4d6bfe);background:rgba(77,107,254,.08);border-radius:2px;pointer-events:none;z-index:3}',
      '.wb-marquee{position:absolute;border:1px dashed var(--dsw-alias-brand-primary,#4d6bfe);background:rgba(77,107,254,.12);pointer-events:none;z-index:5}',
      '.wb-pages{display:flex;flex-direction:column;align-items:center;gap:10px;padding:12px;margin:0 auto;width:fit-content;min-width:100%}',
      '.wb-page{position:relative;flex:none;scroll-margin-top:8px;background:#fff;border-radius:3px;box-shadow:0 1px 2px rgba(0,0,0,.16),0 2px 10px rgba(0,0,0,.08)}',
      '.wb-page img.wb-slide{display:block;width:100%;height:auto;border-radius:3px;user-select:none;-webkit-user-drag:none}',
      '.wb-pagePlaceholder{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;width:100%;background:var(--dsw-alias-bg-skeleton,#ececec);color:var(--dsw-alias-label-tertiary,#888);font-size:12px;border-radius:3px;padding:12px;text-align:center}',
      '.wb-pagePlaceholder[data-error="true"]{background:var(--dsw-alias-state-error-secondary,#fdecec);color:var(--dsw-alias-state-error-primary,#d92d20)}',
      '.wb-pageTruncated{padding:14px 12px 24px;color:var(--dsw-alias-label-tertiary,#888);font-size:12px;text-align:center}',
      '.wb-pins{position:absolute;inset:0;pointer-events:none}',
      '.wb-pin{appearance:none;pointer-events:auto;position:absolute;width:22px;height:22px;margin:-11px 0 0 -11px;display:flex;align-items:center;justify-content:center;border-radius:999px;border:1.5px solid rgba(255,255,255,.92);background:var(--dsw-alias-brand-primary,#4d6bfe);color:#fff;font:inherit;font-size:11px;font-weight:600;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.35);padding:0;line-height:1}',
      '.wb-pin:hover{filter:brightness(1.1)}',
      '.wb-pin[data-status="resolved"]{background:var(--dsw-alias-state-success-primary,#16a34a);opacity:.9}',
      '.wb-pin[data-status="orphaned"]{background:var(--dsw-alias-state-warn-primary,#d97706)}',
      '.wb-pin[data-selected="true"]{outline:3px solid var(--dsw-alias-bg-document-selection,rgba(77,107,254,.35));outline-offset:1px;z-index:3}',
      '.wb-editor{position:absolute;z-index:6;max-width:calc(100% - 16px);padding:10px;display:flex;flex-direction:column;gap:7px;border-radius:var(--dsw-radius-lg,10px);border:.5px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));background:var(--dsw-alias-bg-layer-2,#fff);box-shadow:var(--dsw-elevation-prominent,0 10px 30px rgba(0,0,0,.22));color:var(--dsw-alias-label-primary,#1a1a1a)}',
      '.wb-editorHead{display:flex;flex-direction:column;gap:2px;min-width:0}',
      '.wb-editorTitle{font-size:12.5px;font-weight:600}',
      '.wb-editorAnchor{font-size:11px;color:var(--dsw-alias-label-tertiary,#888);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.wb-textarea{width:100%;min-height:64px;max-height:180px;resize:vertical;padding:7px 8px;border:.5px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);font:inherit;font-size:12.5px;line-height:1.5;box-sizing:border-box}',
      '.wb-textarea:focus{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:0}',
      '.wb-editorFoot{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}',
      '.wb-hint{font-size:11px;color:var(--dsw-alias-label-tertiary,#888)}',
      '.wb-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0}',
      '.wb-drawer{flex:none;display:flex;flex-direction:column;min-height:34px;max-height:48%;border-top:.5px solid var(--dsw-alias-border-l3,rgba(128,128,128,.3));background:var(--dsw-alias-bg-layer-1,#f7f7f8)}',
      '.wb-drawerHead{flex:none;display:flex;align-items:center;flex-wrap:wrap;gap:2px 6px;padding:4px 8px;min-height:34px}',
      '.wb-drawerTitle{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary,#1a1a1a);margin-right:2px;white-space:nowrap}',
      '.wb-tabs{display:inline-flex;align-items:center;gap:2px;flex-wrap:wrap;min-width:0}',
      '.wb-tab{appearance:none;display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 8px;border:none;border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary,#555);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}',
      '.wb-tab:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14))}',
      '.wb-tab[aria-selected="true"]{background:var(--dsw-alias-button-ghost-active-fill,rgba(128,128,128,.16));color:var(--dsw-alias-label-primary,#1a1a1a);font-weight:600}',
      '.wb-tab:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:1px}',
      '.wb-tabCount{font-size:10.5px;line-height:1;min-width:16px;padding:2px 5px;border-radius:8px;background:var(--dsw-alias-bg-layer-3,rgba(128,128,128,.18));color:var(--dsw-alias-label-secondary,#555)}',
      '.wb-drawerBody{flex:1 1 auto;min-height:0;overflow-y:auto;padding:0 8px 8px;display:flex;flex-direction:column;gap:6px;scrollbar-width:thin}',
      '.wb-card{border:.5px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-2,#fff);padding:7px 9px;display:flex;flex-direction:column;gap:4px;font-size:12px;min-width:0;cursor:pointer}',
      '.wb-card:hover{border-color:var(--dsw-alias-border-l3,rgba(128,128,128,.5))}',
      '.wb-card[data-selected="true"]{border-color:var(--dsw-alias-brand-primary,#4d6bfe);box-shadow:inset 0 0 0 1px var(--dsw-alias-brand-primary,#4d6bfe)}',
      '.wb-card:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:1px}',
      '.wb-cardHead{display:flex;align-items:center;gap:6px;min-width:0}',
      '.wb-badge{flex:none;font-size:10.5px;line-height:1.4;padding:0 5px;border-radius:4px;background:var(--dsw-alias-bg-layer-3,rgba(128,128,128,.18));color:var(--dsw-alias-label-secondary,#555);white-space:nowrap}',
      '.wb-quote{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary,#555)}',
      '.wb-quoteMuted{color:var(--dsw-alias-label-tertiary,#888);font-style:italic}',
      '.wb-meta{font-size:11px;color:var(--dsw-alias-label-tertiary,#888);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}',
      '.wb-bodyText{white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-primary,#1a1a1a);line-height:1.5}',
      '.wb-bodyText.wb-clamp{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
      '.wb-orphanHint{font-size:11px;color:var(--dsw-alias-state-warn-label,#b45309)}',
      '.wb-replies{margin:2px 0 0;padding:4px 0 0;border-top:.5px dashed var(--dsw-alias-border-l2,rgba(128,128,128,.3));display:flex;flex-direction:column;gap:4px}',
      '.wb-reply{font-size:11.5px;min-width:0}',
      '.wb-replyBody{white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-primary,#1a1a1a)}',
      '.wb-replyMeta{color:var(--dsw-alias-label-tertiary,#888);font-size:10.5px}',
      '.wb-actions{display:flex;align-items:center;gap:2px;flex-wrap:wrap;margin-top:1px}',
      '.wb-linkBtn{appearance:none;border:none;background:transparent;color:var(--dsw-alias-label-secondary,#555);font:inherit;font-size:11.5px;padding:2px 6px;border-radius:var(--dsw-radius-sm,5px);cursor:pointer;white-space:nowrap}',
      '.wb-linkBtn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14));color:var(--dsw-alias-label-primary,#1a1a1a)}',
      '.wb-linkBtn[data-danger="true"]:hover{color:var(--dsw-alias-state-error-primary,#d92d20);background:var(--dsw-alias-interactive-bg-hover-danger,rgba(217,45,32,.1))}',
      '.wb-linkBtn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:1px}',
      '.wb-replyBox{display:flex;flex-direction:column;gap:5px;margin-top:2px}',
      '.wb-empty{padding:18px 12px;text-align:center;color:var(--dsw-alias-label-tertiary,#888);font-size:12px;line-height:1.6}',
      '.wb-center{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:24px;text-align:center}',
      '.wb-centerTitle{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary,#1a1a1a)}',
      '.wb-centerText{max-width:460px;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary,#555);word-break:break-word}',
      '.wb-centerHint{max-width:460px;font-size:11.5px;line-height:1.55;color:var(--dsw-alias-label-tertiary,#888)}',
      '.wb-path{max-width:100%;font-family:var(--dsw-alias-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:10.5px;color:var(--dsw-alias-label-tertiary,#888);word-break:break-all}',
      '.wb-spinner{width:22px;height:22px;border-radius:50%;border:2px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));border-top-color:var(--dsw-alias-brand-primary,#4d6bfe);animation:wb-spin .8s linear infinite}',
      '@keyframes wb-spin{to{transform:rotate(360deg)}}',
      '.wb-skeleton{width:min(420px,100%);aspect-ratio:16/9;border-radius:6px;background:linear-gradient(90deg,var(--dsw-alias-bg-skeleton,#ececec) 25%,var(--dsw-alias-bg-layer-2,#f6f6f6) 37%,var(--dsw-alias-bg-skeleton,#ececec) 63%);background-size:400% 100%;animation:wb-shimmer 1.4s ease infinite}',
      '@keyframes wb-shimmer{0%{background-position:100% 50%}100%{background-position:0 50%}}',
      '.wb-errorIcon{width:30px;height:30px;border-radius:999px;display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-state-error-secondary,#fdecec);color:var(--dsw-alias-state-error-primary,#d92d20);font-size:16px;font-weight:700}',
      '.wb-code{display:inline-block;font-family:var(--dsw-alias-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:10.5px;padding:1px 6px;border-radius:4px;background:var(--dsw-alias-bg-layer-3,rgba(128,128,128,.18));color:var(--dsw-alias-label-secondary,#555);word-break:break-all}',
      '.wb-toast{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);z-index:60;display:flex;align-items:flex-start;gap:8px;max-width:calc(100% - 24px);padding:8px 10px;border-radius:var(--dsw-radius-md,8px);border:.5px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-2,#fff));box-shadow:var(--dsw-elevation-prominent,0 10px 30px rgba(0,0,0,.22));color:var(--dsw-alias-label-primary,#1a1a1a);font-size:12px;line-height:1.5}',
      '.wb-toast[data-kind="success"]{border-color:var(--dsw-alias-state-success-primary,#16a34a)}',
      '.wb-toast[data-kind="error"]{border-color:var(--dsw-alias-state-error-primary,#d92d20);color:var(--dsw-alias-state-error-primary,#d92d20)}',
      '.wb-toastText{flex:1 1 auto;min-width:0;word-break:break-word}',
      '.wb-toastManual{flex-direction:column;max-height:60%}',
      '.wb-toastPre{margin:4px 0 0;max-height:180px;overflow:auto;white-space:pre-wrap;word-break:break-word;font-family:var(--dsw-alias-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11px;color:var(--dsw-alias-label-secondary,#555);background:var(--dsw-alias-bg-layer-1,#f7f7f8);border-radius:var(--dsw-radius-sm,5px);padding:6px 8px}',
      '.wb-drawer[data-mode="edit"]{max-height:60%}',
      '.wb-editBar{flex:none;display:flex;align-items:center;flex-wrap:wrap;gap:4px 8px;padding:5px 10px;font-size:11.5px;line-height:1.45;color:var(--dsw-alias-label-secondary,#555);background:var(--dsw-alias-bg-layer-2,#f4f4f5);border-bottom:.5px solid var(--dsw-alias-border-l3,rgba(128,128,128,.3))}',
      '.wb-editBarLabel{font-weight:600;color:var(--dsw-alias-label-primary,#1a1a1a);white-space:nowrap}',
      '.wb-editBarSpacer{flex:1 1 auto;min-width:4px}',
      '.wb-menuWrap{position:relative;display:inline-flex}',
      '.wb-menu{position:absolute;top:calc(100% + 6px);left:0;z-index:55;min-width:190px;padding:5px;border-radius:var(--dsw-radius-md,8px);border:.5px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));background:var(--dsw-alias-bg-layer-2,#fff);box-shadow:var(--dsw-elevation-prominent,0 10px 28px rgba(0,0,0,.22));display:flex;flex-direction:column;gap:1px;text-align:left}',
      '.wb-menuItem{appearance:none;border:none;background:transparent;color:var(--dsw-alias-label-primary,#1a1a1a);font:inherit;font-size:12px;text-align:left;padding:5px 8px;border-radius:var(--dsw-radius-sm,5px);cursor:pointer;white-space:nowrap}',
      '.wb-menuItem:hover:not([disabled]){background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14))}',
      '.wb-menuItem[disabled]{opacity:.45;cursor:default}',
      '.wb-menuItem[data-danger="true"]:hover:not([disabled]){color:var(--dsw-alias-state-error-primary,#d92d20);background:var(--dsw-alias-interactive-bg-hover-danger,rgba(217,45,32,.1))}',
      '.wb-menuHint{padding:4px 8px;font-size:10.5px;line-height:1.45;color:var(--dsw-alias-label-tertiary,#888);white-space:normal;max-width:230px}',
      '.wb-menuSep{height:1px;margin:4px 6px;background:var(--dsw-alias-border-l2,rgba(128,128,128,.25))}',
      '.wb-section{display:flex;flex-direction:column;gap:6px;padding:8px 0 2px;border-top:.5px solid var(--dsw-alias-border-l2,rgba(128,128,128,.25))}',
      '.wb-section:first-child{border-top:none;padding-top:2px}',
      '.wb-sectionTitle{font-size:11.5px;font-weight:600;color:var(--dsw-alias-label-secondary,#555);display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
      '.wb-fieldGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:6px 8px}',
      '.wb-field{display:flex;flex-direction:column;gap:2px;min-width:0}',
      '.wb-fieldLabel{font-size:10.5px;color:var(--dsw-alias-label-tertiary,#888)}',
      '.wb-input{width:100%;min-width:0;height:26px;padding:0 6px;border:.5px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);font:inherit;font-size:12px}',
      '.wb-input:focus{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:0}',
      '.wb-input[type="number"]{font-variant-numeric:tabular-nums}',
      '.wb-colorRow{display:flex;align-items:center;gap:6px;min-width:0}',
      '.wb-colorInput{flex:none;width:30px;height:26px;padding:0;border:.5px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));border-radius:var(--dsw-radius-sm,6px);background:transparent;cursor:pointer}',
      '.wb-tableWrap{max-height:190px;overflow:auto;border:.5px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));border-radius:var(--dsw-radius-sm,6px);scrollbar-width:thin}',
      '.wb-table{border-collapse:collapse;width:100%;font-size:11.5px}',
      '.wb-table td{border:.5px solid var(--dsw-alias-border-l2,rgba(128,128,128,.25));padding:2px}',
      '.wb-table .wb-input{height:24px;border-color:transparent;background:transparent;font-size:11.5px}',
      '.wb-table .wb-input:focus{border-color:transparent}',
      '.wb-readonlyBox{padding:8px;border:.5px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-layer-1,#f7f7f8);color:var(--dsw-alias-label-secondary,#555);font-size:11.5px;line-height:1.55;white-space:pre-wrap;word-break:break-word}',
      '.wb-chartSeries{display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--dsw-alias-label-secondary,#555)}',
      '.wb-inlineText{position:absolute;z-index:8;box-sizing:border-box;margin:0;padding:2px 5px;border:1.5px solid var(--dsw-alias-brand-primary,#4d6bfe);border-radius:2px;background:rgba(255,255,255,.97);color:#1a1a1a;line-height:1.3;resize:none;overflow:auto;font-family:inherit;box-shadow:0 4px 18px rgba(0,0,0,.28);white-space:pre-wrap;word-break:break-word}',
      '.wb-inlineText:focus{outline:none}',
      '.wb-handle{position:absolute;width:9px;height:9px;margin:-5px 0 0 -5px;padding:0;border:1.5px solid var(--dsw-alias-brand-primary,#4d6bfe);border-radius:2px;background:var(--dsw-alias-bg-base,#fff);z-index:5;pointer-events:auto;box-sizing:border-box}',
      '.wb-handle[data-dir="nw"]{cursor:nwse-resize}',
      '.wb-handle[data-dir="se"]{cursor:nwse-resize}',
      '.wb-handle[data-dir="ne"]{cursor:nesw-resize}',
      '.wb-handle[data-dir="sw"]{cursor:nesw-resize}',
      '.wb-handle[data-dir="n"]{cursor:ns-resize}',
      '.wb-handle[data-dir="s"]{cursor:ns-resize}',
      '.wb-handle[data-dir="e"]{cursor:ew-resize}',
      '.wb-handle[data-dir="w"]{cursor:ew-resize}',
      '.wb-shapeSizeBadge{position:absolute;right:0;top:-18px;font-size:10px;line-height:16px;padding:0 5px;border-radius:3px;background:var(--dsw-alias-brand-primary,#4d6bfe);color:#fff;white-space:nowrap}',
      '.wb-saveStatus{font-size:10.5px;color:var(--dsw-alias-label-tertiary,#888);white-space:nowrap}',
      '.wb-inspectorAutoHint{font-size:10.5px;color:var(--dsw-alias-label-tertiary,#888);line-height:1.4}',
      '.wb-drawioView{display:flex;flex-direction:column;width:100%;height:100%;min-height:0;background:var(--dsw-alias-bg-base,#fff)}',
      '.wb-htmlView{display:flex;flex-direction:column;width:100%;height:100%;min-height:0;background:var(--dsw-alias-bg-base,#fff)}',
      '.wb-htmlBar{flex:none;display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0;min-height:34px;padding:4px 10px;border-bottom:.5px solid var(--dsw-alias-border-l3,rgba(128,128,128,.3));font-size:11.5px;color:var(--dsw-alias-label-secondary,#555)}',
      '.wb-htmlName{font-family:var(--dsw-alias-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:46%;color:var(--dsw-alias-label-tertiary,#888)}',
      '.wb-htmlContent{position:relative;flex:1 1 auto;min-height:0;display:flex;background:#fff}',
      '.wb-htmlFrame{flex:1 1 auto;display:block;width:100%;height:100%;min-height:0;border:0;background:#fff}',
      '.wb-htmlLoading{position:absolute;inset:0;z-index:6;display:flex;align-items:center;justify-content:center;gap:8px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-secondary,#666);font-size:12px}',
      '.wb-htmlPins{position:absolute;inset:0;z-index:8;overflow:hidden;pointer-events:none}',
      '.wb-htmlPin{position:absolute;transform:translate(-50%,-50%);pointer-events:auto;display:flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border-radius:999px;border:1px solid var(--dsw-alias-state-info-primary,#2f5bea);background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-state-info-primary,#2f5bea);font-size:11px;line-height:1;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.22)}',
      '.wb-htmlPin[data-selected="true"]{background:var(--dsw-alias-state-info-primary,#2f5bea);color:#fff}',
      '.wb-htmlPanel{position:absolute;top:8px;right:10px;bottom:10px;z-index:20;width:min(320px,78%);display:flex;flex-direction:column;min-height:0;overflow:hidden;border-radius:var(--dsw-radius-lg,10px);border:.5px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));background:var(--dsw-alias-bg-layer-2,#fff);box-shadow:var(--dsw-elevation-prominent,0 10px 28px rgba(0,0,0,.22));color:var(--dsw-alias-label-primary,#1a1a1a);font-size:12px}',
      '.wb-htmlPanelHead{flex:none;display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:.5px solid var(--dsw-alias-border-l2,rgba(128,128,128,.25))}',
      '.wb-htmlPanelBody{flex:1 1 auto;min-height:0;overflow-y:auto;padding:8px 10px;display:flex;flex-direction:column;gap:8px;scrollbar-width:thin}',
      '.wb-htmlSelection{padding:6px 8px;border-radius:var(--dsw-radius-sm,6px);border:.5px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));background:var(--dsw-alias-bg-layer-1,#f7f7f8);color:var(--dsw-alias-label-secondary,#555);font-size:11.5px;line-height:1.5;word-break:break-word}',
      '.wb-htmlFooter{flex:none;display:flex;align-items:center;gap:8px;padding:8px 10px;border-top:.5px solid var(--dsw-alias-border-l2,rgba(128,128,128,.25))}',
      '.wb-drawioView{position:relative}',
      '.wb-drawioPanel{position:absolute;top:44px;right:10px;bottom:12px;z-index:20;width:min(320px,78%);display:flex;flex-direction:column;min-height:0;overflow:hidden;border-radius:var(--dsw-radius-lg,10px);border:.5px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));background:var(--dsw-alias-bg-layer-2,#fff);box-shadow:var(--dsw-elevation-prominent,0 10px 28px rgba(0,0,0,.22));color:var(--dsw-alias-label-primary,#1a1a1a);font-size:12px}',
      '.wb-drawioPanelHead{flex:none;display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:.5px solid var(--dsw-alias-border-l2,rgba(128,128,128,.25))}',
      '.wb-drawioPanelBody{flex:1 1 auto;min-height:0;overflow-y:auto;padding:8px 10px;display:flex;flex-direction:column;gap:8px;scrollbar-width:thin}',
      '.wb-drawioSelection{padding:6px 8px;border-radius:var(--dsw-radius-sm,6px);border:.5px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));background:var(--dsw-alias-bg-layer-1,#f7f7f8);color:var(--dsw-alias-label-secondary,#555);font-size:11.5px;line-height:1.5;word-break:break-word}',
      '.wb-drawioFooter{flex:none;display:flex;align-items:center;gap:8px;padding:8px 10px;border-top:.5px solid var(--dsw-alias-border-l2,rgba(128,128,128,.25))}',
      '.wb-drawioBar{flex:none;display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0;min-height:34px;padding:4px 10px;border-bottom:.5px solid var(--dsw-alias-border-l3,rgba(128,128,128,.3));font-size:11.5px;color:var(--dsw-alias-label-secondary,#555)}',
      '.wb-drawioName{font-family:var(--dsw-alias-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:46%;color:var(--dsw-alias-label-tertiary,#888)}',
      '.wb-drawioError{flex:none;display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 10px;border-bottom:.5px solid var(--dsw-alias-state-error-primary,rgba(217,45,32,.4));background:var(--dsw-alias-state-error-secondary,#fdecec);color:var(--dsw-alias-state-error-primary,#d92d20);font-size:11.5px;line-height:1.5}',
      '.wb-drawioFrame{flex:1 1 auto;display:block;width:100%;min-height:0;border:0;background:#fff}',
      '.wb-drawer[data-mode="source"]{max-height:62%}',
      '.wb-sourceText{min-height:200px;max-height:44vh;white-space:pre;font-family:var(--dsw-alias-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:12px;line-height:1.55;tab-size:2}',
      '.wb-sourceMeta{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:11px;color:var(--dsw-alias-label-tertiary,#888);min-width:0;line-height:1.5}',
      '.wb-sourcePath{font-family:var(--dsw-alias-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}',
      '.wb-sourceError{padding:6px 8px;border-radius:var(--dsw-radius-sm,6px);border:.5px solid var(--dsw-alias-state-error-primary,rgba(217,45,32,.5));background:var(--dsw-alias-state-error-secondary,#fdecec);color:var(--dsw-alias-state-error-primary,#d92d20);font-size:11.5px;line-height:1.5;display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.wb-sourceStale{padding:6px 8px;border-radius:var(--dsw-radius-sm,6px);border:.5px solid var(--dsw-alias-state-warn-secondary,rgba(217,119,6,.45));background:var(--dsw-alias-state-warn-tertiary,#fff7e6);color:var(--dsw-alias-label-primary,#1a1a1a);font-size:11.5px;line-height:1.5;display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.wb-pointSel{position:absolute;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:999px;border:2px solid var(--dsw-alias-brand-primary,#4d6bfe);background:rgba(77,107,254,.14);pointer-events:none;z-index:3}',
      '.wb-shapeSelReadonly{border-style:dashed;border-color:var(--dsw-alias-state-warn-primary,#d97706);background:rgba(217,119,6,.08)}',
      '.wb-shapeBadge{position:absolute;right:0;top:-18px;font-size:10px;line-height:16px;padding:0 5px;border-radius:3px;background:var(--dsw-alias-state-warn-primary,#d97706);color:#fff;white-space:nowrap}',
      '.wb-feishu{display:flex;flex-direction:column;width:100%;height:100%;min-height:0;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);font-size:12px}',
      '.wb-feishuSelect{max-width:100%;min-width:120px;height:26px;padding:0 6px;border-radius:var(--dsw-radius-sm,6px);border:.5px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);font-size:11.5px}',
      '.wb-feishuTarget{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:5px 8px;border-radius:var(--dsw-radius-sm,6px);border:.5px solid var(--dsw-alias-brand-primary,rgba(77,107,254,.45));background:var(--dsw-alias-bg-layer-1,#f4f7ff);font-size:11.5px;line-height:1.5;color:var(--dsw-alias-label-secondary,#444);word-break:break-word}',
      '.wb-feishuBlockRef{padding:5px 8px;border-left:3px solid var(--dsw-alias-state-info-primary,#2f5bea);border-radius:0 4px 4px 0;background:var(--dsw-alias-bg-layer-1,#f7f7f8);color:var(--dsw-alias-label-secondary,#555);font-size:11.5px;line-height:1.5;white-space:pre-wrap;word-break:break-word}',
      '.wb-feishuManual{display:flex;flex-direction:column;gap:6px;margin:8px 12px 0;padding:8px 10px;border-radius:var(--dsw-radius-sm,6px);border:.5px solid var(--dsw-alias-state-warn-secondary,rgba(217,119,6,.45));background:var(--dsw-alias-state-warn-tertiary,#fff7e6);font-size:11.5px;line-height:1.5}',
      '.wb-feishuBar{flex:none;display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:8px 10px;border-bottom:.5px solid var(--dsw-alias-border-l3,rgba(128,128,128,.3));background:var(--dsw-alias-bg-layer-2,#fff)}',
      '.wb-feishuChip{flex:none;display:inline-flex;align-items:center;justify-content:center;padding:2px 8px;border-radius:999px;border:.5px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));background:var(--dsw-alias-bg-layer-1,#f7f7f8);color:var(--dsw-alias-label-secondary,#555);font-size:11px;line-height:18px;white-space:nowrap}',
      '.wb-feishuInput{flex:1 1 220px;min-width:140px;height:28px;padding:0 8px;border-radius:var(--dsw-radius-sm,6px);border:.5px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);font-size:12px;outline:none}',
      '.wb-feishuInput:focus{border-color:var(--dsw-alias-brand-primary,#4d6bfe)}',
      '.wb-feishuBody{flex:1 1 auto;min-height:0;overflow-y:auto;padding:10px 12px 16px;display:flex;flex-direction:column;gap:10px;scrollbar-width:thin}',
      '.wb-feishuHead{display:flex;flex-direction:column;gap:4px;min-width:0}',
      '.wb-feishuTitle{font-size:15px;font-weight:600;line-height:1.4;word-break:break-word}',
      '.wb-feishuMeta{display:flex;align-items:center;gap:6px;flex-wrap:wrap;color:var(--dsw-alias-label-tertiary,#888);font-size:11px;line-height:1.5;min-width:0}',
      '.wb-feishuMd{margin:0;padding:10px 12px;border-radius:var(--dsw-radius-sm,6px);border:.5px solid var(--dsw-alias-border-l2,rgba(128,128,128,.22));background:var(--dsw-alias-bg-layer-1,#f7f7f8);white-space:pre-wrap;word-break:break-word;font-family:var(--dsw-alias-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:12px;line-height:1.65;color:var(--dsw-alias-label-secondary,#444);max-height:46vh;overflow:auto}',
      '.wb-feishuSection{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary,#1a1a1a)}',
      '.wb-feishuComment{display:flex;flex-direction:column;gap:6px;padding:8px 10px;border-radius:var(--dsw-radius-sm,6px);border:.5px solid var(--dsw-alias-border-l2,rgba(128,128,128,.25));background:var(--dsw-alias-bg-layer-2,#fff)}',
      '.wb-feishuComment[data-solved="true"]{opacity:.78;background:var(--dsw-alias-bg-layer-1,#f7f7f8)}',
      '.wb-feishuQuote{padding:5px 8px;border-left:3px solid var(--dsw-alias-brand-primary,#4d6bfe);border-radius:0 4px 4px 0;background:var(--dsw-alias-bg-layer-1,#f7f7f8);color:var(--dsw-alias-label-secondary,#555);font-size:11.5px;line-height:1.5;white-space:pre-wrap;word-break:break-word}',
      '.wb-feishuReplies{display:flex;flex-direction:column;gap:4px;padding-left:8px;border-left:.5px solid var(--dsw-alias-border-l2,rgba(128,128,128,.25))}',
      '.wb-feishuReply{display:flex;flex-direction:column;gap:2px;font-size:11.5px;line-height:1.55;color:var(--dsw-alias-label-secondary,#444);word-break:break-word}',
      '.wb-feishuReplyMeta{font-size:10.5px;color:var(--dsw-alias-label-tertiary,#888)}',
      '.wb-feishuError{padding:6px 8px;border-radius:var(--dsw-radius-sm,6px);border:.5px solid var(--dsw-alias-state-error-primary,rgba(217,45,32,.5));background:var(--dsw-alias-state-error-secondary,#fdecec);color:var(--dsw-alias-state-error-primary,#d92d20);font-size:11.5px;line-height:1.5;display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.wb-feishuComposer{display:flex;flex-direction:column;gap:6px;padding:8px 10px;border-radius:var(--dsw-radius-sm,6px);border:.5px dashed var(--dsw-alias-border-l2,rgba(128,128,128,.35));background:var(--dsw-alias-bg-layer-2,#fff)}',
      '.wb-feishuLink{color:var(--dsw-alias-brand-primary,#4d6bfe);text-decoration:none;font-size:11.5px;white-space:nowrap}',
      '.wb-feishuLink:hover{text-decoration:underline}',
      '.wb-feishuCenter{flex:1 1 auto;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:24px;color:var(--dsw-alias-label-secondary,#666);font-size:12px;text-align:center}',
      '.wb-modalMask{position:absolute;inset:0;z-index:70;display:flex;align-items:center;justify-content:center;padding:16px;background:var(--dsw-alias-bg-mask-2,rgba(0,0,0,.36))}',
      '.wb-modal{width:min(420px,100%);display:flex;flex-direction:column;gap:10px;padding:16px;border-radius:var(--dsw-radius-lg,10px);border:.5px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));background:var(--dsw-alias-bg-layer-2,#fff);box-shadow:var(--dsw-elevation-prominent,0 12px 34px rgba(0,0,0,.28));color:var(--dsw-alias-label-primary,#1a1a1a)}',
      '.wb-modalTitle{font-size:14px;font-weight:600}',
      '.wb-modalText{font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary,#555)}',
      '.wb-modalActions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}',
      '.wb-inspectorHead{display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0}',
      '.wb-inspectorName{font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:42%}',
      '.wb-inspectorMeta{font-size:10.5px;color:var(--dsw-alias-label-tertiary,#888);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}',
      '@media (prefers-reduced-motion: reduce){.wb-progress::after,.wb-spinner,.wb-thumbLoading,.wb-skeleton,.wb-miniSpinner{animation:none}}',
    ].join('\n');

    function injectStyles() {
      var existing = document.querySelector('style[data-plugin-css="' + STYLE_TAG_ID + '"]');
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
      var tag = document.createElement('style');
      tag.dataset.plugin = NS;
      tag.dataset.pluginCss = STYLE_TAG_ID;
      tag.textContent = CSS;
      document.head.appendChild(tag);
      return function () {
        if (tag.parentNode) tag.parentNode.removeChild(tag);
      };
    }

    // ------------------------------------------------------------------
    // React hooks：元素宽度 / 可见性 / 页面图片
    // ------------------------------------------------------------------
    function useElementWidth(ref) {
      var state = React.useState(0);
      var width = state[0];
      var setWidth = state[1];
      React.useEffect(function () {
        var node = ref.current;
        if (!node) return undefined;
        function measure() {
          var next = Math.round(node.clientWidth || 0);
          setWidth(function (previous) {
            return Math.abs(previous - next) >= 2 ? next : previous;
          });
        }
        measure();
        if (typeof ResizeObserver === 'undefined') {
          window.addEventListener('resize', measure);
          return function () {
            window.removeEventListener('resize', measure);
          };
        }
        var observer = new ResizeObserver(measure);
        observer.observe(node);
        return function () {
          observer.disconnect();
        };
      }, [ref]);
      return width;
    }

    /** 与 useElementWidth 相同，但接收节点值：适合挂载晚于组件首个 effect 的元素（如画布）。 */
    function useNodeWidth(node) {
      var state = React.useState(0);
      var width = state[0];
      var setWidth = state[1];
      React.useEffect(function () {
        if (!node) return undefined;
        function measure() {
          var next = Math.round(node.clientWidth || 0);
          setWidth(function (previous) {
            return Math.abs(previous - next) >= 2 ? next : previous;
          });
        }
        measure();
        if (typeof ResizeObserver === 'undefined') {
          window.addEventListener('resize', measure);
          return function () {
            window.removeEventListener('resize', measure);
          };
        }
        var observer = new ResizeObserver(measure);
        observer.observe(node);
        return function () {
          observer.disconnect();
        };
      }, [node]);
      return width;
    }

    function useInView(ref, eager, rootRef) {
      var state = React.useState(!!eager);
      var visible = state[0];
      var setVisible = state[1];
      React.useEffect(function () {
        if (visible) return undefined;
        var node = ref.current;
        if (!node) return undefined;
        if (typeof IntersectionObserver === 'undefined') {
          setVisible(true);
          return undefined;
        }
        var root = rootRef && rootRef.current ? rootRef.current : null;
        var observer = new IntersectionObserver(
          function (entries) {
            for (var index = 0; index < entries.length; index += 1) {
              if (entries[index].isIntersecting) {
                setVisible(true);
                observer.disconnect();
                break;
              }
            }
          },
          { root: root, rootMargin: '600px 0px', threshold: 0 },
        );
        observer.observe(node);
        return function () {
          observer.disconnect();
        };
      }, [ref, eager, rootRef, visible]);
      return visible;
    }

    /**
     * 逐页 PNG 的 Blob URL 缓存：按 deck sha 建缓存，deck 变化/卸载时 abort + revoke。
     * 返回 images(按页码索引) / ensurePage(幂等触发) / retryPage。
     */
    function useSlideImages(sha) {
      var cacheRef = React.useRef(null);
      if (sha && (!cacheRef.current || cacheRef.current.sha !== sha)) {
        cacheRef.current = { sha: sha, urls: new Map(), inflight: new Map(), controller: null, disposed: false };
      }
      var cache = cacheRef.current;
      var state = React.useState({ sha: null, map: EMPTY_MAP });
      var imageState = state[0];
      var setImageState = state[1];

      React.useEffect(function () {
        if (!cache) return undefined;
        return function () {
          cache.disposed = true;
          if (cache.controller) {
            try {
              cache.controller.abort();
            } catch (error) {
              /* ignore */
            }
            cache.controller = null;
          }
          cache.urls.forEach(function (url) {
            try {
              URL.revokeObjectURL(url);
            } catch (error) {
              /* ignore */
            }
          });
          cache.urls.clear();
          cache.inflight.clear();
        };
      }, [cache]);

      var writeImage = React.useCallback(function (num, value) {
        setImageState(function (previous) {
          var map = previous.sha === sha ? previous.map : EMPTY_MAP;
          var next = Object.assign({}, map);
          next[num] = value;
          return { sha: sha, map: next };
        });
      }, [sha]);

      var ensurePage = React.useCallback(function (num) {
        if (!cache || !sha || cache.disposed) return;
        var key = String(num);
        if (cache.urls.has(key) || cache.inflight.has(key)) return;
        if (!cache.controller) cache.controller = new AbortController();
        var signal = cache.controller.signal;
        cache.inflight.set(key, true);
        writeImage(num, { status: 'loading' });
        var url = apiUrl('slide?sha=' + encodeURIComponent(sha) + '&page=' + encodeURIComponent(num));
        fetch(url, { credentials: 'include', signal: signal })
          .then(function (response) {
            if (!response.ok) {
              var error = new Error('slide HTTP ' + response.status);
              error.status = response.status;
              throw error;
            }
            return response.blob();
          })
          .then(function (blob) {
            if (cache.disposed || signal.aborted) return;
            var objectUrl = URL.createObjectURL(blob);
            cache.urls.set(key, objectUrl);
            writeImage(num, { status: 'ready', url: objectUrl });
          })
          .catch(function (error) {
            if (cache.disposed || signal.aborted) return;
            writeImage(num, { status: 'error', status_code: error && error.status });
          })
          .then(function () {
            cache.inflight.delete(key);
          });
      }, [cache, sha, writeImage]);

      var retryPage = React.useCallback(function (num) {
        if (!cache) return;
        cache.inflight.delete(String(num));
        var existing = cache.urls.get(String(num));
        if (existing) {
          try {
            URL.revokeObjectURL(existing);
          } catch (error) {
            /* ignore */
          }
          cache.urls.delete(String(num));
        }
        ensurePage(num);
      }, [cache, ensurePage]);

      var images = imageState.sha === sha ? imageState.map : EMPTY_MAP;
      return { images: images, ensurePage: ensurePage, retryPage: retryPage };
    }

    // ------------------------------------------------------------------
    // 批注辅助
    // ------------------------------------------------------------------
    function isPdfAnnotation(annotation) {
      if (!annotation) return false;
      var anchor = annotation.anchor || {};
      return annotation.format === 'pdf' || anchor.kind === 'pdf-page';
    }

    function annotationPoint(annotation, slideWidthEmu, slideHeightEmu) {
      if (!annotation) return null;
      var anchor = annotation.anchor || {};
      if (anchor.pointNorm && Number.isFinite(anchor.pointNorm.x) && Number.isFinite(anchor.pointNorm.y)) {
        return { x: clamp01(anchor.pointNorm.x), y: clamp01(anchor.pointNorm.y) };
      }
      var rectNorm = anchor.rectNorm;
      if (rectNorm && Number.isFinite(rectNorm.x) && Number.isFinite(rectNorm.y) &&
          Number.isFinite(rectNorm.w) && Number.isFinite(rectNorm.h)) {
        return {
          x: clamp01(rectNorm.x + rectNorm.w / 2),
          y: clamp01(rectNorm.y + rectNorm.h / 2),
        };
      }
      var bbox = anchor.bboxEmu;
      if (
        bbox &&
        Number.isFinite(bbox.left) &&
        Number.isFinite(bbox.top) &&
        Number.isFinite(bbox.width) &&
        Number.isFinite(bbox.height) &&
        Number.isFinite(slideWidthEmu) &&
        Number.isFinite(slideHeightEmu) &&
        slideWidthEmu > 0 &&
        slideHeightEmu > 0
      ) {
        return {
          x: clamp01((bbox.left + bbox.width / 2) / slideWidthEmu),
          y: clamp01((bbox.top + bbox.height / 2) / slideHeightEmu),
        };
      }
      return null;
    }

    function hitShape(slide, pointXEmu, pointYEmu) {
      if (!slide || !Array.isArray(slide.shapes)) return null;
      for (var index = slide.shapes.length - 1; index >= 0; index -= 1) {
        var shape = slide.shapes[index];
        if (!shape) continue;
        var left = Number(shape.left);
        var top = Number(shape.top);
        var width = Number(shape.width);
        var height = Number(shape.height);
        if (![left, top, width, height].every(Number.isFinite)) continue;
        if (pointXEmu >= left && pointXEmu <= left + width && pointYEmu >= top && pointYEmu <= top + height) {
          return shape;
        }
      }
      return null;
    }

    function normRect(x0, y0, x1, y1) {
      var x = Math.min(x0, x1);
      var y = Math.min(y0, y1);
      var w = Math.abs(x1 - x0);
      var h = Math.abs(y1 - y0);
      return { x: clamp01(x), y: clamp01(y), w: Math.min(1 - clamp01(x), w), h: Math.min(1 - clamp01(y), h) };
    }

    function shapeBox(shape, slideWidthEmu, slideHeightEmu) {
      if (!shape || !slideWidthEmu || !slideHeightEmu) return null;
      return {
        left: (Number(shape.left) / slideWidthEmu) * 100 + '%',
        top: (Number(shape.top) / slideHeightEmu) * 100 + '%',
        width: (Number(shape.width) / slideWidthEmu) * 100 + '%',
        height: (Number(shape.height) / slideHeightEmu) * 100 + '%',
      };
    }

    function intersects(a, b) {
      return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
    }

    function shapesIntersecting(slide, rectNorm, slideWidthEmu, slideHeightEmu) {
      if (!slide || !Array.isArray(slide.shapes)) return [];
      if (!slideWidthEmu || !slideHeightEmu) return [];
      var rectEmu = {
        x: rectNorm.x * slideWidthEmu,
        y: rectNorm.y * slideHeightEmu,
        w: rectNorm.w * slideWidthEmu,
        h: rectNorm.h * slideHeightEmu,
      };
      var hits = [];
      for (var index = 0; index < slide.shapes.length; index += 1) {
        var shape = slide.shapes[index];
        if (!shape || !Number.isFinite(Number(shape.left))) continue;
        var box = { x: Number(shape.left), y: Number(shape.top), w: Number(shape.width), h: Number(shape.height) };
        if (intersects(rectEmu, box)) hits.push(shape);
      }
      return hits;
    }

    function draftShapesSummary(draft, t) {
      if (!draft) return '';
      if (draft.pdf) return draft.areaNorm ? t('compose.pdfArea') : t('compose.pdfPoint');
      var shapes = Array.isArray(draft.shapes) ? draft.shapes : [];
      if (shapes.length === 0) return draft.areaNorm ? t('compose.area') : t('compose.free');
      if (shapes.length === 1) return t('compose.shape', { name: shapes[0].name || '' });
      return t('compose.shapesMany', { count: shapes.length, names: shapes.slice(0, 3).map(function (shape) { return shape.name || ''; }).join('、') });
    }

    function annotationBoxes(annotation, slideWidthEmu, slideHeightEmu) {
      if (!annotation || !annotation.anchor) return [];
      var anchor = annotation.anchor;
      if (isPdfAnnotation(annotation)) {
        var pdfRect = anchor.rectNorm;
        if (pdfRect && Number.isFinite(pdfRect.x) && Number.isFinite(pdfRect.y) &&
            Number.isFinite(pdfRect.w) && Number.isFinite(pdfRect.h)) {
          return [{
            area: true,
            box: {
              left: clamp01(pdfRect.x) * 100 + '%',
              top: clamp01(pdfRect.y) * 100 + '%',
              width: clamp01(pdfRect.w) * 100 + '%',
              height: clamp01(pdfRect.h) * 100 + '%',
            },
          }];
        }
        var pdfPoint = anchor.pointNorm;
        if (pdfPoint && Number.isFinite(pdfPoint.x) && Number.isFinite(pdfPoint.y)) {
          return [{
            point: true,
            box: {
              left: clamp01(pdfPoint.x) * 100 + '%',
              top: clamp01(pdfPoint.y) * 100 + '%',
            },
          }];
        }
        return [];
      }
      var boxes = [];
      var related = Array.isArray(anchor.relatedShapes) ? anchor.relatedShapes : [];
      for (var index = 0; index < related.length; index += 1) {
        var shape = related[index];
        if (!shape || !shape.bboxEmu) continue;
        var box = shapeBox({
          left: shape.bboxEmu.left, top: shape.bboxEmu.top,
          width: shape.bboxEmu.width, height: shape.bboxEmu.height,
        }, slideWidthEmu, slideHeightEmu);
        if (box) boxes.push({ box: box, name: shape.name || '' });
      }
      if (boxes.length === 0 && anchor.bboxEmu) {
        var areaShape = {
          left: anchor.bboxEmu.left, top: anchor.bboxEmu.top,
          width: anchor.bboxEmu.width, height: anchor.bboxEmu.height,
        };
        var areaBox = shapeBox(areaShape, slideWidthEmu, slideHeightEmu);
        if (areaBox) boxes.push({ box: areaBox, name: '', area: true });
      }
      return boxes;
    }

    function annotationQuote(annotation, slides) {
      var result = { shapeName: '', preview: '' };
      if (!annotation) return result;
      if (isPdfAnnotation(annotation)) {
        var pdfAnchor = annotation.anchor || {};
        result.pdf = true;
        result.area = !!(pdfAnchor.rectNorm && Number.isFinite(pdfAnchor.rectNorm.w));
        result.preview = truncate(pdfAnchor.textQuote || '', 28);
        return result;
      }
      if (!Array.isArray(slides) || !Number.isInteger(annotation.slideIndex)) return result;
      var slide = slides[annotation.slideIndex];
      if (!slide || !Array.isArray(slide.shapes)) return result;
      var anchor = annotation.anchor || {};
      var related = Array.isArray(anchor.relatedShapes) ? anchor.relatedShapes : [];
      if (related.length > 1) {
        var names = related.map(function (shape) { return shape && shape.name ? shape.name : ''; }).filter(Boolean).join('、');
        result.shapeName = names;
        result.preview = truncate(names, 32);
        return result;
      }
      if (related.length === 0 && anchor.bboxEmu && !anchor.shapeId) {
        result.area = true;
        return result;
      }
      if (related.length === 1 && related[0]) {
        result.shapeName = related[0].name || '';
        var named = slide.shapes.filter(function (entry) { return entry && entry.name === related[0].name; });
        if (named.length === 1) result.preview = truncate(named[0].textPreview || '', 28);
        return result;
      }
      var shape = null;
      if (Number.isInteger(anchor.shapeId)) {
        for (var index = 0; index < slide.shapes.length; index += 1) {
          var candidate = slide.shapes[index];
          if (candidate && candidate.shapeId === anchor.shapeId) {
            shape = candidate;
            break;
          }
        }
      }
      if (!shape && anchor.shapeName) {
        for (var named = 0; named < slide.shapes.length; named += 1) {
          if (slide.shapes[named] && slide.shapes[named].name === anchor.shapeName) {
            shape = slide.shapes[named];
            break;
          }
        }
      }
      if (shape) {
        result.shapeName = shape.name || '';
        result.preview = truncate(shape.textPreview || '', 28);
      }
      return result;
    }

    function buildSendText(openAnnotations, slides, deckName, sha, t) {
      var lines = [];
      lines.push(t('send.header', { name: deckName || 'deck.pptx', count: openAnnotations.length, sha: shaShort(sha) }));
      openAnnotations.forEach(function (annotation, index) {
        var page = Number.isInteger(annotation.slideIndex) ? annotation.slideIndex + 1 : '?';
        var body = String(annotation.body || '').replace(/\s*\n\s*/g, ' ').trim();
        if (isPdfAnnotation(annotation)) {
          var anchor = annotation.anchor || {};
          var quoteText = truncate(anchor.textQuote || '', 40);
          var pdfBody = quoteText ? t('send.pdfQuote', { quote: quoteText }) + '；' + body : body;
          var rect = anchor.rectNorm;
          if (rect && Number.isFinite(rect.x) && Number.isFinite(rect.y) &&
              Number.isFinite(rect.w) && Number.isFinite(rect.h)) {
            lines.push(t('send.linePdfArea', {
              index: index + 1,
              page: page,
              x1: Math.round(clamp01(rect.x) * 100),
              x2: Math.round(clamp01(rect.x + rect.w) * 100),
              y1: Math.round(clamp01(rect.y) * 100),
              y2: Math.round(clamp01(rect.y + rect.h) * 100),
              body: pdfBody,
            }));
          } else {
            var point = anchor.pointNorm || {};
            lines.push(t('send.linePdfPoint', {
              index: index + 1,
              page: page,
              x: Math.round(clamp01(point.x) * 100),
              y: Math.round(clamp01(point.y) * 100),
              body: pdfBody,
            }));
          }
          return;
        }
        var quote = annotationQuote(annotation, slides);
        var quoteText = quote.preview || quote.shapeName;
        if (quoteText) {
          lines.push(t('send.lineShape', { index: index + 1, page: page, quote: quoteText, body: body }));
        } else {
          lines.push(t('send.lineFree', { index: index + 1, page: page, body: body }));
        }
      });
      lines.push('');
      lines.push(t('send.footer'));
      return lines.join('\n');
    }

    // ------------------------------------------------------------------
    // 通用小组件
    // ------------------------------------------------------------------
    function NoticeBanner(props) {
      var t = translator(props.lang);
      return h('div', { className: 'wb-banner', 'data-kind': props.kind || 'info', role: 'status' },
        h('span', { className: 'wb-bannerIcon', 'aria-hidden': true }, props.kind === 'error' ? '⚠' : 'ⓘ'),
        h('span', { className: 'wb-bannerText' }, props.text),
        props.actions && props.actions.length
          ? h('span', { className: 'wb-bannerActions' },
            props.actions.map(function (action, index) {
              return h('button', {
                key: index,
                type: 'button',
                className: 'wb-linkBtn',
                onClick: action.onClick,
              }, action.label);
            }),
          )
          : props.onAction
            ? h('button', {
              type: 'button',
              className: 'wb-linkBtn',
              onClick: props.onAction,
            }, props.actionLabel || t('error.retry'))
            : null,
        props.onDismiss
          ? h('button', {
            type: 'button',
            className: 'wb-linkBtn',
            'aria-label': t('banner.dismiss'),
            title: t('banner.dismiss'),
            onClick: props.onDismiss,
          }, '×')
          : null,
      );
    }

    function ToastView(props) {
      var t = translator(props.lang);
      var toast = props.toast;
      var manual = toast.kind === 'manual';
      return h('div', {
        className: 'wb-toast' + (manual ? ' wb-toastManual' : ''),
        'data-kind': toast.kind,
        role: 'status',
        'aria-live': 'polite',
      },
        h('div', { className: 'wb-row', style: { alignItems: 'flex-start', flexWrap: 'nowrap' } },
          h('div', { className: 'wb-toastText' }, toast.text),
          h('button', {
            type: 'button',
            className: 'wb-linkBtn',
            'aria-label': t('toast.close'),
            title: t('toast.close'),
            onClick: props.onClose,
          }, '×'),
        ),
        manual && toast.payload
          ? h('pre', { className: 'wb-toastPre', tabIndex: 0 }, toast.payload)
          : null,
      );
    }

    function FontsChip(props) {
      var t = translator(props.lang);
      var state = React.useState(false);
      var open = state[0];
      var setOpen = state[1];
      var wrapRef = React.useRef(null);
      React.useEffect(function () {
        if (!open) return undefined;
        function onPointerDown(event) {
          if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false);
        }
        document.addEventListener('pointerdown', onPointerDown, true);
        return function () {
          document.removeEventListener('pointerdown', onPointerDown, true);
        };
      }, [open]);
      var fonts = props.fonts || [];
      if (fonts.length === 0) return null;
      var label = t('toolbar.missingFonts', { count: fonts.length });
      var hover = label + '：' + fonts.join('、');
      return h('span', { className: 'wb-chipWrap', ref: wrapRef },
        h('button', {
          type: 'button',
          className: 'wb-chip wb-chipWarn',
          'aria-expanded': open ? 'true' : 'false',
          'aria-label': label,
          title: hover,
          onClick: function () {
            setOpen(function (value) {
              return !value;
            });
          },
        }, h('span', { 'aria-hidden': true }, '⚠'), h('span', null, label)),
        open
          ? h('div', { className: 'wb-popover', role: 'dialog', 'aria-label': t('fonts.title') },
            h('div', { className: 'wb-popoverHead' },
              h('strong', null, t('fonts.title')),
              h('button', {
                type: 'button',
                className: 'wb-linkBtn',
                'aria-label': t('fonts.close'),
                title: t('fonts.close'),
                onClick: function () {
                  setOpen(false);
                },
              }, '×'),
            ),
            h('p', { className: 'wb-popoverHint' }, t('fonts.hint')),
            h('ul', { className: 'wb-fontList' },
              fonts.map(function (font) {
                return h('li', { key: font, className: 'wb-fontItem' }, font);
              }),
            ),
          )
          : null,
      );
    }

    function Toolbar(props) {
      var t = translator(props.lang);
      var page = props.currentPage;
      var total = props.total;
      var canBack = page > 1;
      var canForward = page < (props.pageCount || total);
      return h('div', { className: 'wb-toolbar', 'data-wb-toolbar': '' },
        h('div', { className: 'wb-group', role: 'group', 'aria-label': t('toolbar.nav') },
          h('button', {
            type: 'button',
            className: 'wb-btn wb-icon',
            'aria-label': t('toolbar.prev'),
            title: t('toolbar.prev'),
            disabled: !canBack,
            onClick: props.onPrev,
          }, h('span', { 'aria-hidden': true }, '◀')),
          h('span', { className: 'wb-count', 'aria-live': 'polite' }, t('toolbar.page', { page: page, total: total })),
          h('button', {
            type: 'button',
            className: 'wb-btn wb-icon',
            'aria-label': t('toolbar.next'),
            title: t('toolbar.next'),
            disabled: !canForward,
            onClick: props.onNext,
          }, h('span', { 'aria-hidden': true }, '▶')),
        ),
        h('div', { className: 'wb-group', role: 'group', 'aria-label': t('toolbar.zoom') },
          h('button', {
            type: 'button',
            className: 'wb-btn',
            'aria-pressed': props.zoom === 'fit' ? 'true' : 'false',
            'aria-label': t('toolbar.zoomFitTitle'),
            title: t('toolbar.zoomFitTitle'),
            onClick: props.onZoomFit,
          }, t('toolbar.zoomFit')),
          h('button', {
            type: 'button',
            className: 'wb-btn',
            'aria-pressed': props.zoom === 'actual' ? 'true' : 'false',
            'aria-label': t('toolbar.zoomActualTitle'),
            title: t('toolbar.zoomActualTitle'),
            onClick: props.onZoomActual,
          }, t('toolbar.zoomActual')),
        ),
        props.refreshing
          ? h('span', { className: 'wb-chip', 'data-info': 'true', title: t('status.refreshing') },
            h('span', { className: 'wb-miniSpinner', 'aria-hidden': true }),
            h('span', null, t('status.refreshing')))
          : null,
        props.format === 'pdf'
          ? h('span', {
            className: 'wb-chip',
            'data-info': 'true',
            title: t(props.sourceFormat === 'html'
              ? 'toolbar.htmlBadge'
              : props.sourceFormat === 'drawio'
                ? 'toolbar.drawioBadge'
                : props.sourceFormat === 'mermaid'
                  ? 'toolbar.mermaidBadge'
                  : 'toolbar.pdfBadge'),
            'data-pdf-badge': '',
            'data-source-format': props.sourceFormat || 'pdf',
          }, t(props.sourceFormat === 'html'
            ? 'toolbar.htmlBadge'
            : props.sourceFormat === 'drawio'
              ? 'toolbar.drawioBadge'
              : props.sourceFormat === 'mermaid'
                ? 'toolbar.mermaidBadge'
                : 'toolbar.pdfBadge'))
          : null,
        h('span', { className: 'wb-spacer' }),
        props.missingFonts && props.missingFonts.length
          ? h(FontsChip, { fonts: props.missingFonts, lang: props.lang })
          : null,
        props.truncated
          ? h('span', {
            className: 'wb-chip',
            'data-info': 'true',
            title: t('toolbar.truncated', { rendered: props.renderedPages, total: total }),
          }, t('toolbar.truncatedChip', { rendered: props.renderedPages }))
          : null,
        h('button', {
          type: 'button',
          className: 'wb-btn wb-icon',
          'aria-pressed': props.railOpen ? 'true' : 'false',
          'aria-label': props.railOpen ? t('toolbar.railHide') : t('toolbar.railShow'),
          title: props.railOpen ? t('toolbar.railHide') : t('toolbar.railShow'),
          onClick: props.onToggleRail,
        }, h('span', { 'aria-hidden': true }, '▤')),
        h('button', {
          type: 'button',
          className: 'wb-btn',
          'aria-pressed': props.annotate ? 'true' : 'false',
          'aria-label': props.annotate ? t('toolbar.annotateOnTitle') : t('toolbar.annotateTitle'),
          title: props.annotate ? t('toolbar.annotateOnTitle') : t('toolbar.annotateTitle'),
          disabled: !props.canAnnotate,
          onClick: props.onToggleAnnotate,
        }, h('span', { 'aria-hidden': true }, '✎'), h('span', null, t('toolbar.annotate'))),
        props.showEdit
          ? h('button', {
            type: 'button',
            className: 'wb-btn',
            'aria-pressed': props.edit ? 'true' : 'false',
            'aria-label': props.edit ? t('toolbar.editOnTitle') : t('toolbar.editTitle'),
            title: props.edit ? t('toolbar.editOnTitle') : t('toolbar.editTitle'),
            disabled: !props.canEdit,
            onClick: props.onToggleEdit,
          }, h('span', { 'aria-hidden': true }, '✏'), h('span', null, t('toolbar.edit')))
          : null,
        props.sourceFormat === 'mermaid' && props.onOpenSource
          ? h('button', {
            type: 'button',
            className: 'wb-btn',
            'aria-pressed': props.sourceOpen ? 'true' : 'false',
            'aria-label': t('toolbar.editSource'),
            title: t('toolbar.editSourceTitle'),
            onClick: props.onOpenSource,
          }, h('span', { 'aria-hidden': true }, '</>'), h('span', null, t('toolbar.editSource')))
          : null,
        props.sourceFormat === 'drawio' && props.onOpenNative
          ? h('button', {
            type: 'button',
            className: 'wb-btn',
            'aria-label': t('toolbar.openDrawio'),
            title: t('toolbar.openDrawioTitle'),
            disabled: !!props.nativeBusy,
            onClick: props.onOpenNative,
          }, h('span', { 'aria-hidden': true }, '↗'), h('span', null, t('toolbar.openDrawio')))
          : null,
        h('button', {
          type: 'button',
          className: 'wb-btn wb-primary',
          disabled: !props.canSend,
          'aria-label': t('toolbar.send'),
          title: props.canSend ? t('toolbar.sendTitle') : t('toolbar.sendDisabled'),
          onClick: props.onSend,
        }, t('toolbar.send')),
      );
    }

    function Thumbnail(props) {
      var t = translator(props.lang);
      var page = props.page;
      var image = props.image;
      var frameRef = React.useRef(null);
      var visible = useInView(frameRef, props.eager, props.railRootRef);
      React.useEffect(function () {
        if (!visible) return;
        if (image) return;
        props.onNeedPage(page.page);
      }, [visible, image, page.page, props.onNeedPage]);
      var rect = page.rectangle || {};
      var aspect = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 16 / 9;
      var ready = image && image.status === 'ready';
      return h('button', {
        type: 'button',
        className: 'wb-thumb' + (props.current ? ' isCurrent' : ''),
        style: { aspectRatio: String(aspect) },
        ref: frameRef,
        'aria-label': t('rail.pageAria', { page: page.page }),
        'aria-current': props.current ? 'page' : undefined,
        title: props.openCount
          ? t('rail.pageAria', { page: page.page }) + ' · ' + t('rail.openTitle', { count: props.openCount })
          : t('rail.pageAria', { page: page.page }),
        onClick: function () {
          props.onSelectPage(page.page);
        },
      },
        ready
          ? h('img', { src: image.url, alt: '', draggable: false })
          : h('span', { className: 'wb-thumbLoading', 'aria-hidden': true }),
        h('span', { className: 'wb-thumbNum', 'aria-hidden': true }, page.page),
        props.openCount ? h('span', { className: 'wb-thumbDot', 'aria-hidden': true }) : null,
      );
    }

    function ThumbRail(props) {
      var t = translator(props.lang);
      return h('div', { className: 'wb-rail', 'data-wb-rail': '', role: 'list', 'aria-label': t('rail.aria'), ref: props.railRef },
        props.pages.map(function (page) {
          return h(Thumbnail, {
            key: page.page,
            page: page,
            image: props.images[page.page],
            eager: page.page <= EAGER_PAGES,
            current: page.page === props.currentPage,
            openCount: props.openCounts[page.page - 1] || 0,
            lang: props.lang,
            railRootRef: props.railRef,
            onNeedPage: props.onNeedPage,
            onSelectPage: props.onSelectPage,
          });
        }),
      );
    }

    // ------------------------------------------------------------------
    // 画布页（memo；批注 pin / 新建批注编辑器都挂在页容器上）
    // ------------------------------------------------------------------
    var PageView = React.memo(function PageView(props) {
      var t = translator(props.lang);
      var page = props.page;
      var image = props.image;
      var frameRef = React.useRef(null);
      var visible = useInView(frameRef, props.eager, props.scrollRootRef);
      var dragHook = React.useState(null);
      var drag = dragHook[0];
      var setDrag = dragHook[1];
      var hoverHook = React.useState(null);
      var hover = hoverHook[0];
      var setHover = hoverHook[1];
      var gestureHook = React.useState(null);
      var gesture = gestureHook[0];
      var setGesture = gestureHook[1];
      var gestureActiveRef = React.useRef(false);
      var suppressClickRef = React.useRef(false);
      var inlineSkipBlurRef = React.useRef(false);

      React.useEffect(function () {
        inlineSkipBlurRef.current = false;
      }, [props.inlineEdit]);

      React.useEffect(function () {
        if (!visible) return;
        if (image) return;
        props.onNeedPage(page.page);
      }, [visible, image, page.page, props.onNeedPage]);

      var setNode = React.useCallback(function (node) {
        frameRef.current = node;
        props.onPageNode(page.page, node);
      }, [props.onPageNode, page.page]);

      var pageWidth = props.zoom === 'actual' && page.width ? page.width : props.fitWidth;
      var rect = page.rectangle || {};
      var aspect = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : (page.width && page.height ? page.width / page.height : 16 / 9);
      var pageHeight = pageWidth ? pageWidth / aspect : null;
      var slideWidthEmu = props.slideWidthEmu;
      var slideHeightEmu = props.slideHeightEmu;

      function localPoint(event) {
        var node = frameRef.current;
        if (!node) return { x: 0.5, y: 0.5 };
        var box = node.getBoundingClientRect();
        if (!box.width || !box.height) return { x: 0.5, y: 0.5 };
        return {
          x: clamp01((event.clientX - box.left) / box.width),
          y: clamp01((event.clientY - box.top) / box.height),
        };
      }

      function hitAt(point) {
        if (!(props.annotate || props.editMode) || !props.slide) return null;
        var widthEmu = Number(slideWidthEmu);
        var heightEmu = Number(slideHeightEmu);
        if (!Number.isFinite(widthEmu) || !Number.isFinite(heightEmu)) return null;
        if (props.editMode) return hitEditableShape(props.slide, point.x * widthEmu, point.y * heightEmu);
        return hitShape(props.slide, point.x * widthEmu, point.y * heightEmu);
      }

      function pageDeltaPx(from, to) {
        if (!pageWidth || !pageHeight) return { x: 0, y: 0 };
        return { x: (to.x - from.x) * pageWidth, y: (to.y - from.y) * pageHeight };
      }

      function boxFromGesture(current, point) {
        var start = current.start;
        var widthEmu = Number(slideWidthEmu);
        var heightEmu = Number(slideHeightEmu);
        if (!Number.isFinite(widthEmu) || !Number.isFinite(heightEmu)) return start;
        var dxEmu = Math.round((point.x - current.x0) * widthEmu);
        var dyEmu = Math.round((point.y - current.y0) * heightEmu);
        if (current.mode === 'move') {
          return {
            left: clampNumber(start.left + dxEmu, 0, Math.max(0, widthEmu - start.width)),
            top: clampNumber(start.top + dyEmu, 0, Math.max(0, heightEmu - start.height)),
            width: start.width,
            height: start.height,
          };
        }
        var left = start.left;
        var top = start.top;
        var right = start.left + start.width;
        var bottom = start.top + start.height;
        var dir = current.handle || 'se';
        if (dir.indexOf('w') >= 0) left = clampNumber(start.left + dxEmu, 0, right - MIN_SHAPE_EMU);
        if (dir.indexOf('e') >= 0) right = clampNumber(start.left + start.width + dxEmu, left + MIN_SHAPE_EMU, widthEmu);
        if (dir.indexOf('n') >= 0) top = clampNumber(start.top + dyEmu, 0, bottom - MIN_SHAPE_EMU);
        if (dir.indexOf('s') >= 0) bottom = clampNumber(start.top + start.height + dyEmu, top + MIN_SHAPE_EMU, heightEmu);
        return { left: left, top: top, width: right - left, height: bottom - top };
      }

      function nearestHandle(point, norm) {
        if (!pageWidth || !pageHeight || !norm) return null;
        var cx = norm.x + norm.w / 2;
        var cy = norm.y + norm.h / 2;
        var edgePx = Math.min(pageWidth * norm.w, pageHeight * norm.h);
        var threshold = Math.min(9, Math.max(3, edgePx * 0.35));
        var positions = [
          ['nw', norm.x, norm.y], ['n', cx, norm.y], ['ne', norm.x + norm.w, norm.y],
          ['e', norm.x + norm.w, cy], ['se', norm.x + norm.w, norm.y + norm.h],
          ['s', cx, norm.y + norm.h], ['sw', norm.x, norm.y + norm.h], ['w', norm.x, cy],
        ];
        var best = null;
        var bestDistance = threshold;
        positions.forEach(function (entry) {
          var dx = (point.x - entry[1]) * pageWidth;
          var dy = (point.y - entry[2]) * pageHeight;
          var distance = Math.sqrt(dx * dx + dy * dy);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = entry[0];
          }
        });
        return best;
      }

      function startGesture(mode, handle, point, event) {
        var box = props.selectedShapeBox;
        if (!box || !box.norm) return;
        var widthEmu = Number(slideWidthEmu);
        var heightEmu = Number(slideHeightEmu);
        if (!Number.isFinite(widthEmu) || !Number.isFinite(heightEmu)) return;
        var start = {
          left: Math.round(box.norm.x * widthEmu),
          top: Math.round(box.norm.y * heightEmu),
          width: Math.round(box.norm.w * widthEmu),
          height: Math.round(box.norm.h * heightEmu),
        };
        setGesture({ mode: mode, handle: handle, x0: point.x, y0: point.y, start: start, box: start, moved: false });
        setHover(null);
        try {
          if (event.currentTarget && event.currentTarget.setPointerCapture) {
            event.currentTarget.setPointerCapture(event.pointerId);
          }
        } catch (error) {
          /* ignore */
        }
      }

      function finishGesture() {
        var current = gesture;
        if (!current) return;
        setGesture(null);
        gestureActiveRef.current = false;
        if (props.onGestureState) props.onGestureState(false);
        if (!current.moved) return;
        suppressClickRef.current = true;
        if (props.onShapeBoxCommit && props.selectedShapeBox) {
          props.onShapeBoxCommit(current.box, current.mode);
        }
      }

      function onPointerDown(event) {
        if (props.busy || props.editLocked) return;
        if (typeof event.button === 'number' && event.button !== 0) return;
        if (props.editMode) {
          if (props.inlineEdit) return;
          var editTarget = event.target;
          if (editTarget && editTarget.closest && editTarget.closest('.wb-editor')) return;
          if (!props.selectedShapeBox || !props.shapeEditable) return;
          var point = localPoint(event);
          var norm = props.selectedShapeBox.norm;
          if (!norm) return;
          var nearHandle = nearestHandle(point, norm);
          if (nearHandle) {
            startGesture('resize', nearHandle, point, event);
            return;
          }
          if (point.x >= norm.x && point.x <= norm.x + norm.w &&
              point.y >= norm.y && point.y <= norm.y + norm.h) {
            startGesture('move', 'move', point, event);
          }
          return;
        }
        if (!props.annotate) return;
        var target = event.target;
        if (target && target.closest && target.closest('.wb-pin, .wb-editor')) return;
        var tapPoint = localPoint(event);
        setDrag({ x0: tapPoint.x, y0: tapPoint.y, x1: tapPoint.x, y1: tapPoint.y, moved: false, pointerId: event.pointerId });
        try {
          if (event.currentTarget && event.currentTarget.setPointerCapture) {
            event.currentTarget.setPointerCapture(event.pointerId);
          }
        } catch (error) {
          /* ignore */
        }
      }

      function onPointerMove(event) {
        var point = localPoint(event);
        if (props.editMode && gesture) {
          var moved = gesture.moved;
          if (!moved) {
            var delta = pageDeltaPx({ x: gesture.x0, y: gesture.y0 }, point);
            if (Math.abs(delta.x) > 3 || Math.abs(delta.y) > 3) moved = true;
          }
          var next = Object.assign({}, gesture, { moved: moved });
          if (moved) next.box = boxFromGesture(gesture, point);
          if (moved && !gestureActiveRef.current) {
            gestureActiveRef.current = true;
            if (props.onGestureState) props.onGestureState(true);
          }
          setGesture(next);
          return;
        }
        if (!props.annotate && !props.editMode) return;
        if (drag) {
          var dragMoved = drag.moved || Math.abs(point.x - drag.x0) > 0.004 || Math.abs(point.y - drag.y0) > 0.004;
          setDrag({ x0: drag.x0, y0: drag.y0, x1: point.x, y1: point.y, moved: dragMoved, pointerId: drag.pointerId });
          return;
        }
        var shape = hitAt(point);
        setHover(function (previous) {
          var previousId = previous ? previous.shapeId : null;
          var nextId = shape ? shape.shapeId : null;
          if (previousId === nextId) return previous;
          return shape ? { shapeId: shape.shapeId, name: shape.name || '', box: shapeBox(shape, slideWidthEmu, slideHeightEmu) } : null;
        });
      }

      function finishPointer(event, canceled) {
        if (props.editMode && gesture) {
          finishGesture();
          return;
        }
        if (!drag) return;
        var currentDrag = drag;
        var point = localPoint(event);
        setDrag(null);
        if (canceled) return;
        var region = normRect(currentDrag.x0, currentDrag.y0, point.x, point.y);
        var moved = currentDrag.moved || region.w > 0.006 || region.h > 0.006;
        if (moved) props.onMarquee(page, region);
        else props.onPageTap(page, { x: clamp01(point.x), y: clamp01(point.y) });
      }

      function onPointerUp(event) { finishPointer(event, false); }
      function onPointerCancel(event) {
        if (props.editMode && gesture) {
          setGesture(null);
          gestureActiveRef.current = false;
          if (props.onGestureState) props.onGestureState(false);
          return;
        }
        finishPointer(event, true);
      }
      function onPointerLeave() {
        if (!drag && !gesture) setHover(null);
      }

      var draft = props.draft;
      var editorStyle = null;
      if (draft) {
        var anchor = draft.pointNorm || { x: 0.5, y: 0.5 };
        var editorWidth = 280;
        if (pageWidth && pageHeight) {
          var x = clamp01(anchor.x) * pageWidth;
          var y = clamp01(anchor.y) * pageHeight;
          var left = Math.min(Math.max(x - editorWidth / 2, 8), Math.max(8, pageWidth - editorWidth - 8));
          var top = y + 14;
          if (top + 214 > pageHeight) top = Math.max(8, y - 228);
          editorStyle = { left: left + 'px', top: top + 'px', width: editorWidth + 'px' };
        } else {
          editorStyle = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: editorWidth + 'px' };
        }
      }

      function stop(event) {
        event.stopPropagation();
      }

      function onEditorKeyDown(event) {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          if (!props.busy) props.onCancelDraft();
          return;
        }
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault();
          if (!props.busy) props.onSaveDraft(draft);
        }
      }

      var placeholder = null;
      if (!(image && image.status === 'ready')) {
        var failed = image && image.status === 'error';
        placeholder = h('div', {
          className: 'wb-pagePlaceholder',
          'data-error': failed ? 'true' : undefined,
          style: {
            aspectRatio: String(aspect),
            minHeight: pageHeight ? pageHeight + 'px' : undefined,
          },
        },
          failed
            ? h(React.Fragment, null,
              h('span', null, t('page.failed', { page: page.page })),
              h('button', {
                type: 'button',
                className: 'wb-linkBtn',
                onClick: function (event) {
                  event.stopPropagation();
                  props.onRetryPage(page.page);
                },
              }, t('page.retry')))
            : h(React.Fragment, null,
              h('span', { className: 'wb-miniSpinner', 'aria-hidden': true }),
              h('span', null, t('page.loading', { page: page.page }))),
        );
      }

      var draftBoxes = [];
      if (draft) {
        if (draft.areaNorm) {
          draftBoxes.push({
            key: 'area',
            area: true,
            box: {
              left: clamp01(draft.areaNorm.x) * 100 + '%',
              top: clamp01(draft.areaNorm.y) * 100 + '%',
              width: clamp01(draft.areaNorm.w) * 100 + '%',
              height: clamp01(draft.areaNorm.h) * 100 + '%',
            },
          });
        } else if (Array.isArray(draft.shapes)) {
          draft.shapes.forEach(function (shape, index) {
            var box = shapeBox(shape, slideWidthEmu, slideHeightEmu);
            if (box) draftBoxes.push({ key: 'sel-' + (shape.shapeId || index), area: false, box: box });
          });
        }
      }

      var savedBoxes = props.selectedAnnotation
        ? annotationBoxes(props.selectedAnnotation, slideWidthEmu, slideHeightEmu)
        : [];

      var marqueeStyle = null;
      if (drag && drag.moved) {
        marqueeStyle = {
          left: Math.min(drag.x0, drag.x1) * 100 + '%',
          top: Math.min(drag.y0, drag.y1) * 100 + '%',
          width: Math.abs(drag.x1 - drag.x0) * 100 + '%',
          height: Math.abs(drag.y1 - drag.y0) * 100 + '%',
        };
      }

      var inlineShape = null;
      if (props.inlineEdit && props.slide && Array.isArray(props.slide.shapes)) {
        for (var inlineIndex = 0; inlineIndex < props.slide.shapes.length; inlineIndex += 1) {
          var inlineCandidate = props.slide.shapes[inlineIndex];
          if (inlineCandidate && inlineCandidate.shapeId === props.inlineEdit.shapeId) {
            inlineShape = inlineCandidate;
            break;
          }
        }
      }
      var inlineStyle = null;
      if (inlineShape && pageWidth && pageHeight && Number(slideWidthEmu) > 0 && Number(slideHeightEmu) > 0) {
        var inlineFont = shapeFont(inlineShape);
        var inchPx = pageWidth / (Number(slideWidthEmu) / EMU_PER_INCH);
        var inlinePt = Number(inlineFont.sizePt);
        var inlineFontPx = Number.isFinite(inlinePt) && inlinePt > 0
          ? clampNumber((inlinePt / 72) * inchPx, 9, 48)
          : 14;
        inlineStyle = {
          left: (Number(inlineShape.left) / Number(slideWidthEmu)) * 100 + '%',
          top: (Number(inlineShape.top) / Number(slideHeightEmu)) * 100 + '%',
          width: (Number(inlineShape.width) / Number(slideWidthEmu)) * 100 + '%',
          height: (Number(inlineShape.height) / Number(slideHeightEmu)) * 100 + '%',
          fontSize: inlineFontPx + 'px',
        };
      }

      return h('div', {
        className: 'wb-page' + (props.annotate ? ' wb-annotate' : props.editMode ? ' wb-editing' : ''),
        'data-wb-page': page.page,
        ref: setNode,
        style: pageWidth ? { width: pageWidth + 'px' } : undefined,
        onPointerDown: onPointerDown,
        onPointerMove: onPointerMove,
        onPointerUp: onPointerUp,
        onPointerCancel: onPointerCancel,
        onPointerLeave: onPointerLeave,
        onClick: props.editMode
          ? function (event) {
            if (props.busy || props.editLocked || props.inlineEdit) return;
            if (suppressClickRef.current) {
              suppressClickRef.current = false;
              return;
            }
            var target = event.target;
            if (target && target.closest && target.closest('.wb-pin, .wb-editor, .wb-shapeHover, .wb-handle, .wb-inlineText')) return;
            var point = localPoint(event);
            var shape = hitAt(point);
            props.onSelectShape(page.page - 1, shape || null);
          }
          : undefined,
        onDoubleClick: props.editMode
          ? function (event) {
            if (props.busy || props.editLocked || props.inlineEdit) return;
            var target = event.target;
            if (target && target.closest && target.closest('.wb-editor, .wb-pin, .wb-inlineText')) return;
            var point = localPoint(event);
            var shape = hitAt(point);
            if (!shape || !shapeCanInlineEdit(shape)) return;
            event.preventDefault();
            if (props.onInlineStart) props.onInlineStart(page.page - 1, shape);
          }
          : undefined,
      },
        image && image.status === 'ready'
          ? h('img', {
            className: 'wb-slide',
            src: image.url,
            alt: '',
            draggable: false,
            style: { aspectRatio: String(aspect) },
          })
          : placeholder,
        props.editMode ? null : h('div', { className: 'wb-pins' },
          (props.annotations || EMPTY_LIST).map(function (annotation, index) {
            var point = annotationPoint(annotation, slideWidthEmu, slideHeightEmu);
            if (!point) return null;
            var orphaned = annotation.status === 'orphaned';
            var label = t(orphaned ? 'pin.orphanLabel' : 'pin.label', {
              page: page.page,
              index: index + 1,
              body: truncate(annotation.body, 60),
            });
            return h('button', {
              key: annotation.id,
              type: 'button',
              className: 'wb-pin',
              'data-wb-pin': annotation.id,
              'data-status': annotation.status || 'open',
              'data-selected': props.selectedId === annotation.id ? 'true' : undefined,
              style: { left: clamp01(point.x) * 100 + '%', top: clamp01(point.y) * 100 + '%' },
              'aria-label': label,
              title: label,
              onPointerDown: stop,
              onClick: function (event) {
                event.stopPropagation();
                props.onSelectAnnotation(annotation.id);
              },
            }, String(index + 1));
          }),
        ),
        hover && !drag && !draft
          ? h('div', { className: 'wb-shapeHover', style: hover.box },
            h('span', { className: 'wb-shapeName' }, hover.name || t('canvas.shape')))
          : null,
        savedBoxes.map(function (entry, index) {
          return h('div', {
            key: 'saved-' + index,
            className: entry.point ? 'wb-pointSel' : entry.area ? 'wb-areaSel' : 'wb-shapeSel',
            style: entry.box,
          }, entry.name ? h('span', { className: 'wb-shapeName' }, entry.name) : null);
        }),
        (function () {
          if (!props.selectedShapeBox) return null;
          var gestureBox = gesture && gesture.moved ? boxPercentStyle(gesture.box, slideWidthEmu, slideHeightEmu) : null;
          var selectionStyle = gestureBox || props.selectedShapeBox.box;
          var readonly = !gestureBox && !!props.selectedShapeBox.readonly;
          var children = [
            h('span', { key: 'name', className: 'wb-shapeName' }, props.selectedShapeBox.name || t('canvas.shape')),
          ];
          if (readonly) children.push(h('span', { key: 'readonly', className: 'wb-shapeBadge' }, t('edit.readonly')));
          if (gestureBox && gesture) {
            children.push(h('span', { key: 'size', className: 'wb-shapeSizeBadge' },
              t('edit.sizeLive', { w: emuToInches(gesture.box.width), h: emuToInches(gesture.box.height) })));
          }
          return h('div', {
            className: 'wb-shapeSel' + (readonly ? ' wb-shapeSelReadonly' : ''),
            style: selectionStyle,
            'data-wb-shape-selected': '',
          }, children);
        })(),
        props.editMode && props.shapeEditable && props.selectedShapeBox && !props.inlineEdit
          ? ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map(function (dir) {
            var baseBox = gesture && gesture.moved
              ? boxPercentStyle(gesture.box, slideWidthEmu, slideHeightEmu)
              : props.selectedShapeBox.box;
            if (!baseBox) return null;
            var pos = handlePositionStyle(dir, baseBox);
            return h('button', {
              key: 'handle-' + dir,
              type: 'button',
              className: 'wb-handle',
              'data-wb-handle': dir,
              style: { left: pos.left, top: pos.top },
              'aria-label': t('edit.resizeHandle'),
              title: t('edit.resizeHandle'),
            });
          })
          : null,
        draftBoxes.map(function (entry) {
          return h('div', {
            key: entry.key,
            className: entry.area ? 'wb-areaSel' : 'wb-shapeSel',
            style: entry.box,
          });
        }),
        marqueeStyle ? h('div', { className: 'wb-marquee', style: marqueeStyle }) : null,
        draft
          ? h('div', {
            className: 'wb-editor',
            style: editorStyle,
            role: 'dialog',
            'aria-label': t('compose.title', { page: page.page }),
            onPointerDown: stop,
            onClick: stop,
            onMouseDown: stop,
          },
            h('div', { className: 'wb-editorHead' },
              h('strong', { className: 'wb-editorTitle' }, t('compose.title', { page: page.page })),
              h('span', { className: 'wb-editorAnchor' }, draftShapesSummary(draft, t)),
            ),
            h('textarea', {
              className: 'wb-textarea',
              value: draft.body || '',
              rows: 3,
              autoFocus: true,
              placeholder: t('compose.placeholder'),
              'aria-label': t('compose.placeholder'),
              onChange: function (event) {
                props.onDraftChange(event.target.value);
              },
              onKeyDown: onEditorKeyDown,
            }),
            h('div', { className: 'wb-editorFoot' },
              h('span', { className: 'wb-hint' }, t('compose.hint')),
              h('div', { className: 'wb-row' },
                h('button', {
                  type: 'button',
                  className: 'wb-btn',
                  onClick: function () {
                    props.onCancelDraft();
                  },
                }, t('compose.cancel')),
                h('button', {
                  type: 'button',
                  className: 'wb-btn wb-primary',
                  disabled: !!props.busy || !String(draft.body || '').trim(),
                  onClick: function () {
                    props.onSaveDraft(draft);
                  },
                }, props.busy ? t('compose.saving') : t('compose.save')),
              ),
            ),
          )
          : null,
        props.inlineEdit
          ? h('textarea', {
            className: 'wb-inlineText',
            style: inlineStyle || { left: '20%', top: '20%', width: '60%', height: '20%', fontSize: '16px' },
            value: props.inlineEdit.text,
            autoFocus: true,
            spellCheck: false,
            'aria-label': t('edit.inlineAria'),
            title: t('edit.inlineHint'),
            onFocus: function (event) {
              var node = event.currentTarget;
              try {
                var length = String(node.value || '').length;
                node.setSelectionRange(length, length);
              } catch (error) {
                /* ignore */
              }
            },
            onChange: function (event) {
              if (props.onInlineChange) props.onInlineChange(event.target.value);
            },
            onBlur: function () {
              if (inlineSkipBlurRef.current) {
                inlineSkipBlurRef.current = false;
                return;
              }
              if (props.onInlineCommit) props.onInlineCommit();
            },
            onKeyDown: function (event) {
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                inlineSkipBlurRef.current = true;
                if (props.onInlineCancel) props.onInlineCancel();
                return;
              }
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                event.stopPropagation();
                inlineSkipBlurRef.current = true;
                if (props.onInlineCommit) props.onInlineCommit();
              }
            },
            onPointerDown: stop,
            onClick: stop,
            onDoubleClick: stop,
          })
          : null,
      );
    });

    // ------------------------------------------------------------------
    // 批注卡片 / 抽屉
    // ------------------------------------------------------------------
    function AnnotationCard(props) {
      var t = translator(props.lang);
      var annotation = props.annotation;
      var state = React.useState(false);
      var confirm = state[0];
      var setConfirm = state[1];
      var replyState = React.useState(false);
      var replying = replyState[0];
      var setReplying = replyState[1];
      var textState = React.useState('');
      var replyText = textState[0];
      var setReplyText = textState[1];
      var status = annotation.status || 'open';

      function select() {
        props.onSelect(annotation.id);
      }

      function submitReply() {
        var body = String(replyText || '').trim();
        if (!body || props.busy) return;
        var result = props.onReply(annotation, body);
        if (result && typeof result.then === 'function') {
          result.then(function (data) {
            if (data) {
              setReplying(false);
              setReplyText('');
            }
          });
        }
      }

      function onReplyKeyDown(event) {
        if (event.key === 'Escape') {
          event.preventDefault();
          setReplying(false);
        } else if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault();
          submitReply();
        }
      }

      function actionButton(label, handler, options) {
        return h('button', {
          type: 'button',
          className: 'wb-linkBtn',
          'data-danger': options && options.danger ? 'true' : undefined,
          disabled: props.busy,
          onClick: function (event) {
            event.stopPropagation();
            handler();
          },
        }, label);
      }

      var quote = props.quote || { shapeName: '', preview: '' };
      var author = annotation.author && annotation.author.name ? annotation.author.name : '';
      var replies = Array.isArray(annotation.replies) ? annotation.replies : [];

      return h('div', {
        className: 'wb-card',
        'data-wb-card': annotation.id,
        'data-status': status,
        'data-selected': props.selected ? 'true' : undefined,
        role: 'listitem',
        tabIndex: 0,
        onClick: select,
        onKeyDown: function (event) {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            select();
          }
        },
      },
        h('div', { className: 'wb-cardHead' },
          h('span', { className: 'wb-badge' }, t('annotation.page', { page: Number.isInteger(annotation.slideIndex) ? annotation.slideIndex + 1 : '?' })),
          quote.preview
            ? h('span', { className: 'wb-quote', title: quote.preview }, '「' + quote.preview + '」')
            : quote.area
              ? h('span', { className: 'wb-quote wb-quoteMuted' }, quote.pdf ? t('annotation.pdfArea') : t('annotation.areaAnchor'))
              : quote.pdf
                ? h('span', { className: 'wb-quote wb-quoteMuted' }, t('annotation.pdfPoint'))
                : h('span', { className: 'wb-quote wb-quoteMuted' }, t('annotation.freeAnchor')),
          h('span', { className: 'wb-meta' }, (author ? author + ' · ' : '') + formatTime(annotation.createdAt)),
        ),
        h('div', { className: 'wb-bodyText' + (props.selected ? '' : ' wb-clamp') }, annotation.body),
        status === 'orphaned' ? h('div', { className: 'wb-orphanHint' }, t('annotation.orphanedHint')) : null,
        replies.length
          ? h('div', { className: 'wb-replies' },
            replies.map(function (reply) {
              var replyAuthor = reply.author && reply.author.name ? reply.author.name : '';
              return h('div', { key: reply.id, className: 'wb-reply' },
                h('div', { className: 'wb-replyMeta' }, (replyAuthor ? replyAuthor + ' · ' : '') + formatTime(reply.createdAt)),
                h('div', { className: 'wb-replyBody' }, reply.body),
              );
            }),
          )
          : null,
        replying
          ? h('div', { className: 'wb-replyBox', onClick: function (event) { event.stopPropagation(); } },
            h('textarea', {
              className: 'wb-textarea',
              rows: 2,
              autoFocus: true,
              value: replyText,
              placeholder: t('annotation.replyPlaceholder'),
              'aria-label': t('annotation.replyPlaceholder'),
              onChange: function (event) {
                setReplyText(event.target.value);
              },
              onKeyDown: onReplyKeyDown,
            }),
            h('div', { className: 'wb-actions' },
              h('button', {
                type: 'button',
                className: 'wb-btn',
                onClick: function (event) {
                  event.stopPropagation();
                  setReplying(false);
                  setReplyText('');
                },
              }, t('annotation.replyCancel')),
              h('button', {
                type: 'button',
                className: 'wb-btn wb-primary',
                disabled: props.busy || !String(replyText || '').trim(),
                onClick: function (event) {
                  event.stopPropagation();
                  submitReply();
                },
              }, t('annotation.replySubmit')),
            ),
          )
          : h('div', { className: 'wb-actions' },
            status === 'resolved'
              ? actionButton(t('annotation.reopen'), function () { props.onReopen(annotation); })
              : actionButton(t('annotation.resolve'), function () { props.onResolve(annotation); }),
            actionButton(t('annotation.reply'), function () {
              setReplying(true);
            }),
            confirm
              ? h(React.Fragment, null,
                actionButton(t('annotation.deleteConfirm'), function () {
                  var result = props.onDelete(annotation);
                  if (result && typeof result.then === 'function') {
                    result.then(function (data) {
                      if (data) setConfirm(false);
                    });
                  }
                }, { danger: true }),
                actionButton(t('annotation.cancel'), function () {
                  setConfirm(false);
                }))
              : actionButton(t('annotation.delete'), function () {
                setConfirm(true);
              }, { danger: true }),
          ),
      );
    }

    function AnnotationDrawer(props) {
      var t = translator(props.lang);
      var filter = props.filter;
      var items = props.annotations.filter(function (annotation) {
        return (annotation.status || 'open') === filter;
      });
      var filterButton = function (status, label, count) {
        return h('button', {
          key: status,
          type: 'button',
          className: 'wb-tab',
          role: 'tab',
          'aria-selected': filter === status ? 'true' : 'false',
          onClick: function () {
            props.onFilter(status);
          },
        },
          h('span', null, label),
          h('span', { className: 'wb-tabCount' }, String(count)),
        );
      };
      var emptyText = filter === 'resolved'
        ? t('drawer.emptyResolved')
        : filter === 'orphaned'
          ? t('drawer.emptyOrphaned')
          : t('drawer.empty');
      return h('div', { className: 'wb-drawer', 'data-wb-drawer': '', 'data-open': props.open ? 'true' : 'false' },
        h('div', { className: 'wb-drawerHead' },
          h('span', { className: 'wb-drawerTitle' }, t('drawer.title')),
          h('div', { className: 'wb-tabs', role: 'tablist', 'aria-label': t('drawer.title') },
            filterButton('open', t('drawer.filterOpen'), props.counts.open || 0),
            filterButton('resolved', t('drawer.filterResolved'), props.counts.resolved || 0),
            filterButton('orphaned', t('drawer.filterOrphaned'), props.counts.orphaned || 0),
          ),
          h('span', { className: 'wb-spacer' }),
          h('button', {
            type: 'button',
            className: 'wb-btn wb-icon',
            'aria-label': props.open ? t('drawer.collapse') : t('drawer.expand'),
            title: props.open ? t('drawer.collapse') : t('drawer.expand'),
            'aria-expanded': props.open ? 'true' : 'false',
            onClick: props.onToggleOpen,
          }, h('span', { 'aria-hidden': true }, props.open ? '▾' : '▴')),
        ),
        props.open
          ? h('div', { className: 'wb-drawerBody', role: 'tabpanel' },
            items.length === 0
              ? h('div', { className: 'wb-empty' }, emptyText)
              : items.map(function (annotation) {
                var quote = annotationQuote(annotation, props.slides);
                return h(AnnotationCard, {
                  key: annotation.id,
                  annotation: annotation,
                  quote: quote,
                  selected: props.selectedId === annotation.id,
                  busy: props.busy,
                  lang: props.lang,
                  onSelect: props.onSelect,
                  onResolve: props.onResolve,
                  onReopen: props.onReopen,
                  onDelete: props.onDelete,
                  onReply: props.onReply,
                });
              }),
          )
          : null,
      );
    }


    // ------------------------------------------------------------------
    // 编辑工具条（页面操作 / 撤销重做 / 保存）
    // ------------------------------------------------------------------
    function EditBar(props) {
      var t = translator(props.lang);
      var conflict = !!props.conflict;
      var menuHook = React.useState(false);
      var menuOpen = menuHook[0];
      var setMenuOpen = menuHook[1];
      var confirmHook = React.useState(false);
      var deleteConfirm = confirmHook[0];
      var setDeleteConfirm = confirmHook[1];
      var wrapRef = React.useRef(null);
      var pending = (props.pendingCount || 0) + (props.formDirty || 0);
      var page = props.currentPage;
      var pageCount = props.pageCount;
      var history = props.history || {};
      var busy = !!props.saving;
      var pageOpsLocked = pending > 0 || conflict;
      var pageOpsDisabled = busy || props.readonly || conflict;
      var canUndo = history.canUndo === true && pending === 0 && !busy && !conflict;
      var canRedo = history.canRedo === true && pending === 0 && !busy && !conflict;
      var canSave = pending > 0 && !busy && !props.readonly && !conflict;

      React.useEffect(function () {
        if (!menuOpen) return undefined;
        function onPointerDown(event) {
          if (wrapRef.current && !wrapRef.current.contains(event.target)) {
            setMenuOpen(false);
            setDeleteConfirm(false);
          }
        }
        document.addEventListener('pointerdown', onPointerDown, true);
        return function () {
          document.removeEventListener('pointerdown', onPointerDown, true);
        };
      }, [menuOpen]);
      React.useEffect(function () {
        if (!menuOpen) setDeleteConfirm(false);
      }, [menuOpen]);

      function runPageOp(op) {
        setMenuOpen(false);
        setDeleteConfirm(false);
        props.onPageAction(op);
      }

      function menuItem(key, label, handler, options) {
        var settings = options || {};
        return h('button', {
          key: key,
          type: 'button',
          role: 'menuitem',
          className: 'wb-menuItem',
          'data-danger': settings.danger ? 'true' : undefined,
          disabled: !!settings.disabled,
          onClick: handler,
        }, label);
      }

      var menu = menuOpen
        ? h('div', { className: 'wb-menu', role: 'menu', 'aria-label': t('edit.pageMenu') },
          pageOpsLocked
            ? h('div', { key: 'locked', className: 'wb-menuHint' }, t(conflict ? 'edit.conflictTitle' : 'edit.pageOpBlocked'))
            : null,
          menuItem('dup', t('edit.duplicateSlide'), function () { runPageOp({ op: 'duplicateSlide', slideIndex: page - 1 }); }, { disabled: pageOpsLocked }),
          menuItem('up', t('edit.moveUp'), function () { runPageOp({ op: 'moveSlide', slideIndex: page - 1, toIndex: page - 2 }); }, { disabled: pageOpsLocked || page <= 1 }),
          menuItem('down', t('edit.moveDown'), function () { runPageOp({ op: 'moveSlide', slideIndex: page - 1, toIndex: page }); }, { disabled: pageOpsLocked || page >= pageCount }),
          menuItem('insert', t('edit.insertSlide'), function () { runPageOp({ op: 'insertSlide', afterIndex: page - 1 }); }, { disabled: pageOpsLocked }),
          h('div', { key: 'sep', className: 'wb-menuSep' }),
          deleteConfirm
            ? menuItem('del-confirm', t('edit.deleteSlideConfirm', { page: page }), function () { runPageOp({ op: 'deleteSlide', slideIndex: page - 1 }); }, { danger: true, disabled: pageOpsLocked })
            : menuItem('del', t('edit.deleteSlide'), function () {
              setDeleteConfirm(true);
            }, { danger: true, disabled: pageOpsLocked || pageCount <= 1 }),
        )
        : null;

      var saveTitle = canSave
        ? t('edit.save') + ' · ' + t('edit.pendingOps', { count: pending })
        : t('edit.noChanges');

      return h('div', { className: 'wb-editBar', 'data-wb-editbar': '', role: 'toolbar', 'aria-label': t('edit.title') },
        h('span', { className: 'wb-editBarLabel' }, t('edit.hint')),
        h('button', {
          type: 'button',
          className: 'wb-btn',
          'aria-pressed': props.autosave ? 'true' : 'false',
          'aria-label': t('edit.autoSave'),
          title: props.autosave ? t('edit.autoSaveOnTitle') : t('edit.autoSaveOffTitle'),
          onClick: props.onToggleAutosave,
        }, h('span', { 'aria-hidden': true }, '⏱'), h('span', null, t('edit.autoSave'))),
        props.saveStatus
          ? h('span', { className: 'wb-saveStatus', 'aria-live': 'polite' }, props.saveStatus)
          : null,
        h('span', { className: 'wb-editBarSpacer' }),
        h('span', { className: 'wb-menuWrap', ref: wrapRef },
          h('button', {
            type: 'button',
            className: 'wb-btn',
            'aria-haspopup': 'menu',
            'aria-expanded': menuOpen ? 'true' : 'false',
            'aria-label': t('edit.pageMenu'),
            title: pageOpsDisabled && (pending > 0 || conflict) ? t('edit.pageOpBlocked') : t('edit.pageMenu'),
            disabled: pageOpsDisabled,
            onClick: function () {
              setMenuOpen(function (value) {
                return !value;
              });
            },
          }, t('edit.pageMenu'), ' ▾'),
          menu,
        ),
        h('button', {
          type: 'button',
          className: 'wb-btn wb-icon',
          'aria-label': t('edit.undo'),
          title: canUndo ? t('edit.undo') + (history.version ? ' · ' + t('edit.version', { version: history.cursor }) : '') : t('edit.undoBlocked'),
          disabled: !canUndo,
          onClick: props.onUndo,
        }, h('span', { 'aria-hidden': true }, '↶')),
        h('button', {
          type: 'button',
          className: 'wb-btn wb-icon',
          'aria-label': t('edit.redo'),
          title: canRedo ? t('edit.redo') : t('edit.noHistory'),
          disabled: !canRedo,
          onClick: props.onRedo,
        }, h('span', { 'aria-hidden': true }, '↷')),
        h('span', { className: 'wb-editBarSpacer' }),
        pending
          ? h('span', { className: 'wb-chip', 'data-info': 'true', title: t('edit.pendingOps', { count: pending }) },
            t('edit.pending', { count: pending }))
          : null,
        h('button', {
          type: 'button',
          className: 'wb-btn',
          'aria-label': t('edit.openNative'),
          title: t('edit.openNativeTitle'),
          disabled: busy || !!props.nativeBusy || props.readonly || conflict,
          onClick: props.onOpenNative,
        }, h('span', { 'aria-hidden': true }, '↗'), h('span', null, props.nativeBusy ? t('edit.openNativeOpening') : t('edit.openNative'))),
        h('button', {
          type: 'button',
          className: 'wb-btn',
          'aria-label': t('edit.exit'),
          title: t('edit.exit'),
          disabled: busy,
          onClick: props.onExit,
        }, t('edit.exit')),
        h('button', {
          type: 'button',
          className: 'wb-btn wb-primary',
          'aria-label': t('edit.save'),
          title: saveTitle,
          disabled: !canSave,
          onClick: props.onSave,
        }, props.saving ? t('edit.saving') : t('edit.save')),
      );
    }

    // ------------------------------------------------------------------
    // 属性面板（编辑模式底部抽屉）
    // ------------------------------------------------------------------
    function ShapeInspector(props) {
      var t = translator(props.lang);
      var formHook = React.useState(null);
      var form = formHook[0];
      var setForm = formHook[1];
      var notesHook = React.useState('');
      var notesDraft = notesHook[0];
      var setNotesDraft = notesHook[1];
      var shape = props.shape;

      React.useEffect(function () {
        setForm(shape ? shapeForm(shape) : null);
        setNotesDraft(props.notes === undefined || props.notes === null ? '' : String(props.notes));
      }, [props.resetKey]);

      var diffOps = React.useMemo(function () {
        if (props.readonly) return [];
        if (shape) return shapeFormOps(shape, form, props.slideIndex);
        return notesFormOp(props.slideIndex, notesDraft, props.notes);
      }, [shape, form, notesDraft, props.slideIndex, props.notes, props.readonly]);

      props.diffRef.current = function () {
        return diffOps;
      };

      React.useEffect(function () {
        props.onFormDirty(diffOps.length);
        return function () {
          props.onFormDirty(0);
        };
      }, [diffOps.length]);

      function updateField(field, value) {
        setForm(function (previous) {
          if (!previous) return previous;
          var next = Object.assign({}, previous);
          next[field] = value;
          return next;
        });
      }

      function updateCell(row, col, value) {
        setForm(function (previous) {
          if (!previous) return previous;
          var cells = (previous.cells || []).map(function (entry) {
            return Array.isArray(entry) ? entry.slice() : [];
          });
          while (cells.length <= row) cells.push([]);
          while (cells[row].length <= col) cells[row].push('');
          cells[row][col] = value;
          return Object.assign({}, previous, { cells: cells });
        });
      }

      function flushAutoDraft() {
        if (props.saving || props.readonly || diffOps.length === 0) return;
        props.onAutoDraft(diffOps);
      }

      React.useEffect(function () {
        if (props.saving || props.readonly || diffOps.length === 0) return undefined;
        var timer = setTimeout(function () {
          props.onAutoDraft(diffOps);
        }, 300);
        return function () {
          clearTimeout(timer);
        };
      }, [diffOps]);

      var head = h('div', { className: 'wb-drawerHead' },
        h('span', { className: 'wb-drawerTitle' }, t('edit.title')),
        props.pendingCount
          ? h('span', { className: 'wb-tabCount', title: t('edit.pendingOps', { count: props.pendingCount }) }, String(props.pendingCount))
          : null,
        h('span', { className: 'wb-spacer' }),
        h('button', {
          type: 'button',
          className: 'wb-btn wb-icon',
          'aria-label': props.open ? t('drawer.collapse') : t('drawer.expand'),
          title: props.open ? t('drawer.collapse') : t('drawer.expand'),
          'aria-expanded': props.open ? 'true' : 'false',
          onClick: props.onToggleOpen,
        }, h('span', { 'aria-hidden': true }, props.open ? '▾' : '▴')),
      );

      if (!props.open) {
        return h('div', { className: 'wb-drawer', 'data-mode': 'edit', 'data-open': 'false', 'data-wb-inspector': '' }, head);
      }

      var body = [];
      if (shape) {
        var editable = isShapeEditable(shape);
        var hasTable = !!(shape.hasTable && shape.table && Array.isArray(shape.table.cells));
        var hasChart = !!(shape.hasChart && shape.chart);
        body.push(h('div', { key: 'head', className: 'wb-inspectorHead' },
          h('span', { className: 'wb-inspectorName', title: shape.name || '' }, shape.name || t('canvas.shape')),
          shape.type ? h('span', { className: 'wb-chip', 'data-info': 'true', title: String(shape.type) }, String(shape.type)) : null,
          h('span', { className: 'wb-chip', 'data-info': 'true' }, editable || hasTable ? t('edit.editable') : t('edit.readonly')),
        ));
        if (hasChart) {
          var chart = shape.chart || {};
          var series = Array.isArray(chart.series) ? chart.series : [];
          body.push(h('div', { key: 'chart', className: 'wb-section' },
            h('span', { className: 'wb-sectionTitle' }, t('edit.chart')),
            h('div', { className: 'wb-readonlyBox' },
              h('div', null, (Array.isArray(chart.categories) ? chart.categories : []).join(' · ')),
              h('div', { className: 'wb-chartSeries' },
                series.map(function (entry, index) {
                  return h('div', { key: index },
                    (entry && entry.name ? entry.name + '：' : '') +
                    (entry && Array.isArray(entry.values) ? entry.values.join(', ') : ''));
                }),
              ),
            ),
          ));
        }
        if (hasTable) {
          var table = shape.table;
          var rows = Math.min(Math.max(Number(table.rows) || table.cells.length || 1, 1), 12);
          var cols = Math.min(Math.max(Number(table.cols) || (table.cells[0] ? table.cells[0].length : 1), 1), 8);
          var bodyRows = [];
          for (var rowIndex = 0; rowIndex < rows; rowIndex += 1) {
            var rowCells = [];
            for (var colIndex = 0; colIndex < cols; colIndex += 1) {
              rowCells.push(h('td', { key: colIndex },
                h('input', {
                  className: 'wb-input',
                  value: form && form.cells && form.cells[rowIndex] && form.cells[rowIndex][colIndex] !== undefined
                    ? form.cells[rowIndex][colIndex]
                    : '',
                  'aria-label': t('edit.tableSize', { rows: rows, cols: cols }) + ' ' + (rowIndex + 1) + '/' + (colIndex + 1),
                  onBlur: flushAutoDraft,
                  onChange: (function (r, c) {
                    return function (event) {
                      updateCell(r, c, event.target.value);
                    };
                  })(rowIndex, colIndex),
                }),
              ));
            }
            bodyRows.push(h('tr', { key: rowIndex }, rowCells));
          }
          body.push(h('div', { key: 'table', className: 'wb-section' },
            h('span', { className: 'wb-sectionTitle' }, t('edit.table'), h('span', { className: 'wb-hint' }, t('edit.tableSize', { rows: rows, cols: cols }))),
            h('div', { className: 'wb-tableWrap' },
              h('table', { className: 'wb-table' }, h('tbody', null, bodyRows)),
            ),
          ));
        }
        if (shape.hasPicture) {
          body.push(h('div', { key: 'picture', className: 'wb-section' },
            h('div', { className: 'wb-readonlyBox' }, t('edit.readonlyShape', { type: shape.type || 'picture' })),
          ));
        }
        if (editable && !hasChart && !shape.hasPicture) {
          body.push(h('div', { key: 'text', className: 'wb-section' },
            h('span', { className: 'wb-sectionTitle' }, t('edit.text'), h('span', { className: 'wb-hint' }, t('edit.textHint'))),
            h('textarea', {
              className: 'wb-textarea',
              rows: 4,
              value: form ? form.text : '',
              maxLength: 4000,
              onBlur: flushAutoDraft,
              'aria-label': t('edit.text'),
              onChange: function (event) {
                updateField('text', event.target.value);
              },
            }),
          ));
          body.push(h('div', { key: 'font', className: 'wb-section' },
            h('span', { className: 'wb-sectionTitle' }, t('edit.font')),
            h('div', { className: 'wb-fieldGrid' },
              h('label', { className: 'wb-field' },
                h('span', { className: 'wb-fieldLabel' }, t('edit.fontSize') + '（' + t('edit.pt') + '）'),
                h('input', {
                  className: 'wb-input',
                  type: 'number',
                  step: '0.5',
                  min: '1',
                  max: '400',
                  value: form ? form.sizePt : '',
                  onBlur: flushAutoDraft,
                  'aria-label': t('edit.fontSize'),
                  onChange: function (event) {
                    updateField('sizePt', event.target.value);
                  },
                }),
              ),
              h('div', { className: 'wb-field' },
                h('span', { className: 'wb-fieldLabel' }, t('edit.bold') + ' / ' + t('edit.italic')),
                h('div', { className: 'wb-row' },
                  h('button', {
                    type: 'button',
                    className: 'wb-btn',
                    'aria-pressed': form && form.bold ? 'true' : 'false',
                    'aria-label': t('edit.bold'),
                    title: t('edit.bold'),
                    onClick: function () {
                      updateField('bold', !(form && form.bold));
                    },
                  }, h('strong', null, 'B')),
                  h('button', {
                    type: 'button',
                    className: 'wb-btn',
                    'aria-pressed': form && form.italic ? 'true' : 'false',
                    'aria-label': t('edit.italic'),
                    title: t('edit.italic'),
                    onClick: function () {
                      updateField('italic', !(form && form.italic));
                    },
                  }, h('em', null, 'I')),
                ),
              ),
              h('label', { className: 'wb-field' },
                h('span', { className: 'wb-fieldLabel' }, t('edit.color')),
                h('div', { className: 'wb-colorRow' },
                  h('input', {
                    className: 'wb-colorInput',
                    type: 'color',
                    value: form && normalizeHexColor(form.color) ? '#' + normalizeHexColor(form.color) : '#000000',
                    'aria-label': t('edit.color'),
                    onChange: function (event) {
                      updateField('color', normalizeHexColor(event.target.value));
                    },
                  }),
                  h('input', {
                    className: 'wb-input',
                    value: form ? form.color : '',
                    maxLength: 7,
                    onBlur: flushAutoDraft,
                    placeholder: t('edit.colorInherited'),
                    title: t('edit.colorInherited'),
                    'aria-label': t('edit.color') + ' hex',
                    onChange: function (event) {
                      updateField('color', event.target.value);
                    },
                  }),
                ),
              ),
            ),
          ));
          body.push(h('div', { key: 'geometry', className: 'wb-section' },
            h('span', { className: 'wb-sectionTitle' }, t('edit.geometry')),
            h('div', { className: 'wb-fieldGrid' },
              h('label', { className: 'wb-field' },
                h('span', { className: 'wb-fieldLabel' }, t('edit.left') + '（in）'),
                h('input', { className: 'wb-input', type: 'number', step: '0.01', value: form ? form.left : '', 'aria-label': t('edit.left'), onBlur: flushAutoDraft, onChange: function (event) { updateField('left', event.target.value); } }),
              ),
              h('label', { className: 'wb-field' },
                h('span', { className: 'wb-fieldLabel' }, t('edit.top') + '（in）'),
                h('input', { className: 'wb-input', type: 'number', step: '0.01', value: form ? form.top : '', 'aria-label': t('edit.top'), onBlur: flushAutoDraft, onChange: function (event) { updateField('top', event.target.value); } }),
              ),
              h('label', { className: 'wb-field' },
                h('span', { className: 'wb-fieldLabel' }, t('edit.width') + '（in）'),
                h('input', { className: 'wb-input', type: 'number', step: '0.01', value: form ? form.width : '', 'aria-label': t('edit.width'), onBlur: flushAutoDraft, onChange: function (event) { updateField('width', event.target.value); } }),
              ),
              h('label', { className: 'wb-field' },
                h('span', { className: 'wb-fieldLabel' }, t('edit.height') + '（in）'),
                h('input', { className: 'wb-input', type: 'number', step: '0.01', value: form ? form.height : '', 'aria-label': t('edit.height'), onBlur: flushAutoDraft, onChange: function (event) { updateField('height', event.target.value); } }),
              ),
            ),
          ));
        }
        if (!editable && !hasTable && !hasChart && !shape.hasPicture) {
          body.push(h('div', { key: 'readonly', className: 'wb-section' },
            h('div', { className: 'wb-readonlyBox' }, t('edit.readonlyShape', { type: shape.type || t('canvas.shape') })),
          ));
        }
        if (hasTable) {
          // 表格形状没有可编辑文本，但允许改位置/大小
          body.push(h('div', { key: 'table-geometry', className: 'wb-section' },
            h('span', { className: 'wb-sectionTitle' }, t('edit.geometry')),
            h('div', { className: 'wb-fieldGrid' },
              h('label', { className: 'wb-field' },
                h('span', { className: 'wb-fieldLabel' }, t('edit.left') + '（in）'),
                h('input', { className: 'wb-input', type: 'number', step: '0.01', value: form ? form.left : '', 'aria-label': t('edit.left'), onBlur: flushAutoDraft, onChange: function (event) { updateField('left', event.target.value); } }),
              ),
              h('label', { className: 'wb-field' },
                h('span', { className: 'wb-fieldLabel' }, t('edit.top') + '（in）'),
                h('input', { className: 'wb-input', type: 'number', step: '0.01', value: form ? form.top : '', 'aria-label': t('edit.top'), onBlur: flushAutoDraft, onChange: function (event) { updateField('top', event.target.value); } }),
              ),
              h('label', { className: 'wb-field' },
                h('span', { className: 'wb-fieldLabel' }, t('edit.width') + '（in）'),
                h('input', { className: 'wb-input', type: 'number', step: '0.01', value: form ? form.width : '', 'aria-label': t('edit.width'), onBlur: flushAutoDraft, onChange: function (event) { updateField('width', event.target.value); } }),
              ),
              h('label', { className: 'wb-field' },
                h('span', { className: 'wb-fieldLabel' }, t('edit.height') + '（in）'),
                h('input', { className: 'wb-input', type: 'number', step: '0.01', value: form ? form.height : '', 'aria-label': t('edit.height'), onBlur: flushAutoDraft, onChange: function (event) { updateField('height', event.target.value); } }),
              ),
            ),
          ));
        }
      } else {
        body.push(h('div', { key: 'notes', className: 'wb-section' },
          h('span', { className: 'wb-sectionTitle' }, t('edit.notesFor', { page: (Number.isInteger(props.slideIndex) ? props.slideIndex : 0) + 1 })),
          h('textarea', {
            className: 'wb-textarea',
            rows: 4,
            value: notesDraft,
            maxLength: 10000,
            onBlur: flushAutoDraft,
            'aria-label': t('edit.notes'),
            onChange: function (event) {
              setNotesDraft(event.target.value);
            },
          }),
          h('span', { className: 'wb-hint' }, t('edit.notesHint') + ' · ' + t('edit.selectHint')),
        ));
      }

      body.push(h('div', { key: 'actions', className: 'wb-row', style: { justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' } },
        h('span', { className: 'wb-inspectorAutoHint' },
          t('edit.autoDraftHint'),
          diffOps.length ? ' · ' + t('edit.applyCount', { count: diffOps.length }) : ''),
        h('div', { className: 'wb-row' },
          props.pendingCount
            ? h('span', { className: 'wb-chip', 'data-info': 'true', title: t('edit.pendingOps', { count: props.pendingCount }) },
              t('edit.pending', { count: props.pendingCount }))
            : null,
          props.pendingCount
            ? h('button', {
              type: 'button',
              className: 'wb-linkBtn',
              disabled: !!props.saving,
              onClick: props.onClearDraft,
            }, t('edit.clearDraft'))
            : null,
        ),
      ));

      return h('div', { className: 'wb-drawer', 'data-mode': 'edit', 'data-open': 'true', 'data-wb-inspector': '' },
        head,
        h('div', { className: 'wb-drawerBody', role: 'group', 'aria-label': t('edit.title') }, body),
      );
    }

    // ------------------------------------------------------------------
    // 未保存修改确认框
    // ------------------------------------------------------------------
    function DirtyDialog(props) {
      var t = translator(props.lang);
      var dialogRef = React.useRef(null);
      React.useEffect(function () {
        var node = dialogRef.current;
        if (node) {
          var first = node.querySelector('button');
          if (first && typeof first.focus === 'function') {
            try {
              first.focus({ preventScroll: true });
            } catch (error) {
              try { first.focus(); } catch (error2) { /* ignore */ }
            }
          }
        }
        function onKeyDown(event) {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            props.onCancel();
          }
        }
        document.addEventListener('keydown', onKeyDown, true);
        return function () {
          document.removeEventListener('keydown', onKeyDown, true);
        };
      }, []);
      return h('div', { className: 'wb-modalMask' },
        h('div', { className: 'wb-modal', ref: dialogRef, role: 'dialog', 'aria-modal': 'true', 'aria-label': t('edit.dirtyTitle') },
          h('div', { className: 'wb-modalTitle' }, t('edit.dirtyTitle')),
          h('div', { className: 'wb-modalText' }, t('edit.dirtyBody', { count: props.count })),
          h('div', { className: 'wb-modalActions' },
            h('button', { type: 'button', className: 'wb-btn', disabled: !!props.saving, onClick: props.onCancel }, t('edit.dirtyCancel')),
            h('button', { type: 'button', className: 'wb-btn', disabled: !!props.saving, onClick: props.onDiscard }, t('edit.dirtyDiscard')),
            h('button', { type: 'button', className: 'wb-btn wb-primary', disabled: !!props.saving, onClick: props.onSave }, props.saving ? t('edit.saving') : t('edit.dirtySave')),
          ),
        ),
      );
    }


    // ------------------------------------------------------------------
    // Mermaid 源码编辑抽屉
    // ------------------------------------------------------------------
    function SourceDrawer(props) {
      var t = translator(props.lang);
      var editor = props.editor || {};
      var text = typeof editor.text === 'string' ? editor.text : '';
      var dirty = text !== (editor.original || '');
      var loading = !!editor.loading;
      var saving = !!editor.saving;
      var error = editor.error || null;
      var stale = !!(error && error.code === 'stale');
      var body = [];
      body.push(h('div', { key: 'meta', className: 'wb-sourceMeta' },
        h('span', { className: 'wb-sourcePath', title: props.path || '' }, props.path || ''),
        dirty ? h('span', { className: 'wb-chip', title: t('source.dirty') }, t('source.dirty')) : null,
      ));
      if (stale) {
        body.push(h('div', { key: 'stale', className: 'wb-sourceStale' },
          h('span', null, t('source.stale')),
          h('button', { type: 'button', className: 'wb-linkBtn', disabled: saving || loading, onClick: props.onReload }, t('source.reload')),
        ));
      } else if (error) {
        var errorText = error.code === 'source-not-editable' || error.code === 'not-source-editable' || error.code === 'http-404'
          ? t('source.notSupported')
          : (error.message || t('source.saveFailed', { message: t('edit.unknown') }));
        body.push(h('div', { key: 'error', className: 'wb-sourceError' },
          h('span', null, errorText),
          h('button', { type: 'button', className: 'wb-linkBtn', disabled: saving || loading, onClick: props.onReload }, t('source.reload')),
        ));
      }
      if (loading) {
        body.push(h('div', { key: 'loading', className: 'wb-empty' },
          h('span', { className: 'wb-miniSpinner', 'aria-hidden': true }),
          h('span', null, ' ' + t('source.loading')),
        ));
      } else {
        body.push(h('textarea', {
          key: 'editor',
          className: 'wb-textarea wb-sourceText',
          value: text,
          disabled: saving,
          spellCheck: false,
          rows: 12,
          placeholder: t('source.placeholder'),
          'aria-label': t('source.aria'),
          onChange: function (event) {
            props.onChange(event.target.value);
          },
        }));
      }
      body.push(h('div', { key: 'actions', className: 'wb-row', style: { justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' } },
        h('span', { className: 'wb-sourceMeta' }, t('source.hint')),
        h('div', { className: 'wb-row' },
          h('button', {
            type: 'button',
            className: 'wb-btn',
            'aria-label': t('source.cancel'),
            disabled: saving,
            onClick: props.onClose,
          }, t('source.cancel')),
          h('button', {
            type: 'button',
            className: 'wb-btn wb-primary',
            'aria-label': t('source.save'),
            disabled: saving || loading || !dirty,
            onClick: props.onSave,
          }, saving ? t('source.saving') : t('source.save')),
        ),
      ));
      return h('div', { className: 'wb-drawer', 'data-mode': 'source', 'data-open': 'true', 'data-wb-source': '' },
        h('div', { className: 'wb-drawerHead' },
          h('span', { className: 'wb-drawerTitle' }, t('source.title')),
          h('span', { className: 'wb-spacer' }),
          h('button', {
            type: 'button',
            className: 'wb-btn wb-icon',
            'aria-label': t('source.close'),
            title: t('source.close'),
            disabled: saving,
            onClick: props.onClose,
          }, h('span', { 'aria-hidden': true }, '▾')),
        ),
        h('div', { className: 'wb-drawerBody', role: 'group', 'aria-label': t('source.title') }, body),
      );
    }

    function SourceCloseDialog(props) {
      var t = translator(props.lang);
      var dialogRef = React.useRef(null);
      React.useEffect(function () {
        var node = dialogRef.current;
        if (node) {
          var first = node.querySelector('button');
          if (first && typeof first.focus === 'function') {
            try {
              first.focus({ preventScroll: true });
            } catch (error) {
              try { first.focus(); } catch (error2) { /* ignore */ }
            }
          }
        }
      }, []);
      return h('div', { className: 'wb-modalMask' },
        h('div', { className: 'wb-modal', ref: dialogRef, role: 'dialog', 'aria-modal': 'true', 'aria-label': t('source.discardTitle') },
          h('div', { className: 'wb-modalTitle' }, t('source.discardTitle')),
          h('div', { className: 'wb-modalText' }, t('source.discardBody')),
          h('div', { className: 'wb-modalActions' },
            h('button', { type: 'button', className: 'wb-btn', onClick: props.onCancel }, t('source.keepEditing')),
            h('button', { type: 'button', className: 'wb-btn wb-primary', onClick: props.onDiscard }, t('source.discard')),
          ),
        ),
      );
    }


    // ------------------------------------------------------------------
    // 飞书文档只读工作台（右侧栏页面 tab）
    // ------------------------------------------------------------------
    function sortFeishuComments(list) {
      return (Array.isArray(list) ? list.slice() : []).sort(function (a, b) {
        var aSolved = !!(a && a.solved);
        var bSolved = !!(b && b.solved);
        if (aSolved !== bSolved) return aSolved ? 1 : -1;
        var aTime = Number(a && a.createdAt) || 0;
        var bTime = Number(b && b.createdAt) || 0;
        return bTime - aTime;
      });
    }

    function FeishuCommentCard(props) {
      var t = translator(props.lang);
      var comment = props.comment || {};
      var replies = Array.isArray(comment.replies) ? comment.replies : [];
      var solved = comment.solved === true;
      var replying = props.replyTarget === comment.id;
      var block = props.block || null;
      var blockText = block && typeof block.text === 'string' ? block.text : '';
      var quoteText = comment.quote ? String(comment.quote) : '';
      var refText = quoteText || blockText;
      var blockRef = comment.anchorBlockId ? String(comment.anchorBlockId) : '';
      return h('div', {
        className: 'wb-feishuComment',
        'data-feishu-comment': comment.id || '',
        'data-solved': solved ? 'true' : 'false',
      },
        h('div', { className: 'wb-feishuSection' },
          h('span', { className: 'wb-feishuChip' }, solved ? t('feishu.solved') : t('feishu.openStatus')),
          comment.createdAt ? h('span', { className: 'wb-feishuMeta' }, formatTime(comment.createdAt)) : null,
          h('span', { className: 'wb-spacer' }),
          h('button', {
            type: 'button',
            className: 'wb-linkBtn',
            disabled: !!props.busy,
            onClick: function () {
              if (replying) props.onReplyCancel();
              else props.onReplyStart(comment.id);
            },
          }, t('feishu.reply')),
          h('button', {
            type: 'button',
            className: 'wb-linkBtn',
            disabled: !!props.busy,
            onClick: function () {
              if (solved) props.onReopen(comment.id);
              else props.onResolve(comment.id);
            },
          }, solved ? t('feishu.reopen') : t('feishu.resolve'))),
        refText
          ? h('div', {
            className: 'wb-feishuBlockRef',
            'data-feishu-block-ref': blockRef,
          }, (blockRef ? t('feishu.blockRef') + '：' : t('feishu.quote') + '：') + refText)
          : null,
        h('div', { className: 'wb-feishuReplies' },
          replies.length === 0
            ? h('div', { className: 'wb-feishuReply' }, t('feishu.noReplies'))
            : replies.map(function (reply) {
              return h('div', { key: reply.id || String(reply.createdAt) + '-' + String(reply.text), className: 'wb-feishuReply' },
                h('div', { className: 'wb-feishuReplyMeta' },
                  (reply.authorId ? String(reply.authorId) : t('feishu.anonymous')) +
                  (reply.createdAt ? ' · ' + formatTime(reply.createdAt) : '')),
                h('div', null, String(reply.text || '')));
            })),
        replying
          ? h('div', { className: 'wb-feishuComposer' },
            h('textarea', {
              className: 'wb-textarea',
              value: props.replyDraft || '',
              rows: 2,
              disabled: !!props.busy,
              placeholder: t('feishu.replyPlaceholder'),
              'aria-label': t('feishu.replyPlaceholder'),
              onChange: function (event) {
                props.onReplyChange(event.target.value);
              },
            }),
            h('div', { className: 'wb-row', style: { justifyContent: 'flex-end' } },
              h('button', {
                type: 'button',
                className: 'wb-btn',
                disabled: !!props.busy,
                onClick: props.onReplyCancel,
              }, t('feishu.replyCancel')),
              h('button', {
                type: 'button',
                className: 'wb-btn wb-primary',
                disabled: !!props.busy || !String(props.replyDraft || '').trim(),
                onClick: function () {
                  props.onReplySubmit(comment.id, String(props.replyDraft || '').trim());
                },
              }, props.busy ? t('feishu.opening') : t('feishu.replySubmit'))))
          : null,
      );
    }

    function FeishuDocBody(props) {
      useLocaleRevision();
      var t = translator(language());
      var tabInfo = null;
      try {
        tabInfo = typeof props.useTabInfo === 'function' ? props.useTabInfo() : null;
      } catch (error) {
        tabInfo = null;
      }
      var tabRecord = tabInfo && tabInfo.tab ? tabInfo.tab : null;
      var navigation = tabRecord && tabRecord.navigation ? tabRecord.navigation : null;
      var navParams = navigation && navigation.params ? navigation.params : null;
      var initialUrl = navParams && typeof navParams.url === 'string' ? navParams.url : '';
      var navigationRevision = navigation && navigation.revision !== undefined ? navigation.revision : null;
      var navKey = String(navigationRevision === null ? '' : navigationRevision) + '|' + initialUrl;
      var urlInputHook = React.useState(initialUrl);
      var urlInput = urlInputHook[0];
      var setUrlInput = urlInputHook[1];
      var viewHook = React.useState({ status: initialUrl ? 'loading' : 'idle', url: initialUrl, doc: null, comments: [], error: null });
      var view = viewHook[0];
      var setView = viewHook[1];
      var loadedUrlHook = React.useState('');
      var loadedUrl = loadedUrlHook[0];
      var setLoadedUrl = loadedUrlHook[1];
      var busyHook = React.useState(false);
      var busy = busyHook[0];
      var setBusy = busyHook[1];
      var actionErrorHook = React.useState(null);
      var actionError = actionErrorHook[0];
      var setActionError = actionErrorHook[1];
      var noticeHook = React.useState(null);
      var notice = noticeHook[0];
      var setNotice = noticeHook[1];
      var commentDraftHook = React.useState('');
      var commentDraft = commentDraftHook[0];
      var setCommentDraft = commentDraftHook[1];
      var replyTargetHook = React.useState(null);
      var replyTarget = replyTargetHook[0];
      var setReplyTarget = replyTargetHook[1];
      var replyDraftHook = React.useState('');
      var replyDraft = replyDraftHook[0];
      var setReplyDraft = replyDraftHook[1];
      var selectedBlockHook = React.useState('');
      var selectedBlockId = selectedBlockHook[0];
      var setSelectedBlockId = selectedBlockHook[1];
      var autoRefreshedAtHook = React.useState(null);
      var autoRefreshedAt = autoRefreshedAtHook[0];
      var setAutoRefreshedAt = autoRefreshedAtHook[1];
      var revisionNoticeHook = React.useState(null);
      var revisionNotice = revisionNoticeHook[0];
      var setRevisionNotice = revisionNoticeHook[1];
      var manualTextHook = React.useState('');
      var manualText = manualTextHook[0];
      var setManualText = manualTextHook[1];
      var pageVisibleHook = React.useState(true);
      var pageVisible = pageVisibleHook[0];
      var setPageVisible = pageVisibleHook[1];
      var autoNativeHook = React.useState(function () {
        try {
          var stored = window.localStorage.getItem('dsh-ppt-workbench.feishu.autoNative');
          return stored === null ? true : stored === 'true';
        } catch (error) {
          return true;
        }
      });
      var autoNative = autoNativeHook[0];
      var setAutoNative = autoNativeHook[1];
      var autoNativeRef = React.useRef(autoNative);
      autoNativeRef.current = autoNative;
      var lastAutoNativeRef = React.useRef('');
      var loadSeqRef = React.useRef(0);
      var loadedUrlRef = React.useRef('');
      loadedUrlRef.current = loadedUrl;
      var viewRef = React.useRef(null);
      viewRef.current = view;
      var autoGuardRef = React.useRef(null);

      function loadDoc(rawUrl) {
        var value = String(rawUrl === undefined || rawUrl === null ? '' : rawUrl).trim();
        if (!value) {
          setView({ status: 'idle', url: '', doc: null, comments: [], error: null });
          setLoadedUrl('');
          return;
        }
        loadSeqRef.current += 1;
        var seq = loadSeqRef.current;
        setView(function (previous) {
          return {
            status: 'loading',
            url: value,
            doc: previous && previous.doc ? previous.doc : null,
            comments: previous && previous.comments ? previous.comments : [],
            error: null,
          };
        });
        feishuFetch('doc', { url: value }).then(function (result) {
          if (seq !== loadSeqRef.current) return;
          if (!result.ok || !result.data || result.data.ok !== true) throw normalizeError(result);
          var data = result.data;
          var comments = sortFeishuComments(data.comments);
          setView({ status: 'ready', url: typeof data.url === 'string' ? data.url : value, doc: data, comments: comments, error: null });
          setLoadedUrl(typeof data.url === 'string' ? data.url : value);
          var nativeUrl = typeof data.url === 'string' && data.url ? data.url : value;
          if (autoNativeRef.current && nativeUrl && lastAutoNativeRef.current !== nativeUrl &&
              typeof props.openNativeBrowser === 'function') {
            lastAutoNativeRef.current = nativeUrl;
            try { props.openNativeBrowser(nativeUrl); } catch (error) { /* ignore */ }
          }
        }).catch(function (error) {
          if (seq !== loadSeqRef.current) return;
          var normalized = error && error.code ? error : normalizeError(error);
          setView({
            status: 'error',
            url: value,
            doc: null,
            comments: [],
            error: {
              code: normalized.code,
              message: t('feishu.loadFailed', { message: normalized.message || t('edit.unknown') }),
            },
          });
        });
      }

      function openDoc() {
        var value = String(urlInput || '').trim();
        if (!value) {
          setActionError(t('feishu.badUrl'));
          return;
        }
        setActionError(null);
        setNotice(null);
        loadDoc(value);
      }

      function refreshComments() {
        var current = loadedUrlRef.current;
        if (!current) return Promise.resolve(false);
        return feishuFetch('comments', { url: current, status: 'all' }).then(function (result) {
          if (!result.ok || !result.data || result.data.ok !== true) return false;
          var comments = sortFeishuComments(result.data.comments);
          setView(function (previous) {
            if (!previous) return previous;
            return Object.assign({}, previous, { comments: comments });
          });
          return true;
        }).catch(function () {
          return false;
        });
      }

      function quietRefreshDoc() {
        var current = loadedUrlRef.current;
        if (!current) return Promise.resolve(false);
        return feishuFetch('doc', { url: current }).then(function (result) {
          if (!result.ok || !result.data || result.data.ok !== true) return false;
          var data = result.data;
          var comments = sortFeishuComments(data.comments);
          var previousRevision = viewRef.current && viewRef.current.doc ? viewRef.current.doc.revisionId : null;
          var nextRevision = data.revisionId;
          setView(function (previous) {
            if (!previous || previous.status !== 'ready') return previous;
            return Object.assign({}, previous, {
              url: typeof data.url === 'string' ? data.url : previous.url,
              doc: data,
              comments: comments,
              error: null,
            });
          });
          setLoadedUrl(typeof data.url === 'string' ? data.url : current);
          setAutoRefreshedAt(Date.now());
          var changed = previousRevision !== null && previousRevision !== undefined &&
            nextRevision !== null && nextRevision !== undefined &&
            String(previousRevision) !== String(nextRevision);
          if (changed) setRevisionNotice({ previous: previousRevision, next: nextRevision });
          return true;
        }).catch(function () {
          return false;
        });
      }

      function submitAction(payload, successText) {
        var url = payload && payload.url ? payload.url : loadedUrlRef.current;
        if (!url) return Promise.resolve(false);
        var body = Object.assign({}, payload, { url: url });
        setBusy(true);
        setActionError(null);
        setNotice(null);
        return feishuFetch('comment', null, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }).then(function (result) {
          if (!result.ok || !result.data || result.data.ok !== true) throw normalizeError(result);
          return refreshComments().then(function () {
            setNotice(successText);
            return true;
          });
        }).catch(function (error) {
          var normalized = error && error.code ? error : normalizeError(error);
          setActionError(t('feishu.postFailed', { message: normalized.message || t('edit.unknown') }));
          return false;
        }).then(function (value) {
          setBusy(false);
          return value;
        });
      }

      function submitComment() {
        var text = String(commentDraft || '').trim();
        if (!text) {
          setActionError(t('feishu.commentEmpty'));
          return;
        }
        var url = loadedUrlRef.current;
        if (!url) return;
        var createPayload = { action: 'create', url: url, text: text };
        if (selectedBlockId) createPayload.blockId = selectedBlockId;
        submitAction(createPayload, t('feishu.commentAdded')).then(function (ok) {
          if (ok) {
            setCommentDraft('');
            setSelectedBlockId('');
          }
        });
      }

      function submitReply(commentId, text) {
        var body = String(text || '').trim();
        if (!body) return;
        var url = loadedUrlRef.current;
        if (!url) return;
        submitAction({ action: 'reply', url: url, commentId: commentId, text: body }, t('feishu.replyAdded')).then(function (ok) {
          if (ok) {
            setReplyTarget(null);
            setReplyDraft('');
          }
        });
      }

      function toggleSolved(commentId, solved) {
        var url = loadedUrlRef.current;
        if (!url) return;
        submitAction({ action: solved ? 'reopen' : 'resolve', url: url, commentId: commentId }, solved ? t('feishu.reopened') : t('feishu.resolved'));
      }

      function feishuCommentBody(comment) {
        var replies = Array.isArray(comment && comment.replies) ? comment.replies : [];
        var texts = replies.map(function (reply) {
          return String(reply && reply.text ? reply.text : '').trim();
        }).filter(Boolean);
        return texts.length ? texts.join('；') : t('feishu.noReplies');
      }

      function buildFeishuSendText() {
        var currentView = viewRef.current || {};
        var currentDoc = currentView.doc || null;
        if (!currentDoc) return '';
        var unresolved = (currentView.comments || []).filter(function (comment) {
          return comment && comment.solved !== true;
        });
        if (unresolved.length === 0) return '';
        var blocks = {};
        (Array.isArray(currentDoc.blocks) ? currentDoc.blocks : []).forEach(function (block) {
          if (block && typeof block.id === 'string' && block.id) blocks[block.id] = block;
        });
        var title = currentDoc.title || loadedUrlRef.current || 'feishu doc';
        var revision = currentDoc.revisionId === undefined || currentDoc.revisionId === null ? '-' : String(currentDoc.revisionId);
        var markdown = String(currentDoc.markdown || '').replace(/\s+/g, ' ').trim();
        var excerpt = markdown.length > 180 ? markdown.slice(0, 180) + '…' : markdown;
        var lines = [t('send.feishuHeader', { title: title })];
        lines.push(t('send.feishuMeta', { url: loadedUrlRef.current || currentDoc.url || '' }));
        lines.push(t('send.feishuRevision', { revision: revision }));
        lines.push(t('send.feishuSummary', { excerpt: excerpt || '—' }));
        lines.push('');
        lines.push(t('send.feishuComments', { count: unresolved.length }));
        unresolved.forEach(function (comment, index) {
          var blockId = comment && comment.anchorBlockId ? String(comment.anchorBlockId) : '';
          var block = blockId && blocks[blockId] ? blocks[blockId] : null;
          var target = comment && comment.quote
            ? String(comment.quote)
            : block && block.text
              ? String(block.text)
              : t('feishu.noReplies');
          lines.push(t('send.feishuLine', {
            index: index + 1,
            block: truncate(target, 120),
            body: feishuCommentBody(comment),
          }));
        });
        lines.push('');
        lines.push(t('send.feishuFooter'));
        return lines.join('\n');
      }

      function sendToDsh() {
        var text = buildFeishuSendText();
        if (!text) {
          setNotice(t('feishu.sendEmpty'));
          return;
        }
        var inputActions = props.inputActions;
        var inserted = false;
        try {
          if (inputActions && typeof inputActions.captureInsertion === 'function' && typeof inputActions.insertText === 'function') {
            var span = inputActions.captureInsertion();
            inserted = inputActions.insertText(text, span) !== false;
          }
        } catch (error) {
          inserted = false;
        }
        if (inserted) {
          setNotice(t('send.inserted'));
          return;
        }
        setManualText(text);
        setNotice(t('feishu.manualCopy'));
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          try {
            navigator.clipboard.writeText(text).then(function () {
              setNotice(t('send.copied'));
              setManualText('');
            }, function () {
              /* manual panel already shown */
            });
          } catch (error) {
            /* ignore */
          }
        }
      }

      React.useEffect(function () {
        if (initialUrl) loadDoc(initialUrl);
        return undefined;
      }, []);

      var navigationRef = React.useRef({ revision: navigationRevision, url: initialUrl });
      React.useEffect(function () {
        var nextUrl = initialUrl;
        var nextRevision = navigationRevision;
        var previous = navigationRef.current || {};
        navigationRef.current = { revision: nextRevision, url: nextUrl };
        if (!nextUrl) return;
        if (previous.url === nextUrl && previous.revision === nextRevision) return;
        setUrlInput(nextUrl);
        loadDoc(nextUrl);
      }, [navKey]);

      React.useEffect(function () {
        if (!notice) return undefined;
        var timer = setTimeout(function () {
          setNotice(null);
        }, 2800);
        return function () {
          clearTimeout(timer);
        };
      }, [notice]);

      React.useEffect(function () {
        function onVisibilityChange() {
          setPageVisible(document.visibilityState !== 'hidden');
        }
        onVisibilityChange();
        document.addEventListener('visibilitychange', onVisibilityChange);
        return function () {
          document.removeEventListener('visibilitychange', onVisibilityChange);
        };
      }, []);

      React.useEffect(function () {
        var timer = setInterval(function () {
          var guard = autoGuardRef.current;
          if (!guard || !guard.ready || !guard.canRefresh || !guard.visible) return;
          quietRefreshDoc();
        }, FEISHU_AUTO_REFRESH_MS);
        return function () {
          clearInterval(timer);
        };
      }, []);

      React.useEffect(function () {
        if (!revisionNotice) return undefined;
        var timer = setTimeout(function () {
          setRevisionNotice(null);
        }, 8000);
        return function () {
          clearTimeout(timer);
        };
      }, [revisionNotice]);

      var status = view.status;
      var doc = view.doc;
      var comments = Array.isArray(view.comments) ? view.comments : [];
      var openCount = 0;
      comments.forEach(function (comment) {
        if (comment && comment.solved !== true) openCount += 1;
      });
      var externalUrl = doc && typeof doc.url === 'string' ? doc.url : loadedUrl;
      var showNotice = notice || null;
      var docBlocks = doc && Array.isArray(doc.blocks) ? doc.blocks : [];
      var blocksById = {};
      docBlocks.forEach(function (block) {
        if (block && typeof block.id === 'string' && block.id) blocksById[block.id] = block;
      });
      var blockTargets = [];
      for (var blockIndex = 0; blockIndex < docBlocks.length && blockTargets.length < FEISHU_BLOCK_LIMIT; blockIndex += 1) {
        var candidateBlock = docBlocks[blockIndex];
        if (!candidateBlock || typeof candidateBlock.id !== 'string' || !candidateBlock.id) continue;
        if (candidateBlock.type !== 'heading' && candidateBlock.type !== 'paragraph' && candidateBlock.type !== 'listItem') continue;
        blockTargets.push(candidateBlock);
      }
      var selectedBlock = selectedBlockId && blocksById[selectedBlockId] ? blocksById[selectedBlockId] : null;
      var canAutoRefresh = status === 'ready' && !busy && !replyTarget &&
        !String(commentDraft || '').trim() && !String(replyDraft || '').trim();
      var tabVisible = !(tabRecord && tabRecord.visible === false) && pageVisible;
      autoGuardRef.current = {
        ready: status === 'ready',
        canRefresh: canAutoRefresh,
        visible: tabVisible,
        url: loadedUrl,
      };
      function openNative(value) {
        var target = String(value || '').trim();
        if (!target) return;
        if (typeof props.openNativeBrowser === 'function') {
          try { props.openNativeBrowser(target); return; } catch (error) { /* fall through */ }
        }
        if (typeof window !== 'undefined') window.open(target, '_blank', 'noopener');
      }
      var nativeCandidate = String(urlInput || '').trim() || externalUrl || '';
      return h('div', {
        className: 'wb-feishu',
        'data-wb-feishu': '',
        'data-state': status,
      },
        h('div', { className: 'wb-feishuBar' },
          h('span', { className: 'wb-feishuChip' }, t('feishu.tabTitle')),
          h('input', {
            className: 'wb-feishuInput',
            type: 'url',
            value: urlInput,
            placeholder: t('feishu.urlPlaceholder'),
            'aria-label': t('feishu.urlPlaceholder'),
            spellCheck: false,
            onChange: function (event) {
              setUrlInput(event.target.value);
            },
            onKeyDown: function (event) {
              if (event.key === 'Enter') {
                event.preventDefault();
                openDoc();
              }
            },
          }),
          h('button', {
            type: 'button',
            className: 'wb-btn wb-primary',
            'aria-label': t('feishu.open'),
            disabled: busy || status === 'loading',
            onClick: openDoc,
          }, status === 'loading' ? t('feishu.opening') : t('feishu.open')),
          h('button', {
            type: 'button',
            className: 'wb-btn',
            'data-feishu-open-native': 'header',
            'aria-label': t('feishu.openNative'),
            title: t('feishu.openNativeTitle'),
            disabled: !nativeCandidate,
            onClick: function () { openNative(nativeCandidate); },
          }, t('feishu.openNative')),
          h('label', {
            className: 'wb-feishuMeta',
            title: t('feishu.autoNativeTitle'),
            style: { display: 'inline-flex', alignItems: 'center', gap: '4px', cursor: 'pointer' },
          },
            h('input', {
              type: 'checkbox',
              checked: !!autoNative,
              onChange: function (event) {
                var next = !!event.target.checked;
                setAutoNative(next);
                try { window.localStorage.setItem('dsh-ppt-workbench.feishu.autoNative', String(next)); } catch (error) { /* ignore */ }
              },
            }),
            t('feishu.autoNative')),
          status === 'ready'
            ? h('button', {
              type: 'button',
              className: 'wb-btn wb-icon',
              'aria-label': t('feishu.refresh'),
              title: t('feishu.refresh'),
              disabled: busy || status === 'loading',
              onClick: function () {
                loadDoc(loadedUrlRef.current || view.url);
              },
            }, h('span', { 'aria-hidden': true }, '⟳'))
            : null,
          status === 'ready'
            ? h('button', {
              type: 'button',
              className: 'wb-btn wb-primary',
              'aria-label': t('feishu.sendTitle'),
              title: t('feishu.sendTitle'),
              disabled: busy,
              onClick: sendToDsh,
            }, t('feishu.send'))
            : null,
          status === 'ready' && externalUrl
            ? h('a', {
              className: 'wb-feishuLink',
              'data-feishu-external': externalUrl,
              href: externalUrl,
              target: '_blank',
              rel: 'noopener noreferrer',
              title: t('feishu.externalTitle'),
            }, t('feishu.external'))
            : null),
        revisionNotice
          ? h('div', { className: 'wb-sourceStale', 'data-feishu-revision-notice': '' },
            h('span', null, t('feishu.revisionChanged', {
              previous: String(revisionNotice.previous),
              next: String(revisionNotice.next),
            })),
            h('button', {
              type: 'button',
              className: 'wb-linkBtn',
              onClick: function () {
                setRevisionNotice(null);
              },
            }, t('toast.close')))
          : null,
        manualText
          ? h('div', { className: 'wb-feishuManual', 'data-feishu-manual': '' },
            h('div', { className: 'wb-feishuMeta' }, t('feishu.manualCopy')),
            h('textarea', {
              className: 'wb-textarea',
              value: manualText,
              rows: 6,
              readOnly: true,
              onFocus: function (event) {
                try {
                  event.target.select();
                } catch (error) {
                  /* ignore */
                }
              },
            }),
            h('div', { className: 'wb-row', style: { justifyContent: 'flex-end' } },
              h('button', {
                type: 'button',
                className: 'wb-btn',
                onClick: function () {
                  setManualText('');
                },
              }, t('feishu.manualClose'))))
          : null,
        actionError
          ? h('div', { className: 'wb-feishuError', 'data-feishu-action-error': '' },
            h('span', null, actionError),
            h('button', {
              type: 'button',
              className: 'wb-linkBtn',
              onClick: function () {
                setActionError(null);
              },
            }, t('toast.close')))
          : null,
        showNotice
          ? h('div', { className: 'wb-sourceStale', 'data-feishu-notice': '' },
            h('span', null, showNotice),
            h('button', {
              type: 'button',
              className: 'wb-linkBtn',
              onClick: function () {
                setNotice(null);
              },
            }, t('toast.close')))
          : null,
        status === 'idle'
          ? h('div', { className: 'wb-feishuCenter' }, t('feishu.empty'))
          : status === 'loading'
            ? h('div', { className: 'wb-feishuCenter' },
              h('span', { className: 'wb-spinner', 'aria-hidden': true }),
              h('span', null, t('feishu.loading')))
            : status === 'error'
              ? h('div', { className: 'wb-feishuCenter' },
                h('div', { className: 'wb-feishuError', 'data-feishu-load-error': view.error ? view.error.code || 'error' : 'error' },
                  h('span', null, view.error && view.error.message ? view.error.message : t('feishu.loadFailed', { message: t('edit.unknown') }))),
                h('button', {
                  type: 'button',
                  className: 'wb-btn wb-primary',
                  'aria-label': t('feishu.retry'),
                  onClick: function () {
                    loadDoc(view.url || urlInput);
                  },
                }, t('feishu.retry')))
              : h('div', { className: 'wb-feishuBody' },
                h('div', { className: 'wb-feishuHead' },
                  h('div', { className: 'wb-feishuTitle', 'data-feishu-title': '' }, (doc && doc.title) || view.url || ''),
                  h('div', { className: 'wb-feishuMeta' },
                    doc && doc.revisionId !== undefined && doc.revisionId !== null
                      ? h('span', { className: 'wb-feishuChip' }, t('feishu.revision', { revision: String(doc.revisionId) }))
                      : null,
                    doc && doc.documentId
                      ? h('span', { className: 'wb-feishuChip' }, t('feishu.docId', { id: String(doc.documentId) }))
                      : null,
                    h('span', { className: 'wb-feishuChip' }, t('feishu.commentsCount', { count: comments.length, open: openCount })),
                    h('span', {
                      className: 'wb-feishuChip',
                      'data-feishu-auto-refresh': tabVisible && canAutoRefresh ? 'active' : 'paused',
                      title: t('feishu.autoRefresh'),
                    }, tabVisible && canAutoRefresh ? t('feishu.autoRefresh') : t('feishu.autoPaused')),
                    autoRefreshedAt
                      ? h('span', { className: 'wb-feishuMeta', 'data-feishu-auto-at': String(autoRefreshedAt) }, t('feishu.autoRefreshed', { time: formatClock(autoRefreshedAt) }))
                      : null)),
                h('pre', { className: 'wb-feishuMd', 'data-feishu-markdown': '' }, String((doc && doc.markdown) || '')),
                h('div', { className: 'wb-feishuSection' },
                  h('span', null, t('feishu.comments')),
                  h('span', { className: 'wb-feishuChip' }, t('feishu.commentsCount', { count: comments.length, open: openCount }))),
                h('div', { className: 'wb-feishuComposer' },
                  h('div', { className: 'wb-row', style: { alignItems: 'center', gap: '6px', flexWrap: 'wrap' } },
                    h('span', { className: 'wb-feishuMeta' }, t('feishu.blockSelect')),
                    h('select', {
                      className: 'wb-feishuSelect',
                      'data-feishu-block-select': '',
                      value: selectedBlockId,
                      disabled: busy,
                      'aria-label': t('feishu.blockSelect'),
                      onChange: function (event) {
                        setSelectedBlockId(event.target.value);
                      },
                    },
                      h('option', { value: '' }, t('feishu.blockFull')),
                      blockTargets.map(function (block, index) {
                        return h('option', { key: block.id, value: block.id },
                          t('feishu.blockOption', { index: index + 1, text: truncate(block.text, 42) }));
                      })),
                    blockTargets.length === 0
                      ? h('span', { className: 'wb-feishuMeta' }, t('feishu.noBlocks'))
                      : null),
                  selectedBlock
                    ? h('div', { className: 'wb-feishuTarget', 'data-feishu-block-target': selectedBlock.id },
                      h('span', null, t('feishu.blockTarget', { text: truncate(selectedBlock.text, 120) })),
                      h('button', {
                        type: 'button',
                        className: 'wb-linkBtn',
                        disabled: busy,
                        onClick: function () {
                          setSelectedBlockId('');
                        },
                      }, t('feishu.blockClear')))
                    : null,
                  h('textarea', {
                    className: 'wb-textarea',
                    value: commentDraft,
                    rows: 2,
                    disabled: busy,
                    placeholder: t('feishu.commentPlaceholder'),
                    'aria-label': t('feishu.commentPlaceholder'),
                    onChange: function (event) {
                      setCommentDraft(event.target.value);
                    },
                  }),
                  h('div', { className: 'wb-row', style: { justifyContent: 'flex-end' } },
                    h('button', {
                      type: 'button',
                      className: 'wb-btn wb-primary',
                      'aria-label': t('feishu.commentSubmit'),
                      disabled: busy || !String(commentDraft || '').trim(),
                      onClick: submitComment,
                    }, busy ? t('feishu.opening') : t('feishu.commentSubmit')))),
                comments.length === 0
                  ? h('div', { className: 'wb-empty' }, t('feishu.noComments'))
                  : comments.map(function (comment) {
                    return h(FeishuCommentCard, {
                      key: comment.id || String(comment.createdAt),
                      lang: language(),
                      comment: comment,
                      block: comment && comment.anchorBlockId ? blocksById[comment.anchorBlockId] : null,
                      busy: busy,
                      replyTarget: replyTarget,
                      replyDraft: replyDraft,
                      onReplyStart: function (commentId) {
                        setReplyTarget(commentId);
                        setReplyDraft('');
                      },
                      onReplyChange: function (value) {
                        setReplyDraft(value);
                      },
                      onReplyCancel: function () {
                        setReplyTarget(null);
                        setReplyDraft('');
                      },
                      onReplySubmit: submitReply,
                      onResolve: function (commentId) {
                        toggleSolved(commentId, false);
                      },
                      onReopen: function (commentId) {
                        toggleSolved(commentId, true);
                      },
                    });
                  })),
      );
    }

    // ------------------------------------------------------------------
    // 飞书设置卡（Plugins 设置页）
    // ------------------------------------------------------------------
    function FeishuSettingsCard(props) {
      var t = translator(language());
      useLocaleRevision();
      var view = props.view || 'summary';
      var authHook = React.useState({ loading: true, data: null, error: null });
      var auth = authHook[0];
      var setAuth = authHook[1];
      var appIdHook = React.useState('');
      var appId = appIdHook[0];
      var setAppId = appIdHook[1];
      var secretHook = React.useState('');
      var appSecret = secretHook[0];
      var setAppSecret = secretHook[1];
      var saveHook = React.useState({ saving: false, notice: '', error: '' });
      var saveState = saveHook[0];
      var setSaveState = saveHook[1];
      var loginHook = React.useState({ running: false, flow: null, user: null, error: '' });
      var login = loginHook[0];
      var setLogin = loginHook[1];
      var autoNativeHook = React.useState(function () {
        try {
          return window.localStorage.getItem('dsh-ppt-workbench.feishu.autoNative') !== 'false';
        } catch (error) {
          return true;
        }
      });
      var autoNative = autoNativeHook[0];
      var setAutoNative = autoNativeHook[1];
      var pollRef = React.useRef(null);

      function loadAuth() {
        setAuth({ loading: true, data: null, error: null });
        feishuFetch('auth-status').then(function (result) {
          if (!result.ok || !result.data || result.data.ok !== true) throw normalizeError(result);
          setAuth({ loading: false, data: result.data, error: null });
          if (result.data.appId) setAppId(function (previous) { return previous || result.data.appId; });
        }).catch(function (error) {
          setAuth({ loading: false, data: null, error: error && error.message ? error.message : t('feishu.loadFailed', { message: '' }) });
        });
      }

      function stopPolling() {
        if (pollRef.current !== null) {
          window.clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }

      function pollLogin(flowId) {
        feishuFetch('login/poll', null, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ flowId: flowId }),
        }).then(function (result) {
          if (!result.ok || !result.data || result.data.ok !== true) throw normalizeError(result);
          var data = result.data;
          if (data.status === 'pending') {
            if (data.interval && pollRef.current !== null) {
              stopPolling();
              pollRef.current = window.setInterval(function () { pollLogin(flowId); }, Math.max(2, Number(data.interval) || 5) * 1000);
            }
            return;
          }
          stopPolling();
          if (data.status === 'ok') {
            setLogin(function (previous) { return Object.assign({}, previous, { running: false, flow: null, user: data.user || null, error: '' }); });
            loadAuth();
            return;
          }
          setLogin(function (previous) { return Object.assign({}, previous, { running: false, flow: null, error: data.error || 'login failed' }); });
        }).catch(function (error) {
          stopPolling();
          setLogin(function (previous) { return Object.assign({}, previous, { running: false, error: error && error.message ? error.message : 'login failed' }); });
        });
      }

      function saveConfig() {
        setSaveState({ saving: true, notice: '', error: '' });
        feishuFetch('config', null, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ appId: appId, appSecret: appSecret }),
        }).then(function (result) {
          if (!result.ok || !result.data || result.data.ok !== true) throw normalizeError(result);
          setAppSecret('');
          setSaveState({ saving: false, notice: t('feishu.settingsSaved'), error: '' });
          loadAuth();
        }).catch(function (error) {
          setSaveState({ saving: false, notice: '', error: error && error.message ? error.message : 'save failed' });
        });
      }

      function startLogin() {
        stopPolling();
        setLogin({ running: true, flow: null, user: null, error: '' });
        feishuFetch('login/start', null, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        }).then(function (result) {
          if (!result.ok || !result.data || result.data.ok !== true) throw normalizeError(result);
          var flow = result.data;
          setLogin({ running: true, flow: flow, user: null, error: '' });
          var interval = Math.max(2, Number(flow.interval) || 5);
          pollRef.current = window.setInterval(function () { pollLogin(flow.flowId); }, interval * 1000);
        }).catch(function (error) {
          setLogin({ running: false, flow: null, user: null, error: error && error.message ? error.message : 'login failed' });
        });
      }

      function logout() {
        stopPolling();
        feishuFetch('logout', null, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        }).then(function () {
          setLogin({ running: false, flow: null, user: null, error: '' });
          loadAuth();
        }).catch(function () {});
      }

      React.useEffect(function () {
        loadAuth();
        return function () { stopPolling(); };
      }, []);

      if (view === 'summary') return h('div', null, t('feishu.settingsSummary'));

      var data = auth.data || {};
      var user = data.user || {};
      var configured = data.configured === true;
      var loggedIn = data.loggedIn === true;
      var statusText = auth.error ? auth.error : auth.loading ? t('feishu.opening') : (loggedIn ? t('feishu.settingsLoginOk', { name: user.name || user.openId || '' }) : (configured ? t('feishu.settingsConfigured') : t('feishu.settingsNotConfigured')));
      return h('div', { className: 'wb-feishuSettings', 'data-feishu-settings': '' },
        h('div', { className: 'wb-feishuSection' }, t('feishu.settingsAuth')),
        h('div', { className: 'wb-feishuMeta' }, t('feishu.settingsStatus', { status: String(statusText) })),
        h('div', { className: 'wb-feishuMeta' }, t('feishu.settingsCli')),
        h('div', { className: 'wb-feishuMeta' }, t('feishu.settingsOauth')),
        h('label', { className: 'wb-feishuMeta', style: { display: 'block', marginTop: '10px' } },
          t('feishu.settingsAppId'),
          h('input', {
            className: 'wb-feishuInput',
            type: 'text',
            value: appId,
            placeholder: 'cli_...',
            style: { marginLeft: '8px', width: 'calc(100% - 72px)' },
            onChange: function (event) { setAppId(event.target.value); },
          })),
        h('label', { className: 'wb-feishuMeta', style: { display: 'block', marginTop: '6px' } },
          t('feishu.settingsSecret'),
          h('input', {
            className: 'wb-feishuInput',
            type: 'password',
            value: appSecret,
            placeholder: configured ? t('feishu.settingsSecretHint') : '',
            style: { marginLeft: '8px', width: 'calc(100% - 92px)' },
            onChange: function (event) { setAppSecret(event.target.value); },
          })),
        h('div', { className: 'wb-row', style: { justifyContent: 'flex-start', marginTop: '10px', gap: '8px' } },
          h('button', { type: 'button', className: 'wb-btn wb-primary', disabled: saveState.saving, onClick: saveConfig }, t('feishu.settingsSave')),
          configured && !loggedIn
            ? h('button', { type: 'button', className: 'wb-btn', disabled: login.running, onClick: startLogin }, login.running ? t('feishu.settingsLoginPending') : t('feishu.settingsLogin'))
            : null,
          loggedIn ? h('button', { type: 'button', className: 'wb-btn', onClick: logout }, t('feishu.settingsLogout')) : null),
        saveState.notice ? h('div', { className: 'wb-sourceMeta' }, saveState.notice) : null,
        saveState.error ? h('div', { className: 'wb-sourceStale' }, t('feishu.settingsError', { message: saveState.error })) : null,
        login.flow ? h('div', { className: 'wb-feishuMeta' },
          h('a', { href: login.flow.verificationUriComplete || login.flow.verificationUri, target: '_blank', rel: 'noopener noreferrer' }, t('feishu.settingsVerification', { url: login.flow.verificationUriComplete || login.flow.verificationUri })),
          login.flow.userCode ? h('span', null, ' · ' + login.flow.userCode) : null) : null,
        login.error ? h('div', { className: 'wb-sourceStale' }, t('feishu.settingsError', { message: login.error })) : null,
        h('label', { className: 'wb-feishuMeta', style: { display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer', marginTop: '8px' } },
          h('input', {
            type: 'checkbox',
            checked: !!autoNative,
            onChange: function (event) {
              var next = !!event.target.checked;
              setAutoNative(next);
              try { window.localStorage.setItem('dsh-ppt-workbench.feishu.autoNative', String(next)); } catch (error) { /* ignore */ }
            },
          }),
          t('feishu.settingsAutoNative')),
        h('div', { className: 'wb-sourceMeta', style: { marginTop: '8px' } }, t('feishu.settingsOauthHint')),
      );
    }

    // ------------------------------------------------------------------
    // 主组件
    // ------------------------------------------------------------------
    function WorkbenchBody(props) {
      useLocaleRevision();

      var tabInfo = props.useTabInfo ? props.useTabInfo() : null;
      var tabSignal = tabInfo && tabInfo.tab ? tabInfo.tab.signal : null;

      var path = React.useMemo(function () {
        return decodeFilePath(props.resourceAddress);
      }, [props.resourceAddress]);
      var sessionId = props.sessionId || sessionIdFromAddress(props.resourceAddress);
      var content = props.content;
      var revision = content && content.kind === 'renderer' ? content.revision : undefined;

      var deckStateHook = React.useState({ status: 'loading', deck: null, slides: [], error: null, refreshing: false });
      var deckState = deckStateHook[0];
      var setDeckState = deckStateHook[1];
      var annotationsHook = React.useState(EMPTY_LIST);
      var annotations = annotationsHook[0];
      var setAnnotations = annotationsHook[1];
      var repairHook = React.useState(null);
      var repairNotice = repairHook[0];
      var setRepairNotice = repairHook[1];
      var dismissedRepairHook = React.useState(EMPTY_MAP);
      var dismissedRepairs = dismissedRepairHook[0];
      var setDismissedRepairs = dismissedRepairHook[1];
      var dismissedRefreshHook = React.useState(null);
      var dismissedRefresh = dismissedRefreshHook[0];
      var setDismissedRefresh = dismissedRefreshHook[1];
      var retryHook = React.useState(0);
      var retryToken = retryHook[0];
      var setRetryToken = retryHook[1];
      var currentPageHook = React.useState(1);
      var currentPage = currentPageHook[0];
      var setCurrentPage = currentPageHook[1];
      var selectedHook = React.useState(null);
      var selectedId = selectedHook[0];
      var setSelectedId = selectedHook[1];
      var filterHook = React.useState('open');
      var filter = filterHook[0];
      var setFilter = filterHook[1];
      var annotateHook = React.useState(false);
      var annotate = annotateHook[0];
      var setAnnotate = annotateHook[1];
      var draftHook = React.useState(null);
      var draft = draftHook[0];
      var setDraft = draftHook[1];
      var busyHook = React.useState(false);
      var busyOp = busyHook[0];
      var setBusyOp = busyHook[1];
      var toastHook = React.useState(null);
      var toast = toastHook[0];
      var setToast = toastHook[1];
      var zoomHook = React.useState('fit');
      var zoom = zoomHook[0];
      var setZoom = zoomHook[1];
      var railPrefHook = React.useState(null);
      var railPref = railPrefHook[0];
      var setRailPref = railPrefHook[1];
      var drawerPrefHook = React.useState(null);
      var drawerPref = drawerPrefHook[0];
      var setDrawerPref = drawerPrefHook[1];
      var editModeHook = React.useState(false);
      var editMode = editModeHook[0];
      var setEditMode = editModeHook[1];
      var selectedShapeHook = React.useState(null);
      var selectedShape = selectedShapeHook[0];
      var setSelectedShape = selectedShapeHook[1];
      var pendingOpsHook = React.useState(EMPTY_LIST);
      var pendingOps = pendingOpsHook[0];
      var setPendingOps = pendingOpsHook[1];
      var historyHook = React.useState(null);
      var historyState = historyHook[0];
      var setHistory = historyHook[1];
      var savingHook = React.useState(false);
      var saving = savingHook[0];
      var setSaving = savingHook[1];
      var conflictHook = React.useState(null);
      var conflict = conflictHook[0];
      var setConflict = conflictHook[1];
      var dirtyDialogHook = React.useState(null);
      var dirtyDialog = dirtyDialogHook[0];
      var setDirtyDialog = dirtyDialogHook[1];
      var formDirtyHook = React.useState(0);
      var formDirtyCount = formDirtyHook[0];
      var setFormDirtyCount = formDirtyHook[1];
      var inlineEditHook = React.useState(null);
      var inlineEdit = inlineEditHook[0];
      var setInlineEdit = inlineEditHook[1];
      var canvasGestureHook = React.useState(false);
      var canvasGesture = canvasGestureHook[0];
      var setCanvasGesture = canvasGestureHook[1];
      var autosaveHook = React.useState(readAutosavePref);
      var autosave = autosaveHook[0];
      var setAutosave = autosaveHook[1];
      var lastSavedHook = React.useState(null);
      var lastSavedAt = lastSavedHook[0];
      var setLastSavedAt = lastSavedHook[1];
      var nativeBusyHook = React.useState(false);
      var nativeBusy = nativeBusyHook[0];
      var setNativeBusy = nativeBusyHook[1];
      var resetNonceHook = React.useState(0);
      var resetNonce = resetNonceHook[0];
      var setResetNonce = resetNonceHook[1];
      var canvasNodeHook = React.useState(null);
      var canvasNode = canvasNodeHook[0];
      var setCanvasNode = canvasNodeHook[1];
      var sourceEditorHook = React.useState(null);
      var sourceEditor = sourceEditorHook[0];
      var setSourceEditor = sourceEditorHook[1];
      var drawioHook = React.useState(null);
      var drawioState = drawioHook[0];
      var setDrawioState = drawioHook[1];
      var drawioSrcHook = React.useState(null);
      var drawioSrc = drawioSrcHook[0];
      var setDrawioSrc = drawioSrcHook[1];
      var drawioSelectionHook = React.useState(EMPTY_LIST);
      var drawioSelection = drawioSelectionHook[0];
      var setDrawioSelection = drawioSelectionHook[1];
      var drawioPanelHook = React.useState(false);
      var drawioPanelOpen = drawioPanelHook[0];
      var setDrawioPanelOpen = drawioPanelHook[1];
      var drawioDraftHook = React.useState('');
      var drawioDraft = drawioDraftHook[0];
      var setDrawioDraft = drawioDraftHook[1];
      var drawioSelectedAnnotationHook = React.useState(null);
      var drawioSelectedAnnotationId = drawioSelectedAnnotationHook[0];
      var setDrawioSelectedAnnotationId = drawioSelectedAnnotationHook[1];
      var htmlHook = React.useState(null);
      var htmlState = htmlHook[0];
      var setHtmlState = htmlHook[1];
      var htmlSrcHook = React.useState(null);
      var htmlSrc = htmlSrcHook[0];
      var setHtmlSrc = htmlSrcHook[1];
      var htmlAnnotateHook = React.useState(false);
      var htmlAnnotate = htmlAnnotateHook[0];
      var setHtmlAnnotate = htmlAnnotateHook[1];
      var htmlPanelHook = React.useState(false);
      var htmlPanelOpen = htmlPanelHook[0];
      var setHtmlPanelOpen = htmlPanelHook[1];
      var htmlDraftHook = React.useState(null);
      var htmlDraft = htmlDraftHook[0];
      var setHtmlDraft = htmlDraftHook[1];
      var htmlDraftBodyHook = React.useState('');
      var htmlDraftBody = htmlDraftBodyHook[0];
      var setHtmlDraftBody = htmlDraftBodyHook[1];
      var htmlSelectedAnnotationHook = React.useState(null);
      var htmlSelectedAnnotationId = htmlSelectedAnnotationHook[0];
      var setHtmlSelectedAnnotationId = htmlSelectedAnnotationHook[1];

      var rootRef = React.useRef(null);
      var canvasRef = React.useRef(null);
      var railRef = React.useRef(null);
      var pageElsRef = React.useRef(new Map());
      var scrollTickRef = React.useRef(false);
      var scrollIntentRef = React.useRef(null);
      var busyRef = React.useRef(false);
      var toastIdRef = React.useRef(0);
      var contentRef = React.useRef(content);
      var sessionIdRef = React.useRef(sessionId);
      var pathRef = React.useRef(path);
      var deckRef = React.useRef(deckState.deck);
      var slidesRef = React.useRef(deckState.slides);
      var annotationsRef = React.useRef(annotations);
      var inputActionsRef = React.useRef(props.inputActions);
      var pendingOpsRef = React.useRef(EMPTY_LIST);
      var editModeRef = React.useRef(false);
      var selectedShapeRef = React.useRef(null);
      var historyRef = React.useRef(null);
      var formDiffRef = React.useRef(null);
      var formDirtyRef = React.useRef(0);
      var saveAllRef = React.useRef(null);
      var conflictRef = React.useRef(null);
      var draftBaseShaRef = React.useRef(null);
      var requestExitRef = React.useRef(null);
      var autoSaveBlockedRef = React.useRef(false);
      var viewSlidesRef = React.useRef(EMPTY_LIST);
      var inlineEditRef = React.useRef(null);
      var sourceEditorRef = React.useRef(null);
      var sourceSaveRef = React.useRef(null);
      var drawioStateRef = React.useRef(null);
      var drawioFrameRef = React.useRef(null);
      var drawioInitRef = React.useRef(false);
      var drawioFetchSeqRef = React.useRef(0);
      var drawioSelectionRef = React.useRef(EMPTY_LIST);
      var htmlFrameRef = React.useRef(null);
      var htmlStateRef = React.useRef(null);
      var htmlAnnotateRef = React.useRef(false);

      contentRef.current = content;
      sessionIdRef.current = sessionId;
      pathRef.current = path;
      deckRef.current = deckState.deck;
      slidesRef.current = deckState.slides;
      annotationsRef.current = annotations;
      inputActionsRef.current = props.inputActions;
      pendingOpsRef.current = pendingOps;
      editModeRef.current = editMode;
      selectedShapeRef.current = selectedShape;
      conflictRef.current = conflict;
      historyRef.current = historyState;
      formDirtyRef.current = formDirtyCount;
      inlineEditRef.current = inlineEdit;
      sourceEditorRef.current = sourceEditor;
      drawioStateRef.current = drawioState;
      drawioSelectionRef.current = drawioSelection;
      htmlStateRef.current = htmlState;
      htmlAnnotateRef.current = htmlAnnotate;

      var slides = deckState.slides;
      var deck = deckState.deck;
      var sha = deck ? deck.sha256 : null;
      var earlyDeckFormat = deck && deck.format === 'pdf' ? 'pdf' : 'pptx';
      var sourceFormatEarly = deck && typeof deck.sourceFormat === 'string' ? deck.sourceFormat : earlyDeckFormat;
      var sourceEditableEarly = !!(deck && deck.sourceFormat === 'mermaid');
      var sourceOpenEarly = !!(sourceEditor && sourceEditor.open);
      var sourceDirtyEarly = sourceOpenEarly ? ((sourceEditor.text || '') !== (sourceEditor.original || '')) : false;
      var isDrawioEarly = !!(deck && deck.sourceFormat === 'drawio');
      var isHtmlEarly = !!(deck && deck.sourceFormat === 'html');
      var slidesImages = useSlideImages(sha);
      var images = slidesImages.images;
      var ensurePage = slidesImages.ensurePage;
      var retryPage = slidesImages.retryPage;

      var rootWidth = useElementWidth(rootRef);
      var canvasWidth = useNodeWidth(canvasNode);
      var railOpen = railPref === null ? rootWidth === 0 || rootWidth >= RAIL_HIDE_WIDTH : railPref;
      var drawerOpen = drawerPref === null ? rootWidth === 0 || rootWidth >= DRAWER_HIDE_WIDTH : drawerPref;

      var lang = language();
      var t = translator(lang);

      // ---- deck 加载（revision 变化保留旧内容并静默刷新） ----
      React.useEffect(function () {
        if (!path) {
          setDeckState({ status: 'error', deck: null, slides: [], refreshing: false, error: { code: 'missing-path', message: tr('error.noPath') } });
          return undefined;
        }
        if (!sessionId) {
          setDeckState({ status: 'error', deck: null, slides: [], refreshing: false, error: { code: 'missing-session', message: tr('error.noSession') } });
          return undefined;
        }
        if (tabSignal && tabSignal.aborted) return undefined;
        var controller = new AbortController();
        function onTabAbort() {
          controller.abort();
        }
        if (tabSignal && typeof tabSignal.addEventListener === 'function') {
          tabSignal.addEventListener('abort', onTabAbort);
        }
        setDeckState(function (previous) {
          if (previous.deck) return Object.assign({}, previous, { refreshing: true, error: null });
          return { status: 'loading', deck: null, slides: [], refreshing: false, error: null };
        });
        function fail(error) {
          if (!error || error.code === 'aborted' || controller.signal.aborted) return;
          var keepDeck = !!deckRef.current;
          setDeckState(function (previous) {
            if (previous.deck) {
              return Object.assign({}, previous, { status: 'ready', refreshing: false, error: error });
            }
            return { status: 'error', deck: null, slides: [], refreshing: false, error: error };
          });
          if (!keepDeck) {
            var current = contentRef.current;
            if (current && typeof current.failed === 'function') {
              try {
                current.failed();
              } catch (error2) {
                /* ignore */
              }
            }
          }
        }
        jsonFetch(
          'deck?sessionId=' + encodeURIComponent(sessionId) + '&path=' + encodeURIComponent(path),
          { signal: controller.signal },
        ).then(function (result) {
          if (controller.signal.aborted) return;
          if (!result.ok || !result.data || result.data.ok !== true) {
            fail(normalizeError(result));
            return;
          }
          var data = result.data;
          var nextDeck = data.deck || {};
          var nextSlides = Array.isArray(data.slides) ? data.slides : [];
          setDeckState({ status: 'ready', deck: nextDeck, slides: nextSlides, refreshing: false, error: null });
          setAnnotations(Array.isArray(data.annotations) ? data.annotations : EMPTY_LIST);
          var repair = data.annotationsRepair || EMPTY_MAP;
          var repaired = Number(repair.repaired) || 0;
          var orphaned = Number(repair.orphaned) || 0;
          if (repaired + orphaned > 0) {
            setRepairNotice({ key: String(nextDeck.sha256 || ''), repaired: repaired, orphaned: orphaned });
          } else {
            setRepairNotice(null);
          }
          var nextHistory = extractHistory(data);
          if (nextHistory) setHistory(nextHistory);
          var previousDeck = deckRef.current;
          if (
            previousDeck &&
            nextDeck.sha256 &&
            previousDeck.sha256 !== nextDeck.sha256 &&
            pendingOpsRef.current.length > 0
          ) {
            setConflict({ code: 'stale', message: tr('edit.conflict'), currentSha: nextDeck.sha256, conflictCopy: null });
          }
          var currentSelection = selectedShapeRef.current;
          if (currentSelection && !findShapeAt(nextSlides, currentSelection.slideIndex, currentSelection.shapeId)) {
            setSelectedShape(null);
          }
          var current = contentRef.current;
          if (current && typeof current.loaded === 'function') {
            try {
              current.loaded('deck-' + String(nextDeck.sha256 || '').slice(0, 12));
            } catch (error) {
              /* ignore */
            }
          }
        }).catch(function (error) {
          fail(normalizeError(error));
        });
        return function () {
          if (tabSignal && typeof tabSignal.removeEventListener === 'function') {
            tabSignal.removeEventListener('abort', onTabAbort);
          }
          controller.abort();
        };
      }, [path, sessionId, revision, retryToken, tabSignal]);

      // ---- 全局 keydown：Esc 退出源码面板/草稿/批注/编辑模式 ----
      React.useEffect(function () {
        if (!draft && !annotate && !editMode && !sourceOpen) return undefined;
        function onKeyDown(event) {
          if (event.key !== 'Escape' || busyRef.current) return;
          if (dirtyDialog || saving) return;
          var sourceState = sourceEditorRef.current;
          if (sourceState && sourceState.open) {
            if (sourceState.saving) return;
            event.preventDefault();
            event.stopPropagation();
            if (sourceState.confirmClose) {
              setSourceEditor(function (previous) {
                return previous ? Object.assign({}, previous, { confirmClose: false }) : previous;
              });
            } else if (typeof closeSourceEditor === 'function') {
              closeSourceEditor();
            }
            return;
          }
          var active = document.activeElement;
          var tag = active && active.tagName ? String(active.tagName).toLowerCase() : '';
          if (tag === 'textarea' || tag === 'input') return;
          if (draft) {
            setDraft(null);
          } else if (annotate) {
            setAnnotate(false);
          } else if (editMode && requestExitRef.current) {
            requestExitRef.current(null);
          }
        }
        document.addEventListener('keydown', onKeyDown, true);
        return function () {
          document.removeEventListener('keydown', onKeyDown, true);
        };
      }, [draft, annotate, editMode, dirtyDialog, saving, sourceOpenEarly]);

      // ---- toast 自动消失 ----
      React.useEffect(function () {
        if (!toast || toast.kind === 'manual') return undefined;
        var id = toast.id;
        var timer = setTimeout(function () {
          setToast(function (current) {
            return current && current.id === id ? null : current;
          });
        }, 3600);
        return function () {
          clearTimeout(timer);
        };
      }, [toast]);

      // ---- deck 刷新后页码兜底 ----
      React.useEffect(function () {
        var count = deckState.deck && Array.isArray(deckState.deck.pages) ? deckState.deck.pages.length : 0;
        if (count > 0 && currentPage > count) setCurrentPage(count);
      }, [deckState.deck, currentPage]);

      // ---- 编辑模式：history 惰性补拉（deck.history 缺失时） ----
      React.useEffect(function () {
        if (!editMode || historyRef.current) return undefined;
        var currentDeck = deckRef.current;
        var sid = sessionIdRef.current;
        var deckPath = currentDeck && currentDeck.path ? currentDeck.path : pathRef.current;
        if (!currentDeck || !sid || !deckPath) return undefined;
        var cancelled = false;
        jsonFetch('history?sessionId=' + encodeURIComponent(sid) + '&path=' + encodeURIComponent(deckPath))
          .then(function (result) {
            if (cancelled || !result.ok || !result.data || result.data.ok !== true) return;
            var next = extractHistory(result.data) || {
              version: Number(result.data.version) || 0,
              cursor: Number(result.data.cursor) || 0,
              canUndo: result.data.canUndo === true,
              canRedo: result.data.canRedo === true,
            };
            setHistory(next);
          })
          .catch(function () {
            /* 按钮保持禁用 */
          });
        return function () {
          cancelled = true;
        };
      }, [editMode, historyState, sha]);

      // ---- ⌘/Ctrl+S 保存 ----
      React.useEffect(function () {
        function onKeyDown(event) {
          if (!editModeRef.current) return;
          if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
          if (event.key !== 's' && event.key !== 'S') return;
          event.preventDefault();
          event.stopPropagation();
          if (saveAllRef.current) saveAllRef.current({});
        }
        document.addEventListener('keydown', onKeyDown, true);
        return function () {
          document.removeEventListener('keydown', onKeyDown, true);
        };
      }, []);

      // ---- ⌘/Ctrl+S 保存 Mermaid 源码（源码面板内优先） ----
      React.useEffect(function () {
        function onKeyDown(event) {
          var editor = sourceEditorRef.current;
          if (!editor || !editor.open || editor.saving || editor.loading) return;
          if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
          if (event.key !== 's' && event.key !== 'S') return;
          event.preventDefault();
          event.stopPropagation();
          if (sourceSaveRef.current) sourceSaveRef.current();
        }
        document.addEventListener('keydown', onKeyDown, true);
        return function () {
          document.removeEventListener('keydown', onKeyDown, true);
        };
      }, []);

      // ---- 自动保存：pending 变化后 1500ms 空闲静默保存 ----
      React.useEffect(function () {
        if (!editMode || !autosave) return undefined;
        if (saving || busyOp || conflict || inlineEdit || canvasGesture || dirtyDialog) return undefined;
        if (pendingOps.length === 0) return undefined;
        if (autoSaveBlockedRef.current) return undefined;
        var timer = setTimeout(function () {
          if (saveAllRef.current) saveAllRef.current({ silent: true, auto: true });
        }, 1500);
        return function () {
          clearTimeout(timer);
        };
      }, [editMode, autosave, saving, busyOp, conflict, inlineEdit, canvasGesture, dirtyDialog, pendingOps]);

      // ---- 草稿版本：首次产生草稿时锁定 baseSha，整个草稿生命周期不随 deck 刷新漂移 ----
      React.useEffect(function () {
        var hasDraft = pendingOps.length > 0 || formDirtyCount > 0;
        if (!hasDraft) {
          draftBaseShaRef.current = null;
          return;
        }
        if (draftBaseShaRef.current === null && deckRef.current && deckRef.current.sha256) {
          draftBaseShaRef.current = deckRef.current.sha256;
        }
      }, [pendingOps, formDirtyCount]);

      // ---- drawio 内嵌编辑器：加载 XML 源码 ----
      React.useEffect(function () {
        if (!isDrawio) return undefined;
        fetchDrawioSource();
        return undefined;
      }, [isDrawioEarly, sha]);

      // ---- drawio iframe 协议：init / save ----
      React.useEffect(function () {
        if (!isDrawio) return undefined;
        function onMessage(event) {
          var frame = drawioFrameRef.current;
          if (!frame || event.source !== frame.contentWindow) return;
          var data = event.data;
          if (typeof data === 'string') {
            try {
              data = JSON.parse(data);
            } catch (error) {
              return;
            }
          }
          if (!data || typeof data !== 'object') return;
          if (data.event === 'init') {
            drawioInitRef.current = true;
            var state = drawioStateRef.current;
            if (state && typeof state.xml === 'string' && state.xml.length > 0 && state.status !== 'loading') {
              postDrawioLoad(state.xml);
            }
            return;
          }
          if (data.event === 'save') {
            saveDrawioSource(String(data.xml === undefined || data.xml === null ? '' : data.xml));
            return;
          }
          if (data.event === 'dsh-selection') {
            var cells = Array.isArray(data.cells) ? data.cells : [];
            setDrawioSelection(cells.filter(function (cell) {
              return cell && typeof cell.id === 'string' && cell.id.length > 0;
            }));
          }
        }
        window.addEventListener('message', onMessage);
        return function () {
          window.removeEventListener('message', onMessage);
        };
      }, [isDrawioEarly]);

      // 监听器已挂载后再给 iframe 赋 src，避免错过编辑器启动时的 {event:'init'}
      React.useEffect(function () {
        if (!isDrawio) return undefined;
        setDrawioSrc(drawioEditorUrl());
        return undefined;
      }, [isDrawioEarly]);


      // ---- H5 原页 iframe --------------------------------��-----------
      // bridge 事件：ready / scroll / pick
      React.useEffect(function () {
        if (!isHtmlEarly) return undefined;
        function onMessage(event) {
          var frame = htmlFrameRef.current;
          if (!frame || event.source !== frame.contentWindow) return;
          var data = event.data;
          if (typeof data === 'string') {
            try {
              data = JSON.parse(data);
            } catch (error) {
              return;
            }
          }
          if (!data || typeof data !== 'object' || typeof data.event !== 'string') return;
          if (data.event === 'dsh-html-ready') {
            setHtmlState(function (previous) {
              return Object.assign({}, previous || {}, {
                status: 'ready',
                title: typeof data.title === 'string' && data.title ? data.title : (previous && previous.title) || '',
                scrollY: Number(data.scrollY) || 0,
                scrollHeight: Number(data.scrollHeight) || (previous && previous.scrollHeight) || 0,
                viewportWidth: Number(data.viewportWidth) || (previous && previous.viewportWidth) || 0,
                viewportHeight: Number(data.viewportHeight) || (previous && previous.viewportHeight) || 0,
                error: null,
              });
            });
            postHtmlAnnotate();
            return;
          }
          if (data.event === 'dsh-html-scroll') {
            setHtmlState(function (previous) {
              return Object.assign({}, previous || {}, {
                scrollY: Number(data.scrollY) || 0,
                scrollHeight: Number(data.scrollHeight) || (previous && previous.scrollHeight) || 0,
              });
            });
            return;
          }
          if (data.event === 'dsh-html-pick') {
            var draft = {
              selector: typeof data.selector === 'string' ? data.selector : '',
              textQuote: typeof data.textQuote === 'string' ? data.textQuote.slice(0, 500) : '',
              xNorm: Number(data.xNorm) || 0,
              yNorm: Number(data.yNorm) || 0,
              scrollY: Number(data.scrollY) || 0,
              tag: typeof data.tag === 'string' ? data.tag.slice(0, 80) : '',
            };
            setHtmlDraft(draft);
            setHtmlDraftBody('');
            setHtmlPanelOpen(true);
            setHtmlState(function (previous) {
              return Object.assign({}, previous || {}, {
                scrollY: draft.scrollY,
                viewportWidth: Number(data.viewportWidth) || (previous && previous.viewportWidth) || 0,
                viewportHeight: Number(data.viewportHeight) || (previous && previous.viewportHeight) || 0,
              });
            });
          }
        }
        window.addEventListener('message', onMessage);
        return function () {
          window.removeEventListener('message', onMessage);
        };
      }, [isHtmlEarly]);

      // 监听器挂载后再赋 iframe src
      React.useEffect(function () {
        if (!isHtmlEarly) return undefined;
        var url = htmlState && typeof htmlState.url === 'string' ? htmlState.url : '';
        if (url) setHtmlSrc(url);
        return undefined;
      }, [isHtmlEarly, htmlState && htmlState.url]);

      // 批注模式开关同步给 bridge
      React.useEffect(function () {
        if (!isHtmlEarly) return undefined;
        postHtmlAnnotate();
        return undefined;
      }, [isHtmlEarly, htmlAnnotate, htmlSrc]);

      // Esc 退出批注模式
      React.useEffect(function () {
        if (!isHtmlEarly || !htmlAnnotate) return undefined;
        function onKeyDown(event) {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          event.stopPropagation();
          setHtmlAnnotate(false);
        }
        document.addEventListener('keydown', onKeyDown, true);
        return function () {
          document.removeEventListener('keydown', onKeyDown, true);
        };
      }, [isHtmlEarly, htmlAnnotate]);

      // 拉取 artifact-url
      React.useEffect(function () {
        if (!isHtmlEarly) return undefined;
        fetchHtmlArtifactUrl();
        return undefined;
      }, [isHtmlEarly, sha]);

      var byId = React.useMemo(function () {
        var map = new Map();
        for (var index = 0; index < annotations.length; index += 1) {
          var annotation = annotations[index];
          if (annotation && annotation.id) map.set(annotation.id, annotation);
        }
        return map;
      }, [annotations]);
      var annotationsRefMap = React.useRef(byId);
      annotationsRefMap.current = byId;

      var annotationsByPage = React.useMemo(function () {
        var map = {};
        for (var index = 0; index < annotations.length; index += 1) {
          var annotation = annotations[index];
          if (annotation && Number.isInteger(annotation.slideIndex)) {
            if (!map[annotation.slideIndex]) map[annotation.slideIndex] = [];
            map[annotation.slideIndex].push(annotation);
          }
        }
        return map;
      }, [annotations]);

      var openCountsByPage = React.useMemo(function () {
        var map = {};
        for (var index = 0; index < annotations.length; index += 1) {
          var annotation = annotations[index];
          if (annotation && annotation.status === 'open' && Number.isInteger(annotation.slideIndex)) {
            map[annotation.slideIndex] = (map[annotation.slideIndex] || 0) + 1;
          }
        }
        return map;
      }, [annotations]);

      var counts = React.useMemo(function () {
        var result = { open: 0, resolved: 0, orphaned: 0 };
        for (var index = 0; index < annotations.length; index += 1) {
          var annotation = annotations[index];
          var status = annotation && annotation.status ? annotation.status : 'open';
          if (result[status] === undefined) result[status] = 0;
          result[status] += 1;
        }
        return result;
      }, [annotations]);

      var pages = deck && Array.isArray(deck.pages) ? deck.pages : EMPTY_LIST;
      var total = pages.length;
      var renderedPages = Number(deck && deck.renderedPages) || total;
      var slideCount = Number(deck && deck.slideCount) || total;
      var truncated = !!(deck && deck.truncated);
      var missingFonts = deck && Array.isArray(deck.missingFonts) ? deck.missingFonts : EMPTY_LIST;
      var writeAllowed = !deck || deck.writeAllowed !== false;
      var deckFormat = deck && deck.format === 'pdf' ? 'pdf' : 'pptx';
      var sourceFormat = sourceFormatEarly;
      var sourceEditable = sourceEditableEarly;
      var sourceOpen = sourceOpenEarly;
      var sourceDirty = sourceDirtyEarly;
      var isDrawio = isDrawioEarly;
      var isHtml = isHtmlEarly;
      var artifactEditable = !!deck && deck.editable !== false && deckFormat === 'pptx';
      var slideWidthEmu = deck ? Number(deck.slideWidthEmu) : NaN;
      var slideHeightEmu = deck ? Number(deck.slideHeightEmu) : NaN;
      if (deck && Array.isArray(deck.pages) && deck.pages.length && (!Number.isFinite(slideWidthEmu) || slideWidthEmu <= 0)) {
        var firstPageRect = deck.pages[0].rectangle || {};
        if (Number(firstPageRect.width) > 0) {
          slideWidthEmu = Math.round(Number(firstPageRect.width) * 9525);
          slideHeightEmu = Math.round(Number(firstPageRect.height) * 9525);
        }
      }
      var fitWidth = canvasWidth > 0 ? Math.max(160, canvasWidth - 24) : null;
      var openCount = counts.open || 0;

      // ---- 编辑派生状态（pendingOps 叠加到 inventory 上） ----
      var pendingView = React.useMemo(function () {
        return buildPendingView(slides, pendingOps);
      }, [slides, pendingOps]);
      var viewSlides = pendingView.slides;
      var viewNotes = pendingView.notes;
      viewSlidesRef.current = viewSlides;
      var selectedShapeView = editMode && selectedShape
        ? findViewShape(viewSlides, selectedShape.slideIndex, selectedShape.shapeId)
        : null;
      var selectedShapeReadonly = false;
      if (selectedShapeView) {
        selectedShapeReadonly = !isShapeEditable(selectedShapeView) &&
          !(selectedShapeView.hasTable && selectedShapeView.table);
      }
      var selectedShapeBox = null;
      if (editMode && selectedShapeView && Number.isFinite(slideWidthEmu) && Number.isFinite(slideHeightEmu)) {
        var selectedBoxStyle = shapeBox(selectedShapeView, slideWidthEmu, slideHeightEmu);
        if (selectedBoxStyle) {
          selectedShapeBox = {
            box: selectedBoxStyle,
            norm: {
              x: Number(selectedShapeView.left) / slideWidthEmu,
              y: Number(selectedShapeView.top) / slideHeightEmu,
              w: Number(selectedShapeView.width) / slideWidthEmu,
              h: Number(selectedShapeView.height) / slideHeightEmu,
            },
            name: selectedShapeView.name || '',
            readonly: selectedShapeReadonly,
          };
        }
      }
      var selectedShapeEditable = selectedShapeView ? isShapeEditable(selectedShapeView) : false;
      var currentSlideIndex = Math.min(Math.max(0, currentPage - 1), Math.max(0, viewSlides.length - 1));
      var currentSlideView = viewSlides[currentSlideIndex] || null;
      var currentSlideNotes = currentSlideView && typeof currentSlideView.notes === 'string' ? currentSlideView.notes : '';
      var currentNotes = viewNotes.has(currentSlideIndex) ? viewNotes.get(currentSlideIndex) : currentSlideNotes;
      var pendingCount = pendingOps.length;
      var formDirty = formDirtyCount;
      var dirtyCount = pendingCount + (editMode ? formDirty : 0);
      var canEdit = writeAllowed && !!deck && artifactEditable;
      var canUndo = !!(historyState && historyState.canUndo);
      var canRedo = !!(historyState && historyState.canRedo);
      var resetKey = [
        sha || '',
        currentSlideIndex,
        selectedShape ? selectedShape.shapeId : 'notes',
        resetNonce,
      ].join('|');
      var saveStatusText = saving
        ? t('edit.saveSaving')
        : lastSavedAt
          ? t('edit.saveSavedAt', { time: formatClock(lastSavedAt) })
          : '';

      // ---- toast / 回调 ----
      var showToast = React.useCallback(function (kind, text, payload) {
        toastIdRef.current += 1;
        setToast({ id: toastIdRef.current, kind: kind, text: text, payload: payload });
      }, []);

      var runOp = React.useCallback(function (payload) {
        if (busyRef.current) return Promise.resolve(null);
        var currentDeck = deckRef.current;
        var deckPath = currentDeck && currentDeck.path ? currentDeck.path : pathRef.current;
        var sid = sessionIdRef.current;
        if (!sid || !deckPath) return Promise.resolve(null);
        if (currentDeck && currentDeck.writeAllowed === false) {
          showToast('error', tr('compose.noWrite'));
          return Promise.resolve(null);
        }
        busyRef.current = true;
        setBusyOp(true);
        var requestBody = Object.assign(
          { sessionId: sid, path: deckPath, author: { id: 'local', name: tr('author.me') } },
          payload,
        );
        return jsonFetch('annotations', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(requestBody),
        }).then(function (result) {
          if (!result.ok || !result.data || result.data.ok !== true) throw normalizeError(result);
          var data = result.data;
          setAnnotations(Array.isArray(data.annotations) ? data.annotations : EMPTY_LIST);
          var repair = data.annotationsRepair || EMPTY_MAP;
          var repaired = Number(repair.repaired) || 0;
          var orphaned = Number(repair.orphaned) || 0;
          if (repaired + orphaned > 0) {
            setRepairNotice({ key: String(data.deckSha || '') + '@' + Date.now(), repaired: repaired, orphaned: orphaned });
          }
          return data;
        }).catch(function (error) {
          var normalized = normalizeError(error);
          if (normalized.code === 'outside-workspace') showToast('error', tr('compose.noWrite'));
          else if (normalized.code === 'session-not-live') showToast('error', tr('error.session'));
          else showToast('error', normalized.message || tr('error.generic'));
          return null;
        }).then(function (value) {
          busyRef.current = false;
          setBusyOp(false);
          return value;
        });
      }, [showToast]);

      var retryDeck = React.useCallback(function () {
        setRetryToken(function (value) {
          return value + 1;
        });
        var current = contentRef.current;
        if (current && typeof current.reload === 'function') {
          try {
            current.reload();
          } catch (error) {
            /* ignore */
          }
        }
      }, []);

      var scrollportRefProp = React.useRef(null);
      scrollportRefProp.current = props.scrollportRef;
      var setCanvasRef = React.useCallback(function (node) {
        canvasRef.current = node;
        setCanvasNode(node);
        var scrollport = scrollportRefProp.current;
        if (typeof scrollport === 'function') {
          try {
            scrollport(node);
          } catch (error) {
            /* ignore */
          }
        }
      }, []);

      var scrollToPage = React.useCallback(function (page, smooth) {
        var container = canvasRef.current;
        var node = pageElsRef.current.get(page);
        if (!container || !node) return;
        var apply = function () {
          var nodeRect = node.getBoundingClientRect();
          var containerRect = container.getBoundingClientRect();
          var target = container.scrollTop + (nodeRect.top - containerRect.top) - 8;
          if (!Number.isFinite(target)) return;
          target = Math.max(0, target);
          try {
            container.scrollTop = target;
          } catch (error) {
            /* ignore */
          }
          if (smooth) {
            try {
              container.scrollTo({ top: target, behavior: 'smooth' });
            } catch (error2) {
              /* ignore */
            }
          }
        };
        // The host may restore its recorded scroll offset while the click's React
        // commit is applied. Defer the actual scroll to after that commit (two
        // frames) so thumbnail navigation reliably moves the canvas.
        if (typeof window.requestAnimationFrame === 'function') {
          window.requestAnimationFrame(function () {
            window.requestAnimationFrame(apply);
          });
        } else {
          setTimeout(apply, 0);
        }
      }, []);

      var selectPage = React.useCallback(function (page) {
        scrollIntentRef.current = { page: page, at: Date.now() };
        if (editModeRef.current) setSelectedShape(null);
        setCurrentPage(page);
        scrollToPage(page, true);
      }, [scrollToPage]);

      var handleCanvasScroll = React.useCallback(function (event) {
        if (scrollTickRef.current) return;
        scrollTickRef.current = true;
        var node = event.currentTarget;
        var schedule = window.requestAnimationFrame || function (callback) { return setTimeout(callback, 16); };
        schedule(function () {
          scrollTickRef.current = false;
          var intent = scrollIntentRef.current;
          if (intent && Date.now() - intent.at < 1500) {
            setCurrentPage(function (previous) {
              return previous === intent.page ? previous : intent.page;
            });
            return;
          }
          if (intent) scrollIntentRef.current = null;
          var containerRect = node.getBoundingClientRect();
          var best = 1;
          var bestVisible = -Infinity;
          pageElsRef.current.forEach(function (element, page) {
            if (!element) return;
            var rect = element.getBoundingClientRect();
            var visible = Math.min(rect.bottom, containerRect.bottom) - Math.max(rect.top, containerRect.top);
            if (visible > bestVisible) {
              bestVisible = visible;
              best = page;
            }
          });
          if (!Number.isFinite(bestVisible) || bestVisible <= 0) return;
          setCurrentPage(function (previous) {
            return previous === best ? previous : best;
          });
        });
      }, []);

      var registerPageNode = React.useCallback(function (page, node) {
        if (node) pageElsRef.current.set(page, node);
      }, []);

      var selectAnnotation = React.useCallback(function (id) {
        var annotation = annotationsRefMap.current.get(id);
        if (!annotation) return;
        setSelectedId(id);
        setDrawerPref(true);
        if (annotation.status) setFilter(annotation.status);
        if (annotation.status !== 'orphaned' && Number.isInteger(annotation.slideIndex)) {
          scrollToPage(annotation.slideIndex + 1, true);
        }
      }, [scrollToPage]);

      var handlePageTap = React.useCallback(function (page, point) {
        if (!annotate || busyRef.current) return;
        var currentDeck = deckRef.current;
        if (!currentDeck || currentDeck.writeAllowed === false) return;
        var slide = slidesRef.current[page.page - 1];
        var widthEmu = Number(currentDeck.slideWidthEmu);
        var heightEmu = Number(currentDeck.slideHeightEmu);
        var shape = slide && Number.isFinite(widthEmu) && Number.isFinite(heightEmu)
          ? hitShape(slide, point.x * widthEmu, point.y * heightEmu)
          : null;
        setSelectedId(null);
        setDraft({
          page: page.page,
          slideIndex: page.page - 1,
          pointNorm: { x: point.x, y: point.y },
          shapeIds: shape && Number.isInteger(shape.shapeId) ? [shape.shapeId] : [],
          shapes: shape ? [shape] : [],
          areaNorm: null,
          pdf: currentDeck.format === 'pdf',
          body: '',
        });
      }, [annotate]);

      var handlePageMarquee = React.useCallback(function (page, rectNorm) {
        if (!annotate || busyRef.current) return;
        var currentDeck = deckRef.current;
        if (!currentDeck || currentDeck.writeAllowed === false) return;
        var slide = slidesRef.current[page.page - 1];
        var widthEmu = Number(currentDeck.slideWidthEmu);
        var heightEmu = Number(currentDeck.slideHeightEmu);
        var hits = slide && Number.isFinite(widthEmu) && Number.isFinite(heightEmu)
          ? shapesIntersecting(slide, rectNorm, widthEmu, heightEmu)
          : [];
        setSelectedId(null);
        setDraft({
          page: page.page,
          slideIndex: page.page - 1,
          pointNorm: { x: clamp01(rectNorm.x + rectNorm.w / 2), y: clamp01(rectNorm.y + rectNorm.h / 2) },
          shapeIds: hits.map(function (shape) { return shape.shapeId; }).filter(function (value) { return Number.isInteger(value); }),
          shapes: hits,
          areaNorm: hits.length === 0 ? rectNorm : null,
          pdf: currentDeck.format === 'pdf',
          body: '',
        });
      }, [annotate]);

      var changeDraftBody = React.useCallback(function (value) {
        setDraft(function (previous) {
          if (!previous) return previous;
          return Object.assign({}, previous, { body: value });
        });
      }, []);

      var cancelDraft = React.useCallback(function () {
        setDraft(null);
      }, []);

      var saveDraft = React.useCallback(function (draftValue) {
        if (!draftValue || busyRef.current) return;
        var body = String(draftValue.body || '').trim();
        if (!body) {
          showToast('error', tr('compose.empty'));
          return;
        }
        if (!Number.isInteger(draftValue.slideIndex) || draftValue.slideIndex < 0) return;
        var payload = { op: 'create', slideIndex: draftValue.slideIndex, pointNorm: draftValue.pointNorm, body: body };
        if (Array.isArray(draftValue.shapeIds) && draftValue.shapeIds.length > 0) {
          payload.shapeIds = draftValue.shapeIds.filter(function (value) { return Number.isInteger(value); });
        } else if (draftValue.areaNorm) {
          payload.bboxNorm = draftValue.areaNorm;
        }
        var currentDeck = deckRef.current;
        if (currentDeck && currentDeck.format === 'pdf') payload.format = 'pdf';
        var slideIndex = draftValue.slideIndex;
        runOp(payload).then(function (data) {
          if (!data) return;
          setDraft(null);
          var created = null;
          var list = Array.isArray(data.annotations) ? data.annotations : [];
          for (var index = list.length - 1; index >= 0; index -= 1) {
            if (list[index] && list[index].body === body && list[index].slideIndex === slideIndex) {
              created = list[index];
              break;
            }
          }
          if (created) {
            setSelectedId(created.id);
            setFilter('open');
            setDrawerPref(true);
          }
          showToast('success', tr('compose.saved'));
        });
      }, [runOp, showToast]);

      var resolveAnnotation = React.useCallback(function (annotation) {
        if (!annotation) return Promise.resolve(null);
        return runOp({ op: 'resolve', id: annotation.id }).then(function (data) {
          if (!data) return null;
          setFilter('resolved');
          showToast('success', tr('annotation.resolvedToast'));
          return data;
        });
      }, [runOp, showToast]);

      var reopenAnnotation = React.useCallback(function (annotation) {
        if (!annotation) return Promise.resolve(null);
        return runOp({ op: 'reopen', id: annotation.id }).then(function (data) {
          if (!data) return null;
          setFilter('open');
          showToast('success', tr('annotation.reopenedToast'));
          return data;
        });
      }, [runOp, showToast]);

      var deleteAnnotation = React.useCallback(function (annotation) {
        if (!annotation) return Promise.resolve(null);
        return runOp({ op: 'delete', id: annotation.id }).then(function (data) {
          if (!data) return null;
          if (selectedId === annotation.id) setSelectedId(null);
          showToast('success', tr('annotation.deletedToast'));
          return data;
        });
      }, [runOp, selectedId, showToast]);

      var replyAnnotation = React.useCallback(function (annotation, body) {
        if (!annotation) return Promise.resolve(null);
        return runOp({ op: 'reply', id: annotation.id, body: body }).then(function (data) {
          if (data) showToast('success', tr('annotation.repliedToast'));
          return data;
        });
      }, [runOp, showToast]);

      var sendAnnotations = React.useCallback(function () {
        var currentDeck = deckRef.current;
        var openList = annotationsRef.current.filter(function (annotation) {
          return annotation && annotation.status === 'open';
        });
        if (!currentDeck || openList.length === 0) {
          showToast('error', tr('send.none'));
          return;
        }
        var text = buildSendText(
          openList,
          slidesRef.current,
          basename(currentDeck.path || pathRef.current || 'deck.pptx'),
          currentDeck.sha256 || '',
          tr,
        );
        var inputActions = inputActionsRef.current;
        var inserted = false;
        try {
          if (inputActions && typeof inputActions.captureInsertion === 'function' && typeof inputActions.insertText === 'function') {
            var span = inputActions.captureInsertion();
            inserted = inputActions.insertText(text, span) !== false;
          }
        } catch (error) {
          inserted = false;
        }
        if (inserted) {
          showToast('success', tr('send.inserted'));
          return;
        }
        function showManual() {
          toastIdRef.current += 1;
          setToast({ id: toastIdRef.current, kind: 'manual', text: tr('send.manual'), payload: text });
        }
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          try {
            navigator.clipboard.writeText(text).then(function () {
              showToast('success', tr('send.copied'));
            }, showManual);
          } catch (error) {
            showManual();
          }
        } else {
          showManual();
        }
      }, [showToast]);

      var closeToast = React.useCallback(function () {
        setToast(null);
      }, []);

      var handleSelectShape = React.useCallback(function (slideIndex, shape) {
        if (!Number.isInteger(slideIndex)) return;
        setCurrentPage(slideIndex + 1);
        if (!shape || !Number.isInteger(shape.shapeId)) {
          setSelectedShape(null);
          return;
        }
        setSelectedShape({ slideIndex: slideIndex, shapeId: shape.shapeId });
        setDrawerPref(true);
      }, []);

      function notifyDeckLoaded(deckValue) {
        var current = contentRef.current;
        if (current && typeof current.loaded === 'function' && deckValue) {
          try {
            current.loaded('deck-' + String(deckValue.sha256 || '').slice(0, 12));
          } catch (error) {
            /* ignore */
          }
        }
      }

      function adoptEditResponse(data, submittedPendingCount) {
        if (!data || !data.deck) return false;
        var nextDeck = data.deck;
        var nextSlides = Array.isArray(data.slides) ? data.slides : [];
        setDeckState({ status: 'ready', deck: nextDeck, slides: nextSlides, refreshing: false, error: null });
        setAnnotations(Array.isArray(data.annotations) ? data.annotations : EMPTY_LIST);
        var repair = data.annotationsRepair || EMPTY_MAP;
        var repaired = Number(repair.repaired) || 0;
        var orphaned = Number(repair.orphaned) || 0;
        if (repaired + orphaned > 0) {
          setRepairNotice({ key: String(nextDeck.sha256 || '') + '@' + Date.now(), repaired: repaired, orphaned: orphaned });
        }
        var nextHistory = extractHistory(data);
        if (nextHistory) setHistory(nextHistory);
        // 只清理本次提交的批次；保存期间新增的草稿必须保留。
        var currentPending = pendingOpsRef.current || EMPTY_LIST;
        var submitted = Number.isInteger(submittedPendingCount)
          ? Math.max(0, Math.min(submittedPendingCount, currentPending.length))
          : currentPending.length;
        var remaining = currentPending.slice(submitted);
        pendingOpsRef.current = remaining;
        setPendingOps(remaining);
        draftBaseShaRef.current = remaining.length > 0 ? (nextDeck.sha256 || null) : null;
        setConflict(null);
        autoSaveBlockedRef.current = false;
        var selection = selectedShapeRef.current;
        if (selection && !findShapeAt(nextSlides, selection.slideIndex, selection.shapeId)) {
          setSelectedShape(null);
        }
        setDraft(null);
        notifyDeckLoaded(nextDeck);
        return true;
      }

      function handleEditError(error) {
        if (!error) return;
        if (error.code === 'stale') {
          setConflict({
            code: 'stale',
            message: error.message || tr('edit.conflict'),
            currentSha: error.currentSha,
            conflictCopy: error.conflictCopy || null,
          });
          showToast('error', tr('edit.conflictTitle'));
          return;
        }
        showToast('error', editErrorText(error, t));
      }

      function saveAll(options) {
        var settings = options || {};
        if (!settings.auto) autoSaveBlockedRef.current = false;
        if (!editModeRef.current || busyRef.current) return Promise.resolve(false);
        if (conflictRef.current) {
          // 冲突未处理时禁止手动/自动保存，只允许 reload / discard。
          showToast('error', t('edit.conflictTitle'));
          return Promise.resolve(false);
        }
        if (inlineEditRef.current) return Promise.resolve(false);
        var currentDeck = deckRef.current;
        var sid = sessionIdRef.current;
        var deckPath = currentDeck && currentDeck.path ? currentDeck.path : pathRef.current;
        if (!currentDeck || !sid || !deckPath) return Promise.resolve(false);
        if (currentDeck.writeAllowed === false) {
          showToast('error', t('edit.previewOnly'));
          return Promise.resolve(false);
        }
        var extra = formDiffRef.current ? formDiffRef.current() || [] : [];
        var pendingCountAtStart = pendingOpsRef.current.length;
        var ops = pendingOpsRef.current.concat(extra);
        if (ops.length === 0) {
          if (!settings.silent) showToast('success', t('edit.noChanges'));
          if (settings.onSuccess) settings.onSuccess();
          return Promise.resolve(true);
        }
        if (ops.length > 100) {
          showToast('error', t('edit.failed', { message: '> 100 ops' }));
          return Promise.resolve(false);
        }
        // 草稿生命周期内固定使用首次草稿时的 baseSha，避免静默刷新后 base 漂移。
        var baseSha = draftBaseShaRef.current && draftBaseShaRef.current.length
          ? draftBaseShaRef.current
          : currentDeck.sha256;
        busyRef.current = true;
        setSaving(true);
        return jsonFetch('edit', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            sessionId: sid,
            path: deckPath,
            baseSha: baseSha,
            ops: ops,
          }),
        }).then(function (result) {
          if (!result.ok || !result.data || result.data.ok !== true) throw normalizeError(result);
          if (!adoptEditResponse(result.data, pendingCountAtStart)) {
            throw normalizeError({ code: 'edit-failed', message: t('edit.unknown') });
          }
          setLastSavedAt(Date.now());
          if (!settings.silent) showToast('success', t('edit.saved'));
          if (settings.onSuccess) settings.onSuccess();
          return true;
        }).catch(function (error) {
          if (settings.auto) autoSaveBlockedRef.current = true;
          handleEditError(error && error.code ? error : normalizeError(error));
          return false;
        }).then(function (value) {
          busyRef.current = false;
          setSaving(false);
          return value;
        });
      }
      saveAllRef.current = saveAll;

      function undoRedo(kind) {
        if (busyRef.current || !editModeRef.current) return;
        if (conflictRef.current) {
          showToast('error', t('edit.conflictTitle'));
          return;
        }
        if (pendingOpsRef.current.length > 0) {
          showToast('error', t('edit.undoBlocked'));
          return;
        }
        var currentDeck = deckRef.current;
        var sid = sessionIdRef.current;
        var deckPath = currentDeck && currentDeck.path ? currentDeck.path : pathRef.current;
        if (!currentDeck || !sid || !deckPath) return;
        busyRef.current = true;
        setSaving(true);
        jsonFetch(kind, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: sid, path: deckPath }),
        }).then(function (result) {
          if (!result.ok || !result.data || result.data.ok !== true) throw normalizeError(result);
          if (!adoptEditResponse(result.data)) {
            throw normalizeError({ code: 'edit-failed', message: t('edit.unknown') });
          }
          showToast('success', kind === 'undo' ? t('edit.undoDone') : t('edit.redoDone'));
        }).catch(function (error) {
          handleEditError(error && error.code ? error : normalizeError(error));
        }).then(function () {
          busyRef.current = false;
          setSaving(false);
        });
      }

      function runPageOp(op) {
        if (busyRef.current || !editModeRef.current || !op) return;
        if (conflictRef.current) {
          showToast('error', t('edit.conflictTitle'));
          return;
        }
        if (pendingOpsRef.current.length > 0) {
          showToast('error', t('edit.pageOpBlocked'));
          return;
        }
        var currentDeck = deckRef.current;
        var sid = sessionIdRef.current;
        var deckPath = currentDeck && currentDeck.path ? currentDeck.path : pathRef.current;
        if (!currentDeck || !sid || !deckPath) return;
        if (currentDeck.writeAllowed === false) {
          showToast('error', t('edit.previewOnly'));
          return;
        }
        busyRef.current = true;
        setSaving(true);
        var pageBefore = currentPage;
        jsonFetch('edit', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            sessionId: sid,
            path: deckPath,
            baseSha: currentDeck.sha256,
            ops: [op],
          }),
        }).then(function (result) {
          if (!result.ok || !result.data || result.data.ok !== true) throw normalizeError(result);
          if (!adoptEditResponse(result.data)) {
            throw normalizeError({ code: 'edit-failed', message: t('edit.unknown') });
          }
          var nextPage = pageBefore;
          if (op.op === 'duplicateSlide' || op.op === 'insertSlide') nextPage = pageBefore + 1;
          else if (op.op === 'moveSlide' && Number.isInteger(op.toIndex)) nextPage = op.toIndex + 1;
          setSelectedShape(null);
          setCurrentPage(nextPage);
          showToast('success', t('edit.pageOpDone'));
        }).catch(function (error) {
          handleEditError(error && error.code ? error : normalizeError(error));
        }).then(function () {
          busyRef.current = false;
          setSaving(false);
        });
      }

      function appendPendingOps(ops) {
        if (!Array.isArray(ops) || ops.length === 0) return;
        if (busyRef.current || conflictRef.current) return;
        var merged = mergePendingOps(pendingOpsRef.current, ops);
        pendingOpsRef.current = merged;
        autoSaveBlockedRef.current = false;
        setPendingOps(merged);
      }

      function handleInlineStart(slideIndex, shape) {
        if (!editModeRef.current || busyRef.current || conflictRef.current || !shape || !shapeCanInlineEdit(shape)) return;
        setSelectedShape({ slideIndex: slideIndex, shapeId: shape.shapeId });
        setDrawerPref(true);
        var text = shapeFullText(shape);
        setInlineEdit({
          slideIndex: slideIndex,
          shapeId: shape.shapeId,
          text: text,
          original: text,
        });
      }

      function handleInlineChange(value) {
        setInlineEdit(function (previous) {
          return previous ? Object.assign({}, previous, { text: value }) : previous;
        });
      }

      function handleInlineCommit() {
        var current = inlineEditRef.current;
        if (!current) return;
        setInlineEdit(null);
        var text = String(current.text === undefined || current.text === null ? '' : current.text);
        if (text === current.original) return;
        appendPendingOps([{ op: 'setText', slideIndex: current.slideIndex, shapeId: current.shapeId, text: text }]);
        setResetNonce(function (value) {
          return value + 1;
        });
      }

      function handleInlineCancel() {
        setInlineEdit(null);
      }

      function handleShapeBoxCommit(box, mode) {
        if (!box || !editModeRef.current || busyRef.current || conflictRef.current) return;
        var selection = selectedShapeRef.current;
        if (!selection) return;
        var current = findViewShape(viewSlidesRef.current, selection.slideIndex, selection.shapeId);
        if (!current) return;
        var shapeOp = { op: 'setShapeBox', slideIndex: selection.slideIndex, shapeId: selection.shapeId };
        var changed = false;
        ['left', 'top', 'width', 'height'].forEach(function (field) {
          var value = Math.round(Number(box[field]));
          if (!Number.isFinite(value) || value < 0) return;
          if (value !== Math.round(Number(current[field]))) {
            shapeOp[field] = value;
            changed = true;
          }
        });
        if (!changed) return;
        if (shapeOp.width !== undefined && shapeOp.width < MIN_SHAPE_EMU) shapeOp.width = MIN_SHAPE_EMU;
        if (shapeOp.height !== undefined && shapeOp.height < MIN_SHAPE_EMU) shapeOp.height = MIN_SHAPE_EMU;
        appendPendingOps([shapeOp]);
        setResetNonce(function (value) {
          return value + 1;
        });
      }

      function handleGestureState(active) {
        setCanvasGesture(!!active);
      }

      function toggleAutosave() {
        setAutosave(function (previous) {
          var next = !previous;
          writeAutosavePref(next);
          return next;
        });
      }

      function openNative() {
        if (nativeBusy || busyRef.current) return;
        var currentDeck = deckRef.current;
        var sid = sessionIdRef.current;
        var deckPath = currentDeck && currentDeck.path ? currentDeck.path : pathRef.current;
        if (!currentDeck || !sid || !deckPath) return;
        if (currentDeck.writeAllowed === false) {
          showToast('error', t('edit.previewOnly'));
          return;
        }
        function post() {
          setNativeBusy(true);
          busyRef.current = true;
          jsonFetch('open-native', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId: sid, path: deckPath }),
          }).then(function (result) {
            if (!result.ok || !result.data || result.data.ok !== true) throw normalizeError(result);
            showToast('success', currentDeck.sourceFormat === 'drawio' ? t('toolbar.openDrawioDone') : t('edit.openNativeDone'));
          }).catch(function (error) {
            var normalized = error && error.code ? error : normalizeError(error);
            if (normalized.code === 'http-404' || normalized.code === 'not-implemented') {
              showToast('error', t('edit.openNativeUnsupported'));
            } else if (currentDeck.sourceFormat === 'drawio') {
              showToast('error', t('toolbar.openNativeFailed', { message: normalized.message || t('edit.unknown') }));
            } else {
              showToast('error', t('edit.openNativeFailed', { message: normalized.message || t('edit.unknown') }));
            }
          }).then(function () {
            busyRef.current = false;
            setNativeBusy(false);
          });
        }
        var extra = formDiffRef.current ? formDiffRef.current() || [] : [];
        var ops = pendingOpsRef.current.concat(extra);
        if (ops.length > 0) {
          saveAll({ silent: true, onSuccess: post });
        } else {
          post();
        }
      }

      function updateSourceEditor(patch) {
        setSourceEditor(function (previous) {
          if (!previous) return previous;
          return Object.assign({}, previous, patch);
        });
      }

      function sourceFailureText(normalized) {
        if (normalized.code === 'source-not-editable' || normalized.code === 'not-source-editable' || normalized.code === 'http-404' || normalized.code === 'not-implemented') {
          return t('source.notSupported');
        }
        return t('source.saveFailed', { message: normalized.message || t('edit.unknown') });
      }

      function fetchSourceText() {
        var currentDeck = deckRef.current;
        var sid = sessionIdRef.current;
        var deckPath = currentDeck && currentDeck.path ? currentDeck.path : pathRef.current;
        if (!currentDeck || !sid || !deckPath) return;
        updateSourceEditor({ loading: true, error: null });
        jsonFetch('source?sessionId=' + encodeURIComponent(sid) + '&path=' + encodeURIComponent(deckPath))
          .then(function (result) {
            if (!result.ok || !result.data || result.data.ok !== true) throw normalizeError(result);
            var data = result.data;
            var text = typeof data.text === 'string' ? data.text : '';
            updateSourceEditor({
              text: text,
              original: text,
              sha256: typeof data.sha256 === 'string' ? data.sha256 : '',
              loading: false,
              error: null,
            });
          })
          .catch(function (error) {
            var normalized = error && error.code ? error : normalizeError(error);
            updateSourceEditor({ loading: false, error: { code: normalized.code, message: sourceFailureText(normalized) } });
          });
      }

      function openSourceEditor() {
        var editor = sourceEditorRef.current;
        if (editor && editor.open) return;
        if (!(deckRef.current && deckRef.current.sourceFormat === 'mermaid')) return;
        setSourceEditor({ open: true, text: '', original: '', loading: true, saving: false, error: null, confirmClose: false });
        fetchSourceText();
      }

      function closeSourceEditor() {
        var editor = sourceEditorRef.current;
        if (!editor || !editor.open || editor.saving) return;
        if ((editor.text || '') !== (editor.original || '')) {
          updateSourceEditor({ confirmClose: true });
          return;
        }
        setSourceEditor(null);
      }

      function discardSourceEditor() {
        setSourceEditor(null);
      }

      function cancelSourceClose() {
        updateSourceEditor({ confirmClose: false });
      }

      function saveSource() {
        var editor = sourceEditorRef.current;
        if (!editor || !editor.open || editor.saving || editor.loading) return;
        var currentDeck = deckRef.current;
        var sid = sessionIdRef.current;
        var deckPath = currentDeck && currentDeck.path ? currentDeck.path : pathRef.current;
        if (!currentDeck || !sid || !deckPath) return;
        var text = String(editor.text === undefined || editor.text === null ? '' : editor.text);
        var baseSha = editor.sha256 && editor.sha256.length ? editor.sha256 : currentDeck.sha256;
        updateSourceEditor({ saving: true, error: null });
        jsonFetch('source', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            sessionId: sid,
            path: deckPath,
            baseSha: baseSha,
            text: text,
          }),
        }).then(function (result) {
          if (!result.ok || !result.data || result.data.ok !== true) throw normalizeError(result);
          if (!adoptEditResponse(result.data)) {
            throw normalizeError({ code: 'source-failed', message: t('edit.unknown') });
          }
          setSourceEditor(null);
          showToast('success', t('source.saved'));
        }).catch(function (error) {
          var normalized = error && error.code ? error : normalizeError(error);
          updateSourceEditor({
            saving: false,
            error: {
              code: normalized.code,
              message: normalized.code === 'stale'
                ? (normalized.message || t('source.stale'))
                : sourceFailureText(normalized),
            },
          });
          if (normalized.code === 'stale') showToast('error', t('source.staleTitle'));
          else showToast('error', sourceFailureText(normalized));
        });
      }
      sourceSaveRef.current = saveSource;

      function drawioErrorMessage(normalized, phase) {
        if (normalized.code === 'stale') return t('drawio.stale');
        if (phase === 'load' || normalized.code === 'not-source-editable' || normalized.code === 'http-404') {
          return t('drawio.loadFailed', { message: normalized.message || t('edit.unknown') });
        }
        return t('drawio.saveFailed', { message: normalized.message || t('edit.unknown') });
      }

      function postDrawioLoad(xml) {
        var frame = drawioFrameRef.current;
        var currentDeck = deckRef.current;
        if (!frame || !frame.contentWindow || typeof xml !== 'string') return;
        try {
          frame.contentWindow.postMessage(JSON.stringify({
            action: 'load',
            xml: xml,
            autosave: 0,
            title: currentDeck && currentDeck.path ? basename(currentDeck.path) : 'diagram.drawio',
          }), '*');
        } catch (error) {
          /* ignore */
        }
      }

      function fetchDrawioSource() {
        var currentDeck = deckRef.current;
        var sid = sessionIdRef.current;
        var deckPath = currentDeck && currentDeck.path ? currentDeck.path : pathRef.current;
        if (!currentDeck || !sid || !deckPath) return;
        var seq = drawioFetchSeqRef.current + 1;
        drawioFetchSeqRef.current = seq;
        setDrawioState(function (previous) {
          return Object.assign({}, previous || {}, { status: 'loading', error: null });
        });
        jsonFetch('source?sessionId=' + encodeURIComponent(sid) + '&path=' + encodeURIComponent(deckPath))
          .then(function (result) {
            if (seq !== drawioFetchSeqRef.current) return;
            if (!result.ok || !result.data || result.data.ok !== true) throw normalizeError(result);
            var data = result.data;
            var text = typeof data.text === 'string' ? data.text : '';
            setDrawioState({
              status: 'ready',
              xml: text,
              baseSha: typeof data.sha256 === 'string' ? data.sha256 : '',
              error: null,
              savedAt: null,
            });
            if (drawioInitRef.current) postDrawioLoad(text);
          })
          .catch(function (error) {
            if (seq !== drawioFetchSeqRef.current) return;
            var normalized = error && error.code ? error : normalizeError(error);
            setDrawioState(function (previous) {
              return Object.assign({}, previous || {}, {
                status: 'error',
                error: { code: normalized.code, message: drawioErrorMessage(normalized, 'load') },
              });
            });
          });
      }

      function saveDrawioSource(xml) {
        var state = drawioStateRef.current;
        if (typeof xml !== 'string' || !state || state.status === 'saving') return;
        var currentDeck = deckRef.current;
        var sid = sessionIdRef.current;
        var deckPath = currentDeck && currentDeck.path ? currentDeck.path : pathRef.current;
        if (!currentDeck || !sid || !deckPath) return;
        var baseSha = state.baseSha && state.baseSha.length ? state.baseSha : currentDeck.sha256;
        setDrawioState(function (previous) {
          return Object.assign({}, previous || {}, { status: 'saving', error: null, xml: xml });
        });
        jsonFetch('source', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            sessionId: sid,
            path: deckPath,
            baseSha: baseSha,
            text: xml,
            render: false,
          }),
        }).then(function (result) {
          if (!result.ok || !result.data || result.data.ok !== true) throw normalizeError(result);
          var data = result.data;
          var newSha = data.source && data.source.newSha
            ? data.source.newSha
            : (typeof data.sha256 === 'string' ? data.sha256 : '');
          setDrawioState(function (previous) {
            return Object.assign({}, previous || {}, {
              status: 'saved',
              xml: xml,
              baseSha: newSha && newSha.length ? newSha : baseSha,
              savedAt: Date.now(),
              error: null,
            });
          });
          var frame = drawioFrameRef.current;
          if (frame && frame.contentWindow) {
            try {
              frame.contentWindow.postMessage(JSON.stringify({ action: 'status', message: t('drawio.saved') }), '*');
            } catch (error) {
              /* ignore */
            }
          }
        }).catch(function (error) {
          var normalized = error && error.code ? error : normalizeError(error);
          setDrawioState(function (previous) {
            return Object.assign({}, previous || {}, {
              status: 'error',
              error: { code: normalized.code, message: drawioErrorMessage(normalized, 'save') },
            });
          });
        });
      }

      function reloadDrawio() {
        fetchDrawioSource();
      }

      function onDrawioFrameLoad() {
        drawioInitRef.current = false;
      }

      function toggleDrawioPanel() {
        setDrawioPanelOpen(function (previous) {
          return !previous;
        });
      }

      function postDrawioSelect(cellIds) {
        var frame = drawioFrameRef.current;
        var ids = Array.isArray(cellIds)
          ? cellIds.filter(function (id) { return typeof id === 'string' && id; })
          : typeof cellIds === 'string' && cellIds ? [cellIds] : [];
        if (!frame || !frame.contentWindow || ids.length === 0) return;
        try {
          frame.contentWindow.postMessage(JSON.stringify({ action: 'dsh-select', cellId: ids[0], cellIds: ids }), '*');
        } catch (error) {
          /* ignore */
        }
      }

      function selectDrawioAnnotation(annotation) {
        if (!annotation) return;
        var anchor = annotation.anchor || {};
        setDrawioSelectedAnnotationId(annotation.id);
        var ids = Array.isArray(anchor.cellIds) ? anchor.cellIds : typeof anchor.cellId === 'string' && anchor.cellId ? [anchor.cellId] : [];
        if (ids.length > 0) postDrawioSelect(ids);
      }

      function addDrawioAnnotation() {
        var selected = drawioSelectionRef.current || EMPTY_LIST;
        var cells = selected.filter(function (cell) { return cell && typeof cell.id === 'string' && cell.id; });
        var body = String(drawioDraft || '').trim();
        if (!body) {
          showToast('error', t('compose.empty'));
          return;
        }
        if (busyRef.current) return;
        var pageIndex = cells.length && Number.isInteger(cells[0].pageIndex) && cells[0].pageIndex > 0 ? cells[0].pageIndex : 1;
        var payload = {
          op: 'create',
          pageIndex: pageIndex,
          body: body,
        };
        if (cells.length > 0) {
          payload.cellIds = cells.map(function (cell) { return cell.id; });
          payload.cellLabels = cells.map(function (cell) { return typeof cell.label === 'string' ? cell.label.slice(0, 300) : ''; });
          payload.cellId = cells[0].id;
          payload.cellLabel = typeof cells[0].label === 'string' ? cells[0].label.slice(0, 300) : '';
        } else {
          payload.scope = 'diagram';
        }
        runOp(payload).then(function (data) {
          if (!data) return;
          setDrawioDraft('');
          var list = Array.isArray(data.annotations) ? data.annotations : [];
          for (var index = list.length - 1; index >= 0; index -= 1) {
            var candidate = list[index];
            if (candidate && candidate.format === 'drawio') {
              var anchor = candidate.anchor || {};
              var candidateIds = Array.isArray(anchor.cellIds) ? anchor.cellIds : [anchor.cellId];
              if (cells.length === 0 ? anchor.kind === 'drawio-diagram' : candidateIds[0] === cells[0].id) {
                setDrawioSelectedAnnotationId(candidate.id);
                break;
              }
            }
          }
          showToast('success', t('drawio.annotationSaved'));
        });
      }

      function pushTextToComposer(text) {
        var inputActions = inputActionsRef.current;
        var value = String(text || '');
        if (!value) return;
        var inserted = false;
        try {
          if (inputActions && typeof inputActions.captureInsertion === 'function' && typeof inputActions.insertText === 'function') {
            var span = inputActions.captureInsertion();
            inserted = inputActions.insertText(value, span) !== false;
          }
        } catch (error) {
          inserted = false;
        }
        if (inserted) {
          showToast('success', t('send.inserted'));
          return;
        }
        function showManual() {
          toastIdRef.current += 1;
          setToast({ id: toastIdRef.current, kind: 'manual', text: t('send.manual'), payload: value });
        }
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          try {
            navigator.clipboard.writeText(value).then(function () {
              showToast('success', t('send.copied'));
            }, showManual);
          } catch (error) {
            showManual();
          }
        } else {
          showManual();
        }
      }

      function sendDrawioAnnotations() {
        var list = annotationsRef.current.filter(function (annotation) {
          return annotation && annotation.format === 'drawio' && annotation.status === 'open';
        });
        var currentDeck = deckRef.current;
        if (!currentDeck || list.length === 0) {
          showToast('error', t('send.none'));
          return;
        }
        var name = basename(currentDeck.path || pathRef.current || 'diagram.drawio');
        var lines = [t('send.drawioHeader', { name: name, count: list.length })];
        list.forEach(function (annotation, index) {
          var anchor = annotation.anchor || {};
          var label = typeof anchor.cellLabel === 'string' && anchor.cellLabel ? anchor.cellLabel : t('drawio.noLabel');
          var body = String(annotation.body || '').replace(/\s*\n\s*/g, ' ').trim();
          var cellCount = Array.isArray(anchor.cellIds) ? anchor.cellIds.length : anchor.cellId ? 1 : 0;
          lines.push(t('send.drawioLine', {
            index: index + 1,
            label: label || t('drawio.wholeDiagram'),
            cellId: cellCount > 1 ? t('drawio.groupCount', { count: cellCount }) : String(anchor.cellId || t('drawio.wholeDiagram')),
            body: body,
          }));
        });
        lines.push('');
        lines.push(t('send.footer'));
        pushTextToComposer(lines.join('\n'));
      }

      function fetchHtmlArtifactUrl() {
        var currentDeck = deckRef.current;
        var sid = sessionIdRef.current;
        var deckPath = currentDeck && currentDeck.path ? currentDeck.path : pathRef.current;
        if (!currentDeck || !sid || !deckPath) return;
        setHtmlState(function (previous) {
          return Object.assign({}, previous || {}, { status: 'loading', error: null });
        });
        jsonFetch('artifact-url?sessionId=' + encodeURIComponent(sid) + '&path=' + encodeURIComponent(deckPath))
          .then(function (result) {
            if (!result.ok || !result.data || result.data.ok !== true) throw normalizeError(result);
            var data = result.data;
            setHtmlState({
              status: 'loading',
              url: typeof data.url === 'string' ? data.url : '',
              title: typeof data.title === 'string' ? data.title : '',
              error: null,
              scrollY: 0,
              scrollHeight: 0,
              viewportWidth: 0,
              viewportHeight: 0,
            });
          })
          .catch(function (error) {
            var normalized = error && error.code ? error : normalizeError(error);
            setHtmlState(function (previous) {
              return Object.assign({}, previous || {}, {
                status: 'error',
                error: { code: normalized.code, message: t('html.loadFailed', { message: normalized.message || t('edit.unknown') }) },
              });
            });
          });
      }

      function postHtmlMessage(payload) {
        var frame = htmlFrameRef.current;
        if (!frame || !frame.contentWindow) return;
        try {
          frame.contentWindow.postMessage(JSON.stringify(payload), '*');
        } catch (error) {
          /* ignore */
        }
      }

      function postHtmlAnnotate() {
        postHtmlMessage({ action: 'dsh-html-annotate', on: !!htmlAnnotateRef.current });
      }

      function postHtmlScrollTo(yNorm) {
        var value = Number(yNorm);
        postHtmlMessage({ action: 'dsh-html-scroll-to', yNorm: Number.isFinite(value) ? value : 0 });
      }

      function toggleHtmlAnnotate() {
        setHtmlAnnotate(function (previous) {
          return !previous;
        });
      }

      function toggleHtmlPanel() {
        setHtmlPanelOpen(function (previous) {
          return !previous;
        });
      }

      function htmlAnchorTarget(anchor) {
        var target = anchor || {};
        if (typeof target.textQuote === 'string' && target.textQuote) return target.textQuote.slice(0, 120);
        if (typeof target.selector === 'string' && target.selector) return target.selector;
        return t('html.wholePage');
      }

      function selectHtmlAnnotation(annotation) {
        if (!annotation) return;
        var anchor = annotation.anchor || {};
        setHtmlSelectedAnnotationId(annotation.id);
        postHtmlScrollTo(anchor.yNorm);
      }

      function addHtmlAnnotation() {
        var body = String(htmlDraftBody || '').trim();
        if (!body) {
          showToast('error', t('compose.empty'));
          return;
        }
        if (busyRef.current) return;
        var draft = htmlDraft || null;
        var current = htmlStateRef.current || {};
        var scrollHeight = Number(current.scrollHeight) || 0;
        var scrollY = draft ? Number(draft.scrollY) || Number(current.scrollY) || 0 : Number(current.scrollY) || 0;
        var payload = {
          op: 'create',
          pageIndex: 0,
          body: body,
          selector: draft && typeof draft.selector === 'string' ? draft.selector : '',
          textQuote: draft && typeof draft.textQuote === 'string' ? draft.textQuote : '',
          tag: draft && typeof draft.tag === 'string' ? draft.tag : '',
          xNorm: draft ? draft.xNorm : 0.5,
          yNorm: draft
            ? draft.yNorm
            : scrollHeight > 0
              ? Math.min(1, Math.max(0, (scrollY + (Number(current.viewportHeight) || 0) / 2) / scrollHeight))
              : 0.5,
          scrollY: scrollY,
        };
        runOp(payload).then(function (data) {
          if (!data) return;
          setHtmlDraft(null);
          setHtmlDraftBody('');
          var list = Array.isArray(data.annotations) ? data.annotations : [];
          for (var index = list.length - 1; index >= 0; index -= 1) {
            var candidate = list[index];
            if (candidate && candidate.format === 'html') {
              setHtmlSelectedAnnotationId(candidate.id);
              break;
            }
          }
          showToast('success', t('html.annotationSaved'));
        });
      }

      function sendHtmlAnnotations() {
        var list = annotationsRef.current.filter(function (annotation) {
          return annotation && annotation.format === 'html' && annotation.status === 'open';
        });
        var currentDeck = deckRef.current;
        if (!currentDeck || list.length === 0) {
          showToast('error', t('send.none'));
          return;
        }
        var name = basename(currentDeck.path || pathRef.current || 'report.html');
        var lines = [t('send.htmlHeader', { name: name, count: list.length })];
        list.forEach(function (annotation, index) {
          var anchor = annotation.anchor || {};
          lines.push(t('send.htmlLine', {
            index: index + 1,
            target: htmlAnchorTarget(anchor),
            body: String(annotation.body || '').replace(/\s*\n\s*/g, ' ').trim(),
          }));
        });
        lines.push('');
        lines.push(t('send.footer'));
        pushTextToComposer(lines.join('\n'));
      }

      function clearDraft() {
        pendingOpsRef.current = EMPTY_LIST;
        setPendingOps(EMPTY_LIST);
        setConflict(null);
        autoSaveBlockedRef.current = false;
        setResetNonce(function (value) {
          return value + 1;
        });
        showToast('success', t('edit.draftCleared'));
      }

      function reloadDiscardingDraft() {
        setConflict(null);
        pendingOpsRef.current = EMPTY_LIST;
        setPendingOps(EMPTY_LIST);
        setSelectedShape(null);
        setInlineEdit(null);
        autoSaveBlockedRef.current = false;
        retryDeck();
      }

      function doExitEdit() {
        setEditMode(false);
        setSelectedShape(null);
        setInlineEdit(null);
        setCanvasGesture(false);
        pendingOpsRef.current = EMPTY_LIST;
        setPendingOps(EMPTY_LIST);
        setConflict(null);
        setDirtyDialog(null);
        autoSaveBlockedRef.current = false;
      }

      function requestExitEdit(followUp) {
        var formOps = formDiffRef.current ? formDiffRef.current() || [] : [];
        var total = pendingOpsRef.current.length + formOps.length;
        if (total > 0) {
          setDirtyDialog({ count: total, followUp: followUp || null });
          return;
        }
        doExitEdit();
        if (typeof followUp === 'function') followUp();
      }
      requestExitRef.current = requestExitEdit;

      function enterEditMode() {
        if (editModeRef.current) return;
        var currentDeck = deckRef.current;
        if (!currentDeck) return;
        if (currentDeck.format === 'pdf' || currentDeck.editable === false) {
          showToast('error', t('edit.pdfReadonly'));
          return;
        }
        if (currentDeck.writeAllowed === false) {
          showToast('error', t('edit.previewOnly'));
          return;
        }
        if (draft && String(draft.body || '').trim()) {
          showToast('error', t('edit.finishAnnotation'));
          return;
        }
        setAnnotate(false);
        setDraft(null);
        setSelectedShape(null);
        setPendingOps(EMPTY_LIST);
        setConflict(null);
        setEditMode(true);
        setDrawerPref(true);
      }

      function toggleEditMode() {
        if (editModeRef.current) requestExitEdit(null);
        else enterEditMode();
      }

      function toggleAnnotateMode() {
        if (annotate) {
          setAnnotate(false);
          setDraft(null);
          return;
        }
        if (editModeRef.current) {
          requestExitEdit(function () {
            setAnnotate(true);
          });
          return;
        }
        setAnnotate(true);
      }

      function dirtySaveAndExit() {
        var followUp = dirtyDialog && typeof dirtyDialog.followUp === 'function' ? dirtyDialog.followUp : null;
        saveAll({
          onSuccess: function () {
            doExitEdit();
            if (followUp) followUp();
          },
        });
      }

      function dirtyDiscardAndExit() {
        var followUp = dirtyDialog && typeof dirtyDialog.followUp === 'function' ? dirtyDialog.followUp : null;
        doExitEdit();
        if (followUp) followUp();
      }

      function dirtyCancel() {
        setDirtyDialog(null);
      }

      // ---- 渲染 ----
      var repairKey = repairNotice ? repairNotice.key : null;
      var repairVisible = !!repairNotice && (repairNotice.repaired + repairNotice.orphaned > 0) &&
        !(repairKey && dismissedRepairs[repairKey]);
      var refreshError = deckState.error;
      var refreshErrorKey = refreshError ? String(refreshError.code) + ':' + String(refreshError.message) : null;
      var refreshErrorVisible = !!refreshError && !!deck && dismissedRefresh !== refreshErrorKey;

      var loadingView = h('div', { className: 'wb-root', 'data-ppt-workbench': 'body', 'data-state': 'loading', ref: rootRef },
        h('div', { className: 'wb-center' },
          h('div', { className: 'wb-spinner', 'aria-hidden': true }),
          h('div', { className: 'wb-centerTitle' }, t('status.loading')),
          h('div', { className: 'wb-centerText' }, t('status.loadingHint')),
          h('div', { className: 'wb-skeleton', 'aria-hidden': true }),
          h('div', { className: 'wb-skeleton', 'aria-hidden': true, style: { width: 'min(340px, 100%)' } }),
          h('div', { className: 'wb-path' }, path || String(props.resourceAddress || '')),
        ),
      );

      if (deckState.status !== 'ready' || !deck) {
        if (deckState.status === 'error' && deckState.error) {
          var loadError = deckState.error;
          return h('div', { className: 'wb-root', 'data-ppt-workbench': 'body', 'data-state': 'error', ref: rootRef },
            h('div', { className: 'wb-center' },
              h('div', { className: 'wb-errorIcon', 'aria-hidden': true }, '!'),
              h('div', { className: 'wb-centerTitle' }, t('error.title')),
              h('div', { className: 'wb-centerText' }, loadError.message || t('error.generic')),
              h('div', { className: 'wb-centerHint' }, errorHint(loadError, t)),
              h('div', { className: 'wb-row', style: { justifyContent: 'center' } },
                h('span', { className: 'wb-code' }, t('error.code', { code: loadError.code || 'unknown' })),
              ),
              h('button', {
                type: 'button',
                className: 'wb-btn wb-primary',
                onClick: retryDeck,
              }, t('error.retry')),
              h('div', { className: 'wb-path' }, path || ''),
            ),
          );
        }
        return loadingView;
      }

      if (isDrawio) {
        var drawioAnnotationList = annotations.filter(function (annotation) {
          return annotation && annotation.format === 'drawio';
        });
        var drawioOpenCount = drawioAnnotationList.filter(function (annotation) {
          return annotation.status === 'open';
        }).length;
        drawioAnnotationList = drawioAnnotationList.slice().sort(function (a, b) {
          if ((a.status === 'open') !== (b.status === 'open')) return a.status === 'open' ? -1 : 1;
          return 0;
        });
        var drawioSelectedCells = (drawioSelection || []).filter(function (cell) { return cell && typeof cell.id === 'string'; });
        var drawioSelectedCell = drawioSelectedCells.length ? drawioSelectedCells[0] : null;
        var drawioSelectionLabel = drawioSelectedCells.length > 1
          ? t('drawio.selectedMany', { count: drawioSelectedCells.length, label: (drawioSelectedCells[0].label || drawioSelectedCells[0].id || '') })
          : drawioSelectedCell
            ? t('drawio.selected', { label: typeof drawioSelectedCell.label === 'string' && drawioSelectedCell.label ? drawioSelectedCell.label : (drawioSelectedCell.id || t('drawio.noLabel')) })
            : t('drawio.wholeDiagram');
        var drawioStatusText = '';
        if (drawioState) {
          if (drawioState.status === 'loading') drawioStatusText = t('drawio.loading');
          else if (drawioState.status === 'saving') drawioStatusText = t('drawio.saving');
          else if (drawioState.status === 'saved' && drawioState.savedAt) {
            drawioStatusText = t('drawio.savedAt', { time: formatClock(drawioState.savedAt) });
          }
        }
        var drawioError = drawioState && drawioState.error ? drawioState.error : null;
        return h('div', {
          className: 'wb-root wb-drawioView',
          'data-ppt-workbench': 'body',
          'data-state': 'ready',
          'data-source-format': 'drawio',
          ref: rootRef,
        },
          h('div', { className: 'wb-drawioBar', role: 'toolbar', 'aria-label': t('toolbar.drawioBadge') },
            h('span', { className: 'wb-chip', 'data-info': 'true', 'data-pdf-badge': '', 'data-source-format': 'drawio', title: t('drawio.editorBadge') },
              t('drawio.editorBadge')),
            h('span', { className: 'wb-drawioName', title: deck.path || '' }, deck.path ? basename(deck.path) : ''),
            h('span', { className: 'wb-spacer' }),
            drawioStatusText
              ? h('span', { className: 'wb-saveStatus', 'aria-live': 'polite', 'data-drawio-status': drawioState.status }, drawioStatusText)
              : null,
            h('button', {
              type: 'button',
              className: 'wb-btn',
              'aria-pressed': drawioPanelOpen ? 'true' : 'false',
              'aria-label': t('drawio.annotate'),
              title: t('drawio.annotateTitle'),
              onClick: toggleDrawioPanel,
            },
              h('span', { 'aria-hidden': true }, '✎'),
              h('span', null, t('drawio.annotate')),
              drawioOpenCount > 0 ? h('span', { className: 'wb-tabCount' }, String(drawioOpenCount)) : null),
            h('button', {
              type: 'button',
              className: 'wb-btn wb-icon',
              'aria-label': t('drawio.reload'),
              title: t('drawio.reload'),
              onClick: reloadDrawio,
            }, h('span', { 'aria-hidden': true }, '⟳')),
          ),
          drawioError
            ? h('div', { className: 'wb-drawioError', role: 'status', 'data-drawio-error': drawioError.code || 'error' },
              h('span', null, drawioError.message || t('drawio.saveFailed', { message: '' })),
              h('button', { type: 'button', className: 'wb-linkBtn', onClick: reloadDrawio }, t('drawio.reload')),
            )
            : null,
          h('iframe', {
            className: 'wb-drawioFrame',
            ref: drawioFrameRef,
            src: drawioSrc || undefined,
            title: t('drawio.editorTitle'),
            onLoad: onDrawioFrameLoad,
          }),
          drawioPanelOpen
            ? h('div', { className: 'wb-drawioPanel', 'data-drawio-panel': '' },
              h('div', { className: 'wb-drawioPanelHead' },
                h('span', { className: 'wb-drawerTitle' }, t('drawio.panelTitle')),
                drawioOpenCount > 0 ? h('span', { className: 'wb-chip', 'data-info': 'true' }, String(drawioOpenCount)) : null,
                h('span', { className: 'wb-spacer' }),
                h('button', {
                  type: 'button',
                  className: 'wb-btn wb-icon',
                  'aria-label': t('drawio.panelClose'),
                  title: t('drawio.panelClose'),
                  onClick: toggleDrawioPanel,
                }, h('span', { 'aria-hidden': true }, '×')),
              ),
              h('div', { className: 'wb-drawioPanelBody' },
                h('div', { className: 'wb-drawioSelection', 'data-drawio-selection': '' },
                  h('div', null, drawioSelectionLabel),
                  drawioSelectedCells.length > 1
                    ? h('div', { className: 'wb-meta' }, drawioSelectedCells.slice(0, 6).map(function (cell) { return cell.label || cell.id; }).join(' · '))
                    : null),
                h('textarea', {
                  className: 'wb-textarea',
                  value: drawioDraft,
                  rows: 2,
                  disabled: !!busyOp,
                  placeholder: t('drawio.placeholder'),
                  'aria-label': t('drawio.panelTitle'),
                  onChange: function (event) {
                    setDrawioDraft(event.target.value);
                  },
                }),
                h('div', { className: 'wb-row', style: { justifyContent: 'flex-end' } },
                  h('button', {
                    type: 'button',
                    className: 'wb-btn wb-primary',
                    disabled: !String(drawioDraft || '').trim() || !!busyOp,
                    onClick: addDrawioAnnotation,
                  }, busyOp ? t('drawio.adding') : t('drawio.add')),
                ),
                h('div', { className: 'wb-sourceMeta' }, t('drawio.selectHint')),
                drawioAnnotationList.length === 0
                  ? h('div', { className: 'wb-empty' }, t('drawio.empty'))
                  : drawioAnnotationList.map(function (annotation) {
                    var anchor = annotation.anchor || {};
                    var statusLabel = annotation.status === 'resolved'
                      ? t('drawer.filterResolved')
                      : annotation.status === 'orphaned'
                        ? t('drawio.orphaned')
                        : t('drawer.filterOpen');
                    var label = typeof anchor.cellLabel === 'string' && anchor.cellLabel ? anchor.cellLabel : t('drawio.noLabel');
                    return h('div', {
                      key: annotation.id,
                      className: 'wb-card',
                      'data-drawio-card': annotation.id,
                      'data-selected': annotation.id === drawioSelectedAnnotationId ? 'true' : 'false',
                      role: 'button',
                      tabIndex: 0,
                      onClick: function () {
                        selectDrawioAnnotation(annotation);
                      },
                      onKeyDown: function (event) {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          selectDrawioAnnotation(annotation);
                        }
                      },
                    },
                      h('div', { className: 'wb-cardHead' },
                        h('span', { className: 'wb-badge' }, label),
                        h('span', { className: 'wb-meta' }, Array.isArray(anchor.cellIds) && anchor.cellIds.length > 1 ? t('drawio.groupCount', { count: anchor.cellIds.length }) : anchor.cellId ? 'cell ' + anchor.cellId : t('drawio.wholeDiagram')),
                        h('span', { className: 'wb-chip', 'data-info': 'true' }, statusLabel)),
                      h('div', { className: 'wb-bodyText' }, String(annotation.body || '')),
                      h('div', { className: 'wb-actions' },
                        annotation.status === 'resolved'
                          ? h('button', {
                            type: 'button',
                            className: 'wb-linkBtn',
                            disabled: !!busyOp,
                            onClick: function (event) {
                              event.stopPropagation();
                              reopenAnnotation(annotation);
                            },
                          }, t('annotation.reopen'))
                          : h('button', {
                            type: 'button',
                            className: 'wb-linkBtn',
                            disabled: !!busyOp,
                            onClick: function (event) {
                              event.stopPropagation();
                              resolveAnnotation(annotation);
                            },
                          }, t('annotation.resolve')),
                        h('button', {
                          type: 'button',
                          className: 'wb-linkBtn',
                          disabled: !!busyOp,
                          onClick: function (event) {
                            event.stopPropagation();
                            deleteAnnotation(annotation);
                          },
                        }, t('annotation.delete'))),
                    );
                  }),
              ),
              h('div', { className: 'wb-drawioFooter' },
                h('span', { className: 'wb-spacer' }),
                h('button', {
                  type: 'button',
                  className: 'wb-btn wb-primary',
                  'aria-label': t('drawio.sendTitle'),
                  title: t('drawio.sendTitle'),
                  disabled: drawioOpenCount === 0 || !!busyOp,
                  onClick: sendDrawioAnnotations,
                }, t('toolbar.send')),
              ),
            )
            : null,
          toast ? h(ToastView, { toast: toast, lang: lang, onClose: closeToast }) : null,
        );
      }

      if (isHtml) {
        var htmlAnnotationList = annotations.filter(function (annotation) {
          return annotation && annotation.format === 'html';
        });
        var htmlOpenCount = htmlAnnotationList.filter(function (annotation) {
          return annotation.status === 'open';
        }).length;
        htmlAnnotationList = htmlAnnotationList.slice().sort(function (a, b) {
          if ((a.status === 'open') !== (b.status === 'open')) return a.status === 'open' ? -1 : 1;
          return 0;
        });
        var htmlMetrics = htmlState || {};
        var htmlScrollY = Number(htmlMetrics.scrollY) || 0;
        var htmlScrollHeight = Number(htmlMetrics.scrollHeight) || 0;
        var htmlViewportHeight = Number(htmlMetrics.viewportHeight) || 0;
        var htmlDraftTarget = htmlDraft ? htmlAnchorTarget(htmlDraft) : '';
        var htmlDraftMeta = htmlDraft
          ? (htmlDraft.tag ? htmlDraft.tag + ' · ' : '') + (htmlDraft.selector || '')
          : '';
        var visibleHtmlPins = [];
        if (htmlScrollHeight > 0) {
          htmlAnnotationList.forEach(function (annotation, index) {
            var anchor = annotation.anchor || {};
            var yNorm = Number(anchor.yNorm);
            if (!Number.isFinite(yNorm)) return;
            var topPx = yNorm * htmlScrollHeight - htmlScrollY;
            if (topPx < -10) return;
            if (htmlViewportHeight > 0 && topPx > htmlViewportHeight + 10) return;
            var xNorm = Number(anchor.xNorm);
            var leftPct = (Number.isFinite(xNorm) ? Math.min(1, Math.max(0, xNorm)) : 0.5) * 100;
            visibleHtmlPins.push({ annotation: annotation, number: index + 1, left: leftPct, top: topPx });
          });
        }
        var htmlError = htmlMetrics.error || null;
        return h('div', {
          className: 'wb-root wb-htmlView',
          'data-ppt-workbench': 'body',
          'data-state': 'ready',
          'data-source-format': 'html',
          ref: rootRef,
        },
          h('div', { className: 'wb-htmlBar', role: 'toolbar', 'aria-label': t('html.badge') },
            h('span', { className: 'wb-chip', 'data-info': 'true', 'data-pdf-badge': '', 'data-source-format': 'html', title: t('html.badge') },
              t('html.badge')),
            h('span', { className: 'wb-htmlName', title: deck.path || '' }, deck.path ? basename(deck.path) : ''),
            h('span', { className: 'wb-spacer' }),
            h('span', { className: 'wb-saveStatus', 'data-html-status': htmlMetrics.status || 'loading' },
              htmlMetrics.status === 'ready' ? (htmlMetrics.title || '') : t('html.loading')),
            h('button', {
              type: 'button',
              className: 'wb-btn',
              'aria-pressed': htmlAnnotate ? 'true' : 'false',
              'aria-label': t('html.annotateMode'),
              title: htmlAnnotate ? t('html.annotateOn') : t('html.annotateOff'),
              onClick: toggleHtmlAnnotate,
            }, h('span', { 'aria-hidden': true }, '✎'), h('span', null, t('html.annotateMode'))),
            h('button', {
              type: 'button',
              className: 'wb-btn',
              'aria-pressed': htmlPanelOpen ? 'true' : 'false',
              'aria-label': t('html.panelTitle'),
              title: t('html.panelShow'),
              onClick: toggleHtmlPanel,
            },
              h('span', { 'aria-hidden': true }, '▤'),
              h('span', null, t('html.panelTitle')),
              htmlOpenCount > 0 ? h('span', { className: 'wb-tabCount' }, String(htmlOpenCount)) : null),
          ),
          htmlError
            ? h('div', { className: 'wb-drawioError', role: 'status', 'data-html-error': htmlError.code || 'error' },
              h('span', null, htmlError.message || t('html.loadFailed', { message: '' })),
              h('button', { type: 'button', className: 'wb-linkBtn', onClick: fetchHtmlArtifactUrl }, t('html.retry')),
            )
            : null,
          h('div', { className: 'wb-htmlContent' },
            h('iframe', {
              className: 'wb-htmlFrame',
              ref: htmlFrameRef,
              src: htmlSrc || undefined,
              sandbox: 'allow-scripts',
              title: htmlMetrics.title || basename(deck.path || 'report.html'),
              onLoad: function () {
                postHtmlAnnotate();
              },
            }),
            htmlMetrics.status !== 'ready'
              ? h('div', { className: 'wb-htmlLoading' },
                h('span', { className: 'wb-miniSpinner', 'aria-hidden': true }),
                h('span', null, t('html.loading')))
              : null,
            h('div', { className: 'wb-htmlPins' }, visibleHtmlPins.map(function (pin) {
              return h('button', {
                key: pin.annotation.id,
                type: 'button',
                className: 'wb-htmlPin',
                'data-html-pin': pin.annotation.id,
                'data-visible': 'true',
                'data-selected': pin.annotation.id === htmlSelectedAnnotationId ? 'true' : 'false',
                style: { left: pin.left + '%', top: pin.top + 'px' },
                title: htmlAnchorTarget(pin.annotation.anchor || {}),
                onClick: function () {
                  selectHtmlAnnotation(pin.annotation);
                },
              }, String(pin.number));
            })),
            htmlPanelOpen
              ? h('div', { className: 'wb-htmlPanel', 'data-html-panel': '' },
                h('div', { className: 'wb-htmlPanelHead' },
                  h('span', { className: 'wb-drawerTitle' }, t('html.panelTitle')),
                  htmlOpenCount > 0 ? h('span', { className: 'wb-chip', 'data-info': 'true' }, String(htmlOpenCount)) : null,
                  h('span', { className: 'wb-spacer' }),
                  h('button', {
                    type: 'button',
                    className: 'wb-btn wb-icon',
                    'aria-label': t('html.panelClose'),
                    title: t('html.panelClose'),
                    onClick: toggleHtmlPanel,
                  }, h('span', { 'aria-hidden': true }, '×')),
                ),
                h('div', { className: 'wb-htmlPanelBody' },
                  h('div', { className: 'wb-htmlSelection', 'data-html-draft': '' },
                    htmlDraft ? h('div', null, t('html.draft', { target: htmlDraftTarget })) : t('html.noDraft'),
                    htmlDraft && htmlDraftMeta ? h('div', { className: 'wb-meta' }, htmlDraftMeta) : null),
                  h('textarea', {
                    className: 'wb-textarea',
                    value: htmlDraftBody,
                    rows: 2,
                    disabled: !!busyOp,
                    placeholder: t('html.placeholder'),
                    'aria-label': t('html.panelTitle'),
                    onChange: function (event) {
                      setHtmlDraftBody(event.target.value);
                    },
                  }),
                  h('div', { className: 'wb-row', style: { justifyContent: 'space-between', alignItems: 'center' } },
                    htmlDraft
                      ? h('button', {
                        type: 'button',
                        className: 'wb-linkBtn',
                        disabled: !!busyOp,
                        onClick: function () {
                          setHtmlDraft(null);
                          setHtmlDraftBody('');
                        },
                      }, t('annotation.cancel'))
                      : h('span'),
                    h('button', {
                      type: 'button',
                      className: 'wb-btn wb-primary',
                      disabled: !String(htmlDraftBody || '').trim() || !!busyOp,
                      onClick: addHtmlAnnotation,
                    }, busyOp ? t('html.adding') : t('html.add'))),
                  h('div', { className: 'wb-sourceMeta' }, t('html.selectHint')),
                  htmlAnnotationList.length === 0
                    ? h('div', { className: 'wb-empty' }, t('html.empty'))
                    : htmlAnnotationList.map(function (annotation) {
                      var anchor = annotation.anchor || {};
                      var statusLabel = annotation.status === 'resolved'
                        ? t('drawer.filterResolved')
                        : annotation.status === 'orphaned'
                          ? t('drawio.orphaned')
                          : t('drawer.filterOpen');
                      var target = htmlAnchorTarget(anchor);
                      var meta = [anchor.tag, anchor.selector].filter(Boolean).join(' · ');
                      return h('div', {
                        key: annotation.id,
                        className: 'wb-card',
                        'data-html-card': annotation.id,
                        'data-selected': annotation.id === htmlSelectedAnnotationId ? 'true' : 'false',
                        role: 'button',
                        tabIndex: 0,
                        onClick: function () {
                          selectHtmlAnnotation(annotation);
                        },
                        onKeyDown: function (event) {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            selectHtmlAnnotation(annotation);
                          }
                        },
                      },
                        h('div', { className: 'wb-cardHead' },
                          h('span', { className: 'wb-badge' }, target),
                          meta ? h('span', { className: 'wb-meta', title: meta }, meta.slice(0, 48)) : null,
                          h('span', { className: 'wb-chip', 'data-info': 'true' }, statusLabel)),
                        h('div', { className: 'wb-bodyText' }, String(annotation.body || '')),
                        h('div', { className: 'wb-actions' },
                          annotation.status === 'resolved'
                            ? h('button', {
                              type: 'button',
                              className: 'wb-linkBtn',
                              disabled: !!busyOp,
                              onClick: function (event) {
                                event.stopPropagation();
                                reopenAnnotation(annotation);
                              },
                            }, t('annotation.reopen'))
                            : h('button', {
                              type: 'button',
                              className: 'wb-linkBtn',
                              disabled: !!busyOp,
                              onClick: function (event) {
                                event.stopPropagation();
                                resolveAnnotation(annotation);
                              },
                            }, t('annotation.resolve')),
                          h('button', {
                            type: 'button',
                            className: 'wb-linkBtn',
                            disabled: !!busyOp,
                            onClick: function (event) {
                              event.stopPropagation();
                              deleteAnnotation(annotation);
                            },
                          }, t('annotation.delete'))),
                      );
                    }),
                ),
                h('div', { className: 'wb-htmlFooter' },
                  h('span', { className: 'wb-spacer' }),
                  h('button', {
                    type: 'button',
                    className: 'wb-btn wb-primary',
                    'aria-label': t('html.sendTitle'),
                    title: t('html.sendTitle'),
                    disabled: htmlOpenCount === 0 || !!busyOp,
                    onClick: sendHtmlAnnotations,
                  }, t('toolbar.send'))),
              )
              : null,
          ),
          toast ? h(ToastView, { toast: toast, lang: lang, onClose: closeToast }) : null,
        );
      }

      var banners = [];
      if (conflict) {
        banners.push(h(NoticeBanner, {
          key: 'edit-conflict',
          kind: 'error',
          text: t('edit.conflict') +
            (conflict.currentSha ? ' ' + t('edit.version', { version: shaShort(conflict.currentSha) }) : '') +
            (conflict.conflictCopy ? ' ' + t('edit.conflictCopy', { name: String(conflict.conflictCopy).split('/').pop() }) : ''),
          lang: lang,
          actions: [{ key: 'reload', label: t('edit.reload'), onClick: reloadDiscardingDraft }],
          onDismiss: function () {
            setConflict(null);
          },
        }));
      }
      if (repairVisible) {
        var repairText = repairNotice.orphaned > 0 && repairNotice.repaired > 0
          ? t('banner.repair', { repaired: repairNotice.repaired, orphaned: repairNotice.orphaned })
          : repairNotice.orphaned > 0
            ? t('banner.repairOrphanedOnly', { orphaned: repairNotice.orphaned })
            : t('banner.repairedOnly', { repaired: repairNotice.repaired });
        banners.push(h(NoticeBanner, {
          key: 'repair',
          kind: 'warn',
          text: repairText,
          lang: lang,
          onDismiss: function () {
            setDismissedRepairs(function (previous) {
              var next = Object.assign({}, previous);
              next[repairKey] = true;
              return next;
            });
          },
        }));
      }
      if (refreshErrorVisible) {
        banners.push(h(NoticeBanner, {
          key: 'refresh-error',
          kind: 'error',
          text: t('banner.refreshFailed', { message: refreshError.message || refreshError.code || '' }),
          lang: lang,
          actionLabel: t('error.retry'),
          onAction: retryDeck,
          onDismiss: function () {
            setDismissedRefresh(refreshErrorKey);
          },
        }));
      }
      if (deck.writeAllowed === false) {
        banners.push(h(NoticeBanner, {
          key: 'outside',
          kind: 'warn',
          text: t('banner.outside'),
          lang: lang,
        }));
      }

      var currentPageClamped = Math.min(Math.max(1, currentPage), Math.max(1, total));
      var draftPage = draft ? draft.page : null;
      var truncatedNote = truncated && slideCount > renderedPages
        ? h('div', { className: 'wb-pageTruncated' },
          t('canvas.truncatedNote', { rendered: renderedPages, rest: slideCount - renderedPages }))
        : null;

      return h('div', { className: 'wb-root', 'data-ppt-workbench': 'body', 'data-state': 'ready', ref: rootRef },
        deckState.refreshing || saving ? h('div', { className: 'wb-progress', 'aria-hidden': true }) : null,
        banners,
        h(Toolbar, {
          lang: lang,
          currentPage: currentPageClamped,
          total: Math.max(1, slideCount),
          pageCount: Math.max(1, total),
          refreshing: !!deckState.refreshing || saving,
          zoom: zoom,
          annotate: annotate,
          edit: editMode,
          format: deckFormat,
          sourceFormat: sourceFormat,
          showEdit: artifactEditable,
          canAnnotate: writeAllowed && !busyOp && !saving && !sourceOpen,
          canEdit: canEdit && !saving && !busyOp,
          canSend: openCount > 0 && !busyOp,

          missingFonts: missingFonts,
          truncated: truncated,
          renderedPages: renderedPages,
          railOpen: railOpen,
          onPrev: function () {
            if (currentPageClamped > 1) selectPage(currentPageClamped - 1);
          },
          onNext: function () {
            if (currentPageClamped < total) selectPage(currentPageClamped + 1);
          },
          onZoomFit: function () {
            setZoom('fit');
          },
          onZoomActual: function () {
            setZoom('actual');
          },
          onToggleAnnotate: toggleAnnotateMode,
          onToggleEdit: toggleEditMode,
          onToggleRail: function () {
            setRailPref(!railOpen);
          },
          onSend: sendAnnotations,
          onOpenNative: openNative,
          nativeBusy: nativeBusy,
          onOpenSource: openSourceEditor,
          sourceOpen: sourceOpen,
        }),
        editMode
          ? h(EditBar, {
            lang: lang,
            currentPage: currentPageClamped,
            pageCount: Math.max(1, total),
            history: historyState,
            pendingCount: pendingCount,
            formDirty: formDirty,
            saving: saving,
            readonly: !writeAllowed,
            conflict: !!conflict,
            autosave: autosave,
            saveStatus: saveStatusText,
            nativeBusy: nativeBusy,
            onToggleAutosave: toggleAutosave,
            onOpenNative: openNative,
            onPageAction: runPageOp,
            onUndo: function () {
              undoRedo('undo');
            },
            onRedo: function () {
              undoRedo('redo');
            },
            onSave: function () {
              saveAll({});
            },
            onExit: function () {
              requestExitEdit(null);
            },
          })
          : annotate
            ? h('div', { className: 'wb-annotateHint' },
              h('span', null, tr(deckFormat === 'pdf' ? 'annotate.hintPdf' : 'annotate.hint')),
            )
            : null,
        h('div', { className: 'wb-main' },
          railOpen
            ? h(ThumbRail, {
              lang: lang,
              pages: pages,
              images: images,
              currentPage: currentPageClamped,
              openCounts: openCountsByPage,
              railRef: railRef,
              onNeedPage: ensurePage,
              onSelectPage: selectPage,
            })
            : null,
          h('div', {
            className: 'wb-canvas' + (annotate ? ' wb-annotating' : editMode ? ' wb-editing' : ''),
            ref: setCanvasRef,
            'data-wb-canvas': '',
            role: 'region',
            'aria-label': t('canvas.aria'),
            tabIndex: 0,
            onScroll: handleCanvasScroll,
            onKeyDown: function (event) {
              if (event.key === 'PageDown') {
                event.preventDefault();
                if (currentPageClamped < total) selectPage(currentPageClamped + 1);
              } else if (event.key === 'PageUp') {
                event.preventDefault();
                if (currentPageClamped > 1) selectPage(currentPageClamped - 1);
              } else if (event.key === 'Home') {
                event.preventDefault();
                selectPage(1);
              } else if (event.key === 'End') {
                event.preventDefault();
                if (total > 0) selectPage(total);
              }
            },
          },
            pages.length === 0
              ? h('div', { className: 'wb-empty' }, t('canvas.empty'))
              : h('div', { className: 'wb-pages' },
                pages.map(function (page) {
                  return h(PageView, {
                    key: (sha || 'deck') + ':' + page.page,
                    page: page,
                    image: images[page.page],
                    zoom: zoom,
                    fitWidth: fitWidth,
                    eager: page.page <= EAGER_PAGES,
                    lang: lang,
                    busy: busyOp,
                    annotations: annotationsByPage[page.page - 1] || EMPTY_LIST,
                    selectedId: selectedId,
                    slideWidthEmu: slideWidthEmu,
                    slideHeightEmu: slideHeightEmu,
                    draft: draftPage === page.page ? draft : null,
                    scrollRootRef: canvasRef,
                    onPageNode: registerPageNode,
                    onNeedPage: ensurePage,
                    onRetryPage: retryPage,
                    annotate: annotate,
                    editMode: editMode,
                    editLocked: !!conflict || saving,
                    slide: viewSlides[page.page - 1] || slides[page.page - 1],
                    selectedShapeBox: selectedShapeView && selectedShape && selectedShape.slideIndex === page.page - 1
                      ? selectedShapeBox
                      : null,
                    onSelectShape: handleSelectShape,
                    shapeEditable: selectedShapeEditable,
                    inlineEdit: inlineEdit && inlineEdit.slideIndex === page.page - 1 ? inlineEdit : null,
                    onInlineStart: handleInlineStart,
                    onInlineChange: handleInlineChange,
                    onInlineCommit: handleInlineCommit,
                    onInlineCancel: handleInlineCancel,
                    onShapeBoxCommit: handleShapeBoxCommit,
                    onGestureState: handleGestureState,
                    selectedAnnotation: (annotationsByPage[page.page - 1] || []).filter(function (annotation) { return annotation.id === selectedId; })[0] || null,
                    onPageTap: handlePageTap,
                    onMarquee: handlePageMarquee,
                    onSelectAnnotation: selectAnnotation,
                    onDraftChange: changeDraftBody,
                    onCancelDraft: cancelDraft,
                    onSaveDraft: saveDraft,
                  });
                }),
                truncatedNote,
              ),
          ),
        ),
        sourceOpen
          ? h(SourceDrawer, {
            lang: lang,
            editor: sourceEditor,
            path: deck && deck.path ? deck.path : path,
            onClose: closeSourceEditor,
            onChange: function (value) {
              updateSourceEditor({ text: value });
            },
            onSave: saveSource,
            onReload: fetchSourceText,
          })
          : editMode
            ? h(ShapeInspector, {
            lang: lang,
            open: drawerOpen,
            onToggleOpen: function () {
              setDrawerPref(!drawerOpen);
            },
            shape: selectedShapeView,
            slideIndex: currentSlideIndex,
            notes: currentNotes,
            resetKey: resetKey,
            pendingCount: pendingCount,
            saving: saving,
            readonly: !writeAllowed || !!conflict || saving,
            diffRef: formDiffRef,
            onFormDirty: setFormDirtyCount,
              onAutoDraft: appendPendingOps,
              onClearDraft: clearDraft,
            })
            : h(AnnotationDrawer, {
            lang: lang,
            annotations: annotations,
            slides: slides,
            counts: counts,
            filter: filter,
            selectedId: selectedId,
            busy: busyOp,
            open: drawerOpen,
            onFilter: setFilter,
            onToggleOpen: function () {
              setDrawerPref(!drawerOpen);
            },
            onSelect: selectAnnotation,
            onResolve: resolveAnnotation,
            onReopen: reopenAnnotation,
            onDelete: deleteAnnotation,
            onReply: replyAnnotation,
          }),
        sourceEditor && sourceEditor.confirmClose
          ? h(SourceCloseDialog, {
            lang: lang,
            onCancel: cancelSourceClose,
            onDiscard: discardSourceEditor,
          })
          : null,
        dirtyDialog
          ? h(DirtyDialog, {
            lang: lang,
            count: dirtyDialog.count,
            saving: saving,
            onCancel: dirtyCancel,
            onDiscard: dirtyDiscardAndExit,
            onSave: dirtySaveAndExit,
          })
          : null,
        toast ? h(ToastView, { toast: toast, lang: lang, onClose: closeToast }) : null,
      );
    }

    // ------------------------------------------------------------------
    // 注册
    // ------------------------------------------------------------------
    return {
      inject: ['slots', 'locale', 'documentPreviews', 'sidebarRightTabs', 'sidebarRight', 'contextMenus'],
      apply: function (ctx) {
        runtime.locale = ctx.locale;

        ctx.effect(function () {
          var dispose = null;
          try {
            dispose = ctx.locale.register(NS, { zh: ZH, en: EN });
          } catch (error) {
            dispose = null;
          }
          return function () {
            try {
              if (typeof dispose === 'function') dispose();
            } catch (error) {
              /* ignore */
            }
          };
        }, 'dsh-ppt-workbench: dictionaries');

        ctx.effect(function () {
          return injectStyles();
        }, 'dsh-ppt-workbench: styles');

        ctx.effect(function () {
          return ctx.documentPreviews.register({
            id: RENDERER_ID,
            extensions: ['pptx', 'pdf', 'html', 'htm', 'drawio', 'mmd', 'mermaid'],
            binaryExtensions: ['pptx', 'pdf', 'html', 'htm', 'drawio', 'mmd', 'mermaid'],
            priority: 'extension',
            title: function () {
              return tr('viewer.title');
            },
            loading: 'renderer',
            wrap: false,
          });
        }, 'dsh-ppt-workbench: renderer metadata');

        ctx.effect(function () {
          return ctx.slots.inject('sidebar.right.tab.document', function () {
            return ctx.slots.register(
              { name: 'sidebar.right.tab.document', key: RENDERER_ID, locale: NS },
              WorkbenchBody,
            );
          });
        }, 'dsh-ppt-workbench: renderer body');

        ctx.effect(function () {
          return ctx.sidebarRightTabs.register({
            id: FEISHU_TAB_ID,
            kind: FEISHU_TAB_KIND,
            multiple: true,
            priority: 'extension',
            title: function () {
              return tr('feishu.tabTitle');
            },
            guide: [{
              id: 'feishu-doc',
              order: 40,
              title: function () {
                return tr('feishu.guideTitle');
              },
              description: function () {
                return tr('feishu.guideDescription');
              },
            }],
          });
        }, 'dsh-ppt-workbench: feishu tab type');

        ctx.effect(function () {
          return ctx.slots.inject('sidebar.right.pane.tab', function () {
            return ctx.slots.register(
              {
                name: 'sidebar.right.pane.tab',
                key: FEISHU_TAB_ID,
                locale: NS,
                inject: function () {
                  return {
                    openNativeBrowser: function (url) {
                      try {
                        return ctx.sidebarRight.openTab('browser', {
                          params: { url: url },
                          revealIfOpened: true,
                          preferNewPane: true,
                        });
                      } catch (error) {
                        return undefined;
                      }
                    },
                  };
                },
              },
              FeishuDocBody,
            );
          });
        }, 'dsh-ppt-workbench: feishu body');

        ctx.effect(function () {
          return ctx.slots.inject('plugins.item', function () {
            return ctx.slots.register({
              name: 'plugins.item',
              id: 'feishu-doc',
              order: 60,
              label: function () { return tr('feishu.settingsTitle'); },
              locale: NS,
            }, FeishuSettingsCard);
          });
        }, 'dsh-ppt-workbench: feishu settings card');

        ctx.effect(function () {
          return ctx.contextMenus.register({
            id: 'dsh-ppt-workbench.feishu-url',
            target: 'url',
            order: 20,
            resolve: function (target) {
              var url = target && typeof target.url === 'string' ? target.url : '';
              if (!/^https:\/\/[^/]*\.(feishu\.cn|larksuite\.com)\/(docx|wiki)\//i.test(url)) return [];
              return [
                {
                  id: 'open-workbench',
                  label: tr('feishu.menuOpen'),
                  run: function () {
                    try {
                      ctx.sidebarRight.openTab(FEISHU_TAB_KIND, {
                        params: { url: url },
                        revealIfOpened: false,
                        preferNewPane: true,
                      });
                    } catch (error) { /* ignore */ }
                  },
                },
                {
                  id: 'open-native',
                  label: tr('feishu.menuNative'),
                  run: function () {
                    try {
                      ctx.sidebarRight.openTab('browser', {
                        params: { url: url },
                        revealIfOpened: true,
                        preferNewPane: true,
                      });
                    } catch (error) { /* ignore */ }
                  },
                },
              ];
            },
          });
        }, 'dsh-ppt-workbench: feishu URL context menu');
      },
    };
  },
});
