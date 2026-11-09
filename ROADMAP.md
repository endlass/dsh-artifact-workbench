# Artifact Workbench — Roadmap

Updated 2026-11-09 for v0.14.5. The project name is Artifact Workbench; the
package/plugin id remains `dsh-ppt-workbench` for compatibility (see
`PUBLISHING.md`).

## What exists today

- PPTX workbench: page-image preview, shape/area/multi-select annotations with
  anchor repair, structured and inline editing, auto-save, undo/redo, external
  LibreOffice editing.
- PDF workbench: page preview and page/area annotations (read-only).
- H5 workbench: report HTML in a sandboxed iframe with DOM-selector annotations
  (read-only, source untouched).
- draw.io: embedded offline editor, node (mxCell) and diagram-level annotations,
  source save with conflict handling.
- Mermaid: page-image preview, annotation and source editing with backups.
- Optional Feishu docx/wiki integration: read-only mirror, comments, native
  page open, device-flow OAuth.
- Open-source packaging: MIT license, third-party notices, security policy,
  bilingual README, CI (smoke tests + package checks), self-contained synthetic
  fixtures.

## Next

1. **Release plumbing** — create GitHub repo, push `main`, publish `0.14.5` to
   npm, set up GitHub Releases. (Not executed in this working copy.)
2. **Vendor size** — decide whether to split `editor/` (draw.io webapp, ~42 MB
   unpacked) into a separate asset package; keep NOTICE/LICENSE intact.
3. **Editing quality** — dirty-page incremental rendering after save; group
   shape editing; picture replacement; better rotated-shape hit testing.
4. **PDF** — text layer selection/search and text-quote anchors.
5. **Platform coverage** — end-to-end verification on Windows and Linux
   (external program detection, native open, editor iframe).
6. **Examples** — screenshots/GIF and a minimal example deck for the README.
7. **Naming** — optional migration to `dsh-artifact-workbench` with one release
   of alias compatibility.

## Explicit non-goals

- Editing `.pdf` / `.html` sources (annotation only).
- Editing group children, animations, transitions, SmartArt or media in PPTX.
- A full native in-panel LibreOffice editor (the DSH app integration needed for
  that is out of scope; structured editing + external LibreOffice is the
  fallback).
- Taking over `.xlsx` preview.
