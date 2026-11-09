# Modifications to the vendored `editor/` tree

`editor/` is a modified copy of the draw.io web application distributed by the
`dsh-drawioedit` project. The upstream provenance is documented in
`PROVENANCE.md`. This file lists the changes made for Artifact Workbench, as
required for derivative works of Apache-2.0 material.

## Relative to `zhang-guo-wen/dsh-drawioedit` main (`6029d77`, 2026-11-05)

- **Added** `editor/LICENSE` — Apache-2.0 text (the upstream package carries its
  license at its own root; we ship a copy inside the vendored tree so the
  license travels with the files).
- **Added** `editor/NOTICE` — retained the upstream `NOTICE` verbatim, with an
  addendum for this repository (see end of the file).
- **Added** `editor/__dsh-bridge.js` — the DSH selection bridge. It is injected
  by the plugin at serve time (`lib/editor-server.mjs`,
  `lib/html-server.mjs`); `editor/index.html` itself is **not** patched.
- **Removed** five `CLAUDE.md` development-note files that came with the
  upstream tree (`editor/js/grapheditor/CLAUDE.md`,
  `editor/js/diagramly/CLAUDE.md`,
  `editor/js/diagramly/sidebar/CLAUDE.md`,
  `editor/js/diagramly/vsdx/CLAUDE.md`,
  `editor/js/libavoid-js/CLAUDE.md`). They were internal agent notes, not
  runtime files.
- **Line endings** normalized to LF where the working copy had CRLF (byte
  differences are limited to line-ending translation; no content changes).
- **License/notice additions** in `editor/js/elk/` and
  `editor/js/libavoid-js/SOURCE.md` (license/source documentation for the
  copyleft components), and `editor/templates/ATTRIBUTION.md` (CC-BY
  attribution).

No other content changes were made to the upstream draw.io/dsh-drawioedit
files. In particular, `editor/js/app.min.js`, `extensions.min.js`,
`viewer*.min.js` and the vendored third-party bundles are byte-identical to the
upstream draw.io 31.4.5 builds (see `PROVENANCE.md`).

## Addendum appended to `editor/NOTICE`

`editor/NOTICE` keeps the upstream text verbatim and appends a clearly
separated addendum stating that this copy is derived from dsh-drawioedit main
and modified as described here, and that corrected statements about branding
and third-party licenses live in `../THIRD-PARTY-NOTICES.md`.
