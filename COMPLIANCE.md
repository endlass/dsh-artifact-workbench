# Compliance status (2026-11-10)

This file tracks third-party license obligations for the repository. Detailed
component data is in `licenses/README.md`; the upstream provenance and license
obligation analysis are in `editor/PROVENANCE.md`,
`editor/js/elk/SOURCE.md`, `editor/js/libavoid-js/SOURCE.md`, and the audit
reports referenced at the bottom.

> This is an engineering compliance record, not legal advice. Have counsel
> review the LGPL/EPL items before commercial distribution.

## Fixed in the 2026-11-10 licensing pass

- [x] Full license texts added under `licenses/`: MIT, Apache-2.0, Zlib,
      EPL-2.0, LGPL-2.1, CC-BY-4.0, OFL-1.1.
- [x] Per-component copyright lines and locations added to
      `licenses/README.md`; notices rewritten to match the actual vendored
      tree (`THIRD-PARTY-NOTICES.md`).
- [x] EPL-2.0 license text added to `editor/js/elk/LICENSE`; ELK source
      description added in `editor/js/elk/SOURCE.md`.
- [x] LGPL-2.1 text already shipped; runtime location and the open
      source-availability item documented in
      `editor/js/libavoid-js/SOURCE.md`.
- [x] CC-BY-4.0 template attribution added in
      `editor/templates/ATTRIBUTION.md`.
- [x] MIT/Zlib/MPL alternatives clarified (JSZip→MIT, DOMPurify→Apache-2.0,
      pako→MIT+Zlib).
- [x] Provenance and modification records added (`editor/PROVENANCE.md`,
      `editor/MODIFICATIONS.md`); upstream NOTICE retained verbatim with an
      addendum.
- [x] Notices corrected: draw.io 31.4.5 / dsh-drawioedit 1.3.0-main versions,
      spin.js actual bundled version (1.3.3), `index.html` is not patched
      (bridge is injected server-side), branding statement corrected to
      reflect retained upstream assets, missing components added (WebCola,
      bmp-js, dagre/graphlib/lodash, es6-promise, Emscripten runtime,
      `orgchart.min.js`, python-pptx / React as runtime peers).
- [x] OFL copyright line corrected to the font's embedded name-table data
      (2010, no Reserved Font Name) and "unmodified" claim replaced with a
      hash-pinned source statement.
- [x] Internal `CLAUDE.md` development notes removed from the vendored tree.

## Open items

| # | Item | Severity | Status / next action |
| --- | --- | --- | --- |
| 1 | **libavoid (LGPL-2.1)**: code is statically merged into `editor/js/extensions.min.js`; the draw.io libavoid build sources (`jgraph/drawio-libavoid`) are not publicly available, so LGPL §6 source/replaceability obligations are not satisfied | **Blocker for npm/Release distribution** | Either (A) rebuild `extensions.min.js` from draw.io 31.4.5 without libavoid, or (B) obtain the build sources/patches from the draw.io project and publish them with a replacement procedure. Until then: repository may be public, but do not `npm publish` / ship Release assets. |
| 2 | **ELK (EPL-2.0)**: license text and source description now present; the `@drawio/elk` wrapper build sources are not published by draw.io, only the Eclipse ELK upstream sources are available | Medium | Accept as-is with the documented source pointer, or remove ELK when rebuilding the editor. |
| 3 | **PlantUML-to-draw.io converter**: no banner/license text in the bundle; built by draw.io from a non-public repository; upstream PlantUML itself is GPL-3.0 (draw.io's port appears to be based on the Apache-2.0 `plantuml-asl` edition) | Medium | Keep the Apache-2.0 attribution as documented; verify with the draw.io project, or drop the converter from the editor build. |
| 4 | **Copyright lines that upstream does not expose** (MathJax Consortium year range, Adaptagrams copyrights, some Mermaid/dagre transitive packages) | Low | Confirm against upstream release artifacts when updating the vendored tree. |
| 5 | **`editor/images/` draw.io/third-party brand logos** are retained from upstream | Low (trademark) | Keep the "not affiliated" disclaimer; do not use draw.io logos in the project's own branding. Optionally trim unused logos. |

## Distribution policy

- **GitHub public source**: allowed. The repository is a truthful record of the
  upstream components, but item 1 above must be disclosed (it is, in
  `THIRD-PARTY-NOTICES.md` and `editor/js/libavoid-js/SOURCE.md`).
- **npm publish / GitHub Release**: **blocked until item 1 is resolved**.
- If the embedded draw.io editor is removed from the distribution (option G in
  the audit report), items 1–5 mostly disappear and the repository becomes a
  plain MIT plugin; this is the cleanest path if the embedded editor is not a
  must-have.

## Audit reports (working notes, not shipped)

- `reports/artifact-workbench-license-audit-20261109.md` — consolidated audit
- `reports/artifact-workbench-license-inventory.md` — component/text inventory
- `reports/artifact-workbench-license-legal.md` — obligation matrix and
  remediation plan
