# Artifact Workbench

**Browse, annotate and edit agent-generated artifacts in the DeepSeek Harness sidebar.**

[中文](README.md) · [Changelog](CHANGELOG.md) · [Roadmap](ROADMAP.md) · [Security](SECURITY.md) · [Third-party notices](THIRD-PARTY-NOTICES.md)

> Project name: Artifact Workbench. Starting with **0.15.0**, the npm package
> name, plugin id, renderer/tab keys and route prefix are all
> `dsh-artifact-workbench` (previously `dsh-ppt-workbench`). To upgrade from
> 0.14.x see [MIGRATION.md](MIGRATION.md); the old storage directory is migrated
> automatically and existing annotation sidecars are unaffected.

Artifact Workbench is a desktop plugin for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness). It takes over the sidebar document preview and turns `.pptx`, `.pdf`, `.html`, `.drawio` and `.mmd` artifacts into a review workbench: annotations are stored in a JSON sidecar next to the artifact and can be turned into a single "please fix this" prompt for the agent. PPTX files can also be edited in place.

## Capabilities

| Format | Preview | Annotate | Edit | Notes |
| --- | --- | --- | --- | --- |
| `.pptx` | page images (144 DPI) | ✅ shape / area / multi-select | ✅ structured + inline | top-level shape text, font, geometry, tables, notes, page ops; auto-save; undo/redo |
| `.pdf` | page images | ✅ point / area | — read-only | page number + normalized coordinates |
| `.html` / `.htm` | original page in an iframe | ✅ DOM selector | — read-only | report-style H5; scripts run in a sandboxed iframe |
| `.drawio` | embedded offline draw.io editor | ✅ node (mxCell) / diagram | ✅ in the editor | saves back to the source file; conflict copies preserved |
| `.mmd` / `.mermaid` | page image | ✅ page / area | ✅ source panel | last 5 source backups, render failure rolls back |
| Feishu docx/wiki | read-only mirror + native page | ✅ comments/replies | — | optional; local `lark-cli` or OAuth app config |

Cross-cutting features:

- **Follow changes**: when the agent or an external app rewrites the file, the tab reloads and repairs annotation anchors (sha → shape id+name → text → geometry). Anchors that cannot be repaired are marked "needs re-anchor" instead of being deleted.
- **Send to DSH**: unresolved annotations (page, shape reference, text excerpt, file SHA) are assembled into a prompt in the composer for confirmation.
- **Native fallback**: "Open in LibreOffice" for PPTX/PDF and "Open in draw.io" for diagrams; external changes go through the same revision/conflict path.
- **Write boundary**: write operations (annotations, edits, undo, source saves) are only allowed inside the current session workspace; artifacts outside it are read-only.

## Requirements

- **DSH desktop app** (Electron). The plugin needs the document preview / sidebar-right extension points and the LibreOffice Kit that ships with DSH.
- DSH **0.2.x** (verified on 0.2.1-rc.5 and 0.2.2-rc.1; `engines.dsh` is `>=0.2.0-rc.2 <0.3.0`).
- Host Node **>= 22** (the plugin runs inside the DSH main process; users do not install Node themselves).
- macOS is the primary tested platform. Windows/Linux have path detection and launch branches but are not end-to-end verified yet.

## Installation

This is a DSH bundle plugin (`dsh.bundle.patch` + client inject). A plain
`npm install` does **not** load it — use the DSH plugin manager.

### A. DSH plugin page (recommended)

1. Open the Plugins page in DSH.
2. Add plugin → install bundle, target `dsh-artifact-workbench@0.15.1` (or a local directory).
3. No restart required; open a `.pptx` document tab to verify the workbench appears.

### B. `plugin_manager` tool

```text
action: install_bundle
target: dsh-artifact-workbench@0.15.1      # npm spec; use the absolute path of a local checkout instead
```

### C. Local link (development)

```bash
git clone https://github.com/endlass/dsh-artifact-workbench.git
cd dsh-artifact-workbench
npm run check && npm run test:smoke   # optional pre-flight
```

Then install with method B using the absolute repository path. Changes to
`index.js` / `lib/**` take effect after a DSH restart; `client.js` supports hot
replacement.

After installation, `.pptx` opens in Artifact Workbench by default (the renderer
dropdown can switch back to the built-in preview); `.docx`, `.xlsx` etc. are
untouched.

## External dependencies and path configuration

| Dependency | Required? | Used for | Auto-detected locations |
| --- | --- | --- | --- |
| LibreOffice Kit shipped with DSH | required (bundled with DSH) | PPTX/PDF page rendering, inventory | `$DSH_RESOURCES/app.asar.unpacked/...` |
| python-pptx | required (DSH runtime) | PPTX inventory / edit ops | DSH runtime python |
| **draw.io Desktop** | required to open `.drawio`/`.mmd` | page image export (the embedded editor itself is offline) | `/Applications/draw.io.app`, `/usr/bin/drawio`, `/snap/bin/drawio`, Windows defaults |
| **Chrome / Chromium** | required to open `.html` | H5 → PDF snapshot (page count/thumbnails) | Chrome/Chromium/Edge app bundles, `google-chrome`, `chromium`, Windows defaults |
| LibreOffice.app | optional | "Open in LibreOffice" external editing | `/Applications/LibreOffice.app`, Linux `libreoffice`/`soffice`, Windows defaults |
| `lark-cli` | optional | Feishu documents/comments (early P5 channel) | `~/.npm-global/bin`, `~/.local/bin`, `/usr/local/bin`, `/opt/homebrew/bin` |

Paths can be pinned in a **config file** or via **environment variables**
(environment wins). DSH desktop GUI does not inherit shell environment
variables, so desktop users should prefer the config file.

### Config file

`$DSH_HOME/storages/dsh-artifact-workbench/config.json` (default
`~/.dsh/storages/dsh-artifact-workbench/config.json`; create it manually; restart
the plugin/DSH after editing):

```json
{
  "chrome": "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "drawio": "/Applications/draw.io.app/Contents/MacOS/draw.io",
  "libreoffice": "/Applications/LibreOffice.app",
  "larkCli": "/opt/homebrew/bin/lark-cli",
  "python": "/path/to/python3"
}
```

All fields are optional; missing entries fall back to auto-detection. The file
only contains local paths, no secrets.

## Configuration (environment variables)

| Variable | Default | Purpose |
| --- | --- | --- |
| `DSH_HOME` | `~/.dsh` | DSH home; determines the plugin storage root |
| `ARTIFACT_WORKBENCH_STORAGE` | `$DSH_HOME/storages/dsh-artifact-workbench` | plugin cache/log/credential root |
| `DSH_RESOURCES` / `ARTIFACT_WORKBENCH_RESOURCES` | auto-detected DSH resources dir | LibreOffice Kit root |
| `ARTIFACT_WORKBENCH_PYTHON` | DSH runtime python3 | python-pptx interpreter |
| `ARTIFACT_WORKBENCH_CHROME` | auto-detected | Chrome/Chromium for H5 snapshots |
| `ARTIFACT_WORKBENCH_DRAWIO` | auto-detected | draw.io Desktop CLI (page export) |
| `ARTIFACT_WORKBENCH_DRAWIO_APP` | same as `ARTIFACT_WORKBENCH_DRAWIO` | draw.io app for "Open in draw.io" |
| `ARTIFACT_WORKBENCH_LIBREOFFICE` | auto-detected | LibreOffice app for "Open in LibreOffice" |
| `ARTIFACT_WORKBENCH_LARK_CLI` | auto-detected | `lark-cli` path |
| `ARTIFACT_WORKBENCH_FEISHU_ACCOUNTS` | `https://accounts.feishu.cn` | Feishu OAuth endpoint (testing) |
| `ARTIFACT_WORKBENCH_FEISHU_OPEN` | `https://open.feishu.cn` | Feishu Open API endpoint (testing) |
| `ARTIFACT_WORKBENCH_OPEN_DRY_RUN` | unset | set to `1` to make "open externally" return metadata without launching |

> Compatibility: 0.14.x `PPT_WORKBENCH_*` variables are still read (new names win); an explicit `ARTIFACT_WORKBENCH_STORAGE` disables the automatic storage migration.

## Data and storage

| Data | Location | Notes |
| --- | --- | --- |
| Render cache | `$DSH_HOME/storages/dsh-artifact-workbench/renders/<sha256>/` | page PNGs, inventory, manifest; safe to delete |
| Runtime log | `$DSH_HOME/storages/dsh-artifact-workbench/workbench.log` | route names, SHA prefixes, timings; no document content or credentials |
| Annotation sidecar | `<artifact>.workbench/annotations.json` | next to the artifact inside the workspace; readable by the agent |
| Edit history | `<artifact>.workbench/history.json` + `history/` | independent snapshots, 30 by default |
| Edit scratch/lock | `<artifact>.workbench/edit-tmp/`, `edit.lock` | cleaned after save |
| Conflict copies | `<artifact>.workbench/conflict/` | kept when an external change is detected |
| Feishu credentials (optional) | `$DSH_HOME/storages/dsh-artifact-workbench/feishu-app.json`, `feishu-token.json` | mode `0600`; never returned to the client or logged |

The plugin writes no session events and does not modify other DSH plugins'
data. After uninstalling you can delete the cache and `.workbench` directories
manually.

## Privacy and permission boundaries

- **Local-first**: no telemetry, no background network requests. The only
  outbound requests are the user-enabled Feishu integration (OAuth + Open API).
- **Write boundary**: every write requires the artifact's `realpath` to be
  inside the current session workspace (symlink escapes are rejected);
  outside-workspace artifacts are read-only.
- **Route auth**: Host routes are mounted on the existing DSH connection server,
  reusing DSH owner-browser authentication, plus a session-liveness check.
- **External programs**: LibreOffice / draw.io / Chrome / lark-cli are spawned
  with argv arrays (no shell interpolation); file paths are passed as data only.
- **H5 isolation**: report HTML runs in a `sandbox="allow-scripts"` iframe
  (no `allow-same-origin`), so scripts cannot read DSH cookies, localStorage or
  the parent DOM. Static assets are served from an "HTML + referenced assets"
  allowlist with a one-hour token; hidden directories, sidecars and symlinks
  are not readable.
- **Feishu credentials**: app secret and user token are stored with mode `0600`
  in the plugin storage directory, never returned to the client and never
  logged.
- **draw.io editor**: `editor/` is trusted third-party code shipped with the
  plugin (the draw.io webapp, cloud integrations trimmed, fully offline). It is
  not sandboxed from the DSH page; review `editor/` changes as carefully as
  `index.js`/`client.js`.

See [SECURITY.md](SECURITY.md) for details and how to report vulnerabilities.

## Usage

1. Ask the agent to generate `foo.pptx` and call `present` (or link the file in its reply).
2. Click the delivery card/file link → the "Artifact Workbench" tab opens in the sidebar.
3. "Annotate" → click a page element or drag a box; manage threads/resolution/filters in the bottom drawer.
4. "Send to DSH" puts unresolved annotations into the composer; confirm to send. The canvas reloads when the agent rewrites the file.
5. "Edit" → double-click text for inline editing, drag/resize shapes, or use the inspector; auto-save is on by default (1500 ms idle) and ⌘/Ctrl+S always works. Use "Edit in LibreOffice" when native interaction is needed.
6. For `.drawio`, the embedded editor opens directly (offline); select nodes to write node-level annotations in the side panel.
7. Feishu: after configuring `lark-cli` or an OAuth app, browse docx/wiki read-only and manage comments in the sidebar.

## Known limitations

- PPTX edits only top-level shapes: group children, picture replacement, animations/transitions, SmartArt and media are out of scope.
- After saving, the whole deck is re-rendered (about 3–4 s for 12 slides); dirty-page-only rendering is not implemented yet.
- PDF text-layer selection/search is not wired up; annotations are page-image coordinates plus an optional text excerpt.
- H5 is annotate-only and never modifies the source; only local referenced assets are served, external/CDN assets are not automatically allowed.
- `.drawio` participates in the page-image pipeline for up to 30 pages (the embedded editor itself has no page limit); node annotations are anchored by mxCell id and become orphaned when the node is deleted.
- Mermaid source saves are not syntax-validated; a failed render rolls the source back, and only the last 5 backups are kept.
- Native external editing requires LibreOffice / draw.io installed locally; non-macOS platforms are not end-to-end verified.
- Feishu integration supports docx/wiki only and needs an app or local `lark-cli` authorization.
- `.xlsx` is not taken over (Excel preview-only is not implemented).
- Missing fonts only produce a warning; LibreOffice and PowerPoint layout can differ.
- The repository is fairly large (~64 MB), mostly the ~42 MB draw.io vendor tree under `editor/`; `npm pack` is ~11.5 MB compressed / ~43 MB unpacked. This keeps the plugin offline-capable and installable as a single package; splitting the vendor assets into a separate package is future work.

## Uninstall

1. Disable or uninstall `dsh-artifact-workbench` from the DSH plugin page / `plugin_manager`.
2. Optional cleanup: `$DSH_HOME/storages/dsh-artifact-workbench/` (cache, log, Feishu credentials).
3. Optional cleanup: `<artifact>.workbench/` directories next to artifacts (annotations and edit history).
4. The plugin writes no registry entries, installs no system services and changes no global DSH configuration.

## Development and testing

```bash
npm run check       # syntax check of all hand-written JS (index/client/lib/test/scripts)
npm run test:smoke  # dependency-free subset (same as CI)
npm test            # full suite: also needs the DSH desktop LibreOffice Kit, python-pptx, draw.io Desktop, Chrome
npm pack --dry-run  # inspect package files and size
```

All tests are plain `node test/*.mjs`; fixtures are synthetic samples under
`test/fixtures/` and contain no real business data. See
[test/README.md](test/README.md) for the per-test environment matrix. CI
(GitHub Actions, Node 22/24) runs only `npm run check`, `npm run test:smoke` and
`npm pack --dry-run`; tests that need local programs are not faked green in CI.

Release steps: [PUBLISHING.md](PUBLISHING.md).

### Repository layout

```
index.js              Host half: /api/dsh-artifact-workbench/* routes (deck/slide/annotations/edit/history/undo/redo/open-native/source/feishu/health)
client.js             Client half: sidebar renderer/body, browse/annotate/edit/auto-save, drawio iframe, H5 iframe, Feishu tab
lib/render.mjs        LibreOffice Kit render queue, PDF/H5/diagram orchestration, external program detection
lib/artifacts/        adapter registry (pptx editable / pdf / html / diagram)
lib/annotations.mjs   annotation sidecar schema v2, anchor repair, drawio cell annotations
lib/edit-backend.mjs  edit backend abstraction + PPTX backend (python-pptx)
lib/edit_ops.py       allowlisted edit ops
lib/history.mjs       independent snapshots, undo/redo
lib/deck-lock.mjs     single-writer lock
lib/inventory.py      python-pptx structural inventory
lib/feishu*.mjs       lark-cli wrapper / Device Flow OAuth
lib/html-server.mjs   H5 static asset allowlist route
lib/editor-server.mjs drawio editor static route
editor/               trimmed draw.io webapp (Apache-2.0, third-party; see THIRD-PARTY-NOTICES.md)
test/                 tests and synthetic fixtures
scripts/check.mjs     syntax check script
```

## Version and compatibility

- Current version **0.15.1** (see [CHANGELOG.md](CHANGELOG.md)).
- DSH: `>=0.2.0-rc.2 <0.3.0`; host Node `>=22`.
- Annotation sidecar schema: `dsh-artifact-annotation@2`, automatically migrating the legacy `dsh-ppt-annotation@1`.
- 0.15.0 rename: package id, plugin id and renderer keys are now `dsh-artifact-workbench`; tabs opened before the upgrade must be reopened. `$DSH_HOME/storages/dsh-ppt-workbench` is migrated automatically, and legacy `PPT_WORKBENCH_*` environment variables are still accepted. See [MIGRATION.md](MIGRATION.md).

## License

This project's own code is released under the **MIT** license, © 2026 Xingchen
Zhao (endlass). See [LICENSE](LICENSE).

`editor/` is a vendored draw.io webapp (draw.io 31.4.5, packaged via
`dsh-drawioedit` main) and is **not** MIT-licensed: it is predominantly
Apache-2.0, with EPL-2.0 (ELK), CC-BY-4.0 (templates),
OFL-1.1 (font) and the draw.io icon/stencil additional terms. The full
component inventory, per-component copyright lines and license texts are in
[licenses/README.md](licenses/README.md) and
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md); provenance and modification
records are in [editor/PROVENANCE.md](editor/PROVENANCE.md) and
[editor/MODIFICATIONS.md](editor/MODIFICATIONS.md).

Starting with 0.15.1 the libavoid (LGPL-2.1) append is removed from
`editor/js/extensions.min.js`, so draw.io's **Arrange → Layout → Orthogonal
Routing** auto-routing action is unavailable; ordinary orthogonal edge styles
(part of draw.io core) are unaffected.

Compliance status and open items (libavoid LGPL is no longer a blocker; the
remaining ELK/PlantUML provenance items are tracked in
[COMPLIANCE.md](COMPLIANCE.md)). "draw.io" is a registered trademark (EU
#018062448) of draw.io Ltd; this project is an independent integration, not
affiliated with or endorsed by draw.io Ltd. Upstream branding assets retained
in `editor/` are used only for functional fidelity, not as this project's own
branding.
