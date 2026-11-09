# Security policy

## Supported versions

Security fixes land on the latest published `0.x` line. The current release is
tracked in `CHANGELOG.md`; pre-release DSH alpha builds are supported on a
best-effort basis.

## Reporting a vulnerability

Please report security issues privately through GitHub Security Advisories
("Report a vulnerability" on the repository's Security tab) rather than a public
issue. Include:

- the affected version, DSH version and OS;
- a minimal reproduction (artifact type, steps, expected/actual behaviour);
- whether the issue lets an artifact or a third party read/write outside the
  session workspace, reach credentials, or execute code.

Please do not include real business decks, Feishu credentials or personal data
in a report; synthetic artifacts are enough.

## Trust model

Artifact Workbench is a **local-first desktop plugin** for DeepSeek Harness. It
runs inside the DSH host process and the DSH web client; it is not a network
service and exposes no port of its own.

- Host routes are mounted on the existing DSH `connection` server
  (`/api/dsh-ppt-workbench/*`) and rely on DSH's owner-browser authentication.
  Each request additionally checks that the session is live and that the
  artifact path resolves inside the session's working directory.
- The plugin assumes the DSH installation and the local user account are
  trusted. It does not attempt to defend against an attacker who can already
  run code as that user.
- Artifacts are treated as untrusted input: they are parsed/rendered locally
  and validated, but a corrupt or hostile Office/PDF/diagram file may still
  crash the renderer (the request fails; no code is executed by the plugin).

## Data boundaries and storage

| Data | Location | Notes |
| --- | --- | --- |
| Render cache (PNG pages, inventory JSON) | `$DSH_HOME/storages/dsh-ppt-workbench/renders/<sha256>/` | Reproducible; safe to delete |
| Runtime log | `$DSH_HOME/storages/dsh-ppt-workbench/workbench.log` | Route names, SHA prefixes, timings; no document content or credentials |
| Annotation sidecar | `<artifact>.workbench/annotations.json` | Written next to the artifact, only inside the session workspace |
| Edit history | `<artifact>.workbench/history.json` + `history/` snapshots | Old versions kept as independent copies (default 30) |
| Edit scratch / lock | `<artifact>.workbench/edit-tmp/`, `edit.lock` | Cleaned after save |
| Conflict copies | `<artifact>.workbench/conflict/` | Written when an external change is detected |
| Feishu app credentials / user token (optional) | `$DSH_HOME/storages/dsh-ppt-workbench/feishu-app.json`, `feishu-token.json` | Created with mode `0600`; never returned to the client and never logged |

`$DSH_HOME` defaults to `~/.dsh`. Overridable with `DSH_HOME`; the plugin's own
storage root can be moved independently with `PPT_WORKBENCH_STORAGE` (useful for
tests and read-only home directories).

### Write boundary

- Write operations (annotations, edits, undo/redo, source edits) require the
  artifact's **real path** to be inside the session working directory
  (symlink-aware `isInsideReal`). Artifacts outside the workspace can be
  previewed and annotated only if the Host can still write a sidecar; otherwise
  the request is rejected with `outside-workspace`.
- The H5 artifact route serves only the HTML file and the assets it references
  (allowlist, no hidden directories, no sidecar files, no symlinks) through a
  random token that expires after one hour. Hijacked/unknown paths return 404.

## Local external programs

The plugin invokes local programs for format conversion; they are resolved from
a configurable candidate list, never from user-provided command strings:

- **LibreOffice Kit** — bundled with the DSH desktop application (peer runtime,
  MPL-2.0). Used for PPTX/PDF rendering.
- **draw.io Desktop** — optional; used only for `.drawio`/`.mmd` page rendering.
  Override with `PPT_WORKBENCH_DRAWIO`.
- **Google Chrome / Chromium** — optional; used only for `.html/.htm` → PDF
  snapshots. Override with `PPT_WORKBENCH_CHROME`.
- **lark-cli** — optional; Feishu integration only. Override with
  `PPT_WORKBENCH_LARK_CLI`.
- **"Open externally"** — launches LibreOffice or draw.io on the artifact.
  Only allowed for artifacts inside the session workspace, at most once per
  3 seconds per file. Set `PPT_WORKBENCH_OPEN_DRY_RUN=1` to disable the launch
  in tests/automation.

Processes are spawned with argv arrays (no shell concatenation) and with the
artifact path as data. File contents are never passed through a shell.

## Network

- The plugin makes **no telemetry or background requests**.
- The only outbound HTTP requests are the optional Feishu integration
  (OAuth device flow and Feishu Open API, to `open.feishu.cn` /
  `accounts.feishu.cn` by default; overridable for testing).
- The vendored draw.io editor is trimmed so that cloud-storage integrations and
  remote templates are not loaded; it runs fully offline.
- H5 report iframes are sandboxed with `sandbox="allow-scripts"` (no
  `allow-same-origin`), so report scripts cannot read DSH cookies, local storage
  or the parent DOM. Communication uses `postMessage` only.

## Known limitations

- Annotation sidecars are plain JSON next to the artifact; anyone with access to
  the workspace can read or modify them.
- H5 reports execute the report's own JavaScript inside a sandboxed iframe. This
  is intentional (interactive reports), but means a hostile HTML artifact can
  run scripts in an isolated origin — treat agent-generated HTML with the same
  care as any downloaded document.
- The vendored draw.io editor is trusted code shipped with the plugin and is
  not sandboxed from the DSH page. Changes to `editor/` should be reviewed as
  carefully as changes to `index.js`/`client.js`.
- External programs (LibreOffice, draw.io Desktop, Chrome) are trusted local
  applications; their own vulnerabilities are out of scope.
