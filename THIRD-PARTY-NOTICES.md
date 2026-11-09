# Third-party notices

This repository combines:

- **first-party code** (plugin host/client, docs, tests) licensed **MIT** — see
  `LICENSE`;
- a **vendored draw.io web application** under `editor/`, which remains under
  its own licenses (Apache-2.0, plus EPL-2.0, LGPL-2.1, CC-BY-4.0, OFL-1.1 and
  the draw.io icon/stencil additional terms). Nothing under `editor/` is
  relicensed under MIT.

The **full component inventory, per-component copyright lines and the license
texts** are in [`licenses/README.md`](licenses/README.md) and `licenses/`.
This file summarises provenance, obligations and the current compliance
status (see also [`COMPLIANCE.md`](COMPLIANCE.md)).

## 1. Provenance

- `editor/` is derived from the **draw.io web application v31.4.5**
  (<https://github.com/jgraph/drawio>, Apache-2.0, © JGraph Holdings Ltd and
  draw.io AG) as packaged by the DSH plugin **`dsh-drawioedit`**
  (<https://github.com/zhang-guo-wen/dsh-drawioedit>, npm
  `@guowenzhang/dsh-drawioedit`, Apache-2.0, © 2026 zhang-guo-wen).
- The exact copy corresponds to `dsh-drawioedit` **main commit `6029d77`
  (2026-11-05)** (npm 1.3.0 is a slightly older snapshot).
- `editor/NOTICE` is retained verbatim from the upstream project; its addendum,
  the modification list and the verified hashes are in
  [`editor/PROVENANCE.md`](editor/PROVENANCE.md) and
  [`editor/MODIFICATIONS.md`](editor/MODIFICATIONS.md).
- `editor/index.html` is **not** patched: the DSH bridge
  (`editor/__dsh-bridge.js`) is injected by the plugin's server when the editor
  is served (`lib/editor-server.mjs`, `lib/html-server.mjs`).

## 2. License texts in this repository

| Text | File |
| --- | --- |
| MIT | `licenses/mit.txt` |
| Apache-2.0 | `licenses/apache-2.0.txt` (and `editor/LICENSE`) |
| Zlib (pako's second license) | `licenses/zlib.txt` |
| EPL-2.0 (ELK) | `licenses/epl-2.0.txt` (and `editor/js/elk/LICENSE`) |
| LGPL-2.1 (libavoid) | `licenses/lgpl-2.1.txt` (and `editor/js/libavoid-js/LICENSE`) |
| CC-BY-4.0 (draw.io templates) | `licenses/cc-by-4.0.txt` (and `editor/templates/LICENSE`) |
| OFL-1.1 (Architects Daughter) | `licenses/OFL-1.1.txt` |

## 3. Component summary

### 3.1 draw.io web application and assets (`editor/`)

| Component | Version | License |
| --- | --- | --- |
| draw.io web application (app/extensions/viewer bundles, JS, resources) | 31.4.5 | Apache-2.0 |
| dsh-drawioedit (upstream packaging) | main `6029d77` | Apache-2.0 |
| draw.io stencils / shapes / icon sets | 31.4.5 | Apache-2.0 **plus** the additional terms quoted in §4 |
| draw.io diagram templates | 31.4.5 | CC-BY-4.0 (attribution in `editor/templates/ATTRIBUTION.md`) |
| draw.io UI translations | 31.4.5 | Apache-2.0 |
| draw.io branding/UI images and third-party logos | 31.4.5 | trademarks of their owners; see §6 |

### 3.2 Third-party JavaScript components

| Component | Version | License | Location |
| --- | --- | --- | --- |
| MathJax + web fonts | 4.1.3 | Apache-2.0 | `editor/math4/` |
| mhchem (MathJax extension) | 4.2.1 | Apache-2.0 | `editor/math4/es5/input/tex/extensions/mhchem.js` |
| DOMPurify | 3.4.15 | Apache-2.0 (elected; alternative MPL-2.0) | `editor/js/sanitizer/purify.min.js`; embedded in `app/viewer*.min.js` |
| jQuery | 3.6.0 | MIT | `editor/js/jquery/` |
| JSZip | 3.10.0 | MIT (elected; alternative GPL-3.0) | `editor/js/jszip/`; embedded in `extensions.min.js` |
| pako | 2.2.0 | MIT **AND** Zlib | `editor/js/deflate/`; embedded in `app.min.js` |
| CryptoJS (trimmed rollup) | 4.2.0 | MIT | `editor/js/cryptojs/`; embedded in `app.min.js` |
| spin.js | banner says 2.0.0; bundled code is 1.3.3 (upstream draw.io ships it this way) | MIT | `editor/js/spin/`; embedded in `app.min.js` |
| rough.js | 4.6.6 | MIT | `editor/js/rough/` |
| perfect-freehand | up to 0.4.x (no version banner) | MIT | `editor/js/freehand/` |
| simple-peer (+ bundled shims) | 9.10.0 | MIT | `editor/js/simplepeer/`; embedded in `app.min.js` |
| Dropbox SDK for JavaScript | 2.5.13 | MIT | `editor/js/dropbox/` |
| Microsoft OneDrive JavaScript SDK (+ es6-promise 3.3.1) | JS SDK v7.2 (draw.io-modified) | MIT | `editor/js/onedrive/` |
| Mermaid to draw.io bundle | `@drawio/mermaid 0.1.0+commit.7003579` (embedded copy: `+commit.be7192b`) | MIT | `editor/js/mermaid/`; embedded in `extensions.min.js` |
| dagre / graphlib / lodash (inside Mermaid bundle) | bundled | MIT | inside the Mermaid bundle |
| Bridge.NET runtime | 15.6.0 | Apache-2.0 | `editor/js/orgchart/`, `editor/js/orgchart.min.js`; embedded in `extensions.min.js` |
| OrgChart.Layout (Bridge.NET assembly) | bundled | Apache-2.0 | `editor/js/orgchart/OrgChart.Layout.min.js` |
| PlantUML-to-draw.io converter | `@drawio/plantuml` build (no version banner) | Apache-2.0 | `editor/js/plantuml/` |
| Gliffy-to-draw.io converter | `@drawio/gliffy` build (no version banner) | Apache-2.0 | `editor/js/gliffy/` |
| WebCola | 3.3.7 | MIT | `editor/plugins/webcola/cola.min.js` |
| bmp-js | bundled in VSDS importer | MIT | `editor/js/diagramly/vsdx/bmpDecoder.js` |
| Emscripten runtime (compiled into libavoid bundle) | bundled | MIT | inside the libavoid bundle |
| Architects Daughter font | 1.003 | OFL-1.1 | `editor/styles/fonts/ArchitectsDaughter-Regular.ttf` |

A number of these are statically merged into the draw.io bundles
(`editor/js/app.min.js`, `editor/js/extensions.min.js`,
`editor/js/viewer*.min.js`); they are executed from those bundles. The full
per-component copyright lines are in `licenses/README.md`.

## 4. draw.io additional terms for icons and stencil libraries

Reproduced from the draw.io project (also shipped in
`editor/{img,shapes,stencils}/LICENSE`):

> The icon sets and stencil libraries included in this software, and any
> derivatives thereof (including conversions to other formats, traced
> reproductions, substantially similar visual representations, or AI-generated
> images created using these icons as reference or training input), may not be
> used as software assets in, distributed for use with, or incorporated into
> Atlassian products or products distributed through the Atlassian marketplace
> or plugin ecosystem, without explicit written permission. This restriction
> does not apply to end-user diagram output (such as exported images or
> documents) created using this software.

This project is not an Atlassian product; the restriction is retained for
downstream users. The icon/stencil files are not relicensed under MIT.

## 5. Copyleft components

### 5.1 ELK / elkjs — EPL-2.0

`@drawio/elk 0.1.0+commit.ddfc94b` (built 2026-08-27), embedded in
`editor/js/extensions.min.js`. EPL-2.0 license text:
`editor/js/elk/LICENSE` / `licenses/epl-2.0.txt`; source description:
`editor/js/elk/SOURCE.md`. EPL-2.0 is a weak copyleft: it applies to the ELK
component, not to the MIT-licensed plugin code. ELK upstream source:
<https://github.com/eclipse/elk>.

### 5.2 libavoid (Adaptagrams) — LGPL-2.1

The pure-JS libavoid build is statically merged into
`editor/js/extensions.min.js`; the standalone copy at
`editor/js/libavoid-js/libavoid.min.js` is **not loaded at runtime**. LGPL-2.1
text: `editor/js/libavoid-js/LICENSE` / `licenses/lgpl-2.1.txt`. The upstream
Adaptagrams C++ sources are public (LGPL-2.1), but the draw.io JavaScript build
repository (`jgraph/drawio-libavoid`) was not publicly available at audit time,
so the complete corresponding source for the bundled build is **not currently
published here**. This open item is tracked in `COMPLIANCE.md`; distribution via
npm/Release is blocked until it is resolved (rebuild without libavoid, or obtain
and publish the build sources). See `editor/js/libavoid-js/SOURCE.md`.

### 5.3 No GPL/AGPL content in this distribution

The PlantUML runtime itself (GPL-3.0) is **not** bundled; only draw.io's
Apache-2.0 converter bundle is present. No AGPL code was found. The only
copyleft components are the EPL-2.0 (ELK) and LGPL-2.1 (libavoid) items above.
The PlantUML converter's provenance is an open item in `COMPLIANCE.md`.

## 6. Trademarks

- **draw.io** is a registered EU trademark (#018062448) of draw.io Ltd. This
  project is an independent integration and is **not affiliated with, endorsed
  by or sponsored by draw.io Ltd**. The vendored `editor/` tree retains the
  upstream draw.io UI branding/assets for functional fidelity; this project
  does **not** use draw.io logos/branding as its own project identity (the
  plugin icon is original) and must not be presented as an official draw.io
  product.
- Other product names and logos appearing in the vendored UI or this
  documentation (Feishu/Lark, LibreOffice, Chrome/Chromium, Dropbox, Microsoft
  OneDrive, PlantUML, Mermaid, ELK, MathJax, GitHub, GitLab, Google Drive,
  Confluence, Trello, Atlassian) are trademarks or registered trademarks of
  their respective owners and are used only as shipped by upstream or for
  identification.

## 7. Not redistributed — runtime dependencies

These are **not** bundled in this repository or npm package; they are external
programs or peer runtimes:

| Dependency | Used for | License (upstream) |
| --- | --- | --- |
| DSH LibreOffice Kit (`@deepseek-ai/libreoffice-kit`, ships with DSH) | PPTX/PDF page rendering | MPL-2.0 |
| python-pptx (DSH runtime Python) | PPTX inventory/editing | MIT |
| LibreOffice desktop app | "Open in LibreOffice" external editing | MPL-2.0 and others |
| draw.io Desktop | `.drawio`/`.mmd` page-image export | Apache-2.0 |
| Google Chrome / Chromium | HTML → PDF snapshot | BSD-3-Clause and others |
| Feishu `lark-cli` (optional) | Feishu document/comment integration | Apache-2.0 |
| React (host DSH client peer) | client UI | MIT |

The client half consumes the DSH sidebar contract at runtime; no
`@deepseek-ai/*` package is vendored or bundled here.

## 8. Compliance status

The 2026-11-10 licensing pass added the missing license texts, restored correct
attribution, corrected the earlier notices, and documented provenance. The one
**blocking** open item is the libavoid LGPL-2.1 source/replaceability issue
(§5.2). See [`COMPLIANCE.md`](COMPLIANCE.md) for the status table and the
two remediation options. **Do not publish this package to npm / attach it to a
GitHub Release until that item is resolved.**
