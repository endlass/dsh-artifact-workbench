# Third-party notices

This repository (the MIT-licensed Artifact Workbench plugin) redistributes a
number of third-party components. This file lists them, their licenses and
where the corresponding license texts live. It is not a license grant for the
components themselves: those remain under their own terms.

The repository root is licensed under MIT (see `LICENSE`). Everything under
`editor/` is a vendored draw.io web application and remains under the licenses
described below; it is *not* relicensed under MIT.

## 1. Bundled / vendored components

| Component | Version / provenance | License | Location |
| --- | --- | --- | --- |
| draw.io web application (Flowchart Maker & Online Diagram Software) | Trimmed copy of <https://github.com/jgraph/drawio>, © 2006–2025 JGraph Holdings Ltd and draw.io AG | Apache-2.0 | `editor/` (`editor/LICENSE`) |
| draw.io editor for DSH (provenance notice retained) | © 2026 zhang-guo-wen; the vendored tree's original NOTICE is kept verbatim | Apache-2.0 | `editor/NOTICE` |
| draw.io stencils / shapes / icon sets | From the draw.io project | Apache-2.0 plus the draw.io additional terms for icons and stencil libraries (see below) | `editor/stencils/`, `editor/shapes/`, `editor/img/` (`LICENSE` in each) |
| draw.io diagram templates | From the draw.io project | CC-BY-4.0 | `editor/templates/` (`editor/templates/LICENSE`) |
| draw.io UI translations | From the draw.io project | Apache-2.0 | `editor/resources/*.txt` |
| libavoid (Adaptagrams obstacle-avoiding orthogonal router), pure-JS build | Built by the draw.io project from <https://github.com/jgraph/drawio-libavoid> (Adaptagrams, <https://www.adaptagrams.org/>) | **LGPL-2.1** | `editor/js/libavoid-js/libavoid.min.js`, license at `editor/js/libavoid-js/LICENSE` |
| MathJax | 4.1.3 | Apache-2.0 | `editor/math4/` |
| MathJax web fonts (WOFF2) | Part of the MathJax distribution | Apache-2.0 | `editor/math4/es5/fonts/` |
| DOMPurify | 3.4.15, © Cure53 and other contributors | Apache-2.0 OR MPL-2.0 (redistributed here under Apache-2.0) | `editor/js/sanitizer/purify.min.js` |
| jQuery | 3.6.0, © OpenJS Foundation and other contributors | MIT | `editor/js/jquery/jquery-3.6.0.min.js` |
| JSZip | 3.10.0, © Stuart Knightley | MIT or GPLv3 (redistributed here under MIT) | `editor/js/jszip/jszip.min.js` |
| pako | 2.2.0, © nodeca | MIT AND Zlib | `editor/js/deflate/pako.min.js` |
| CryptoJS (trimmed rollup: core, enc-base64, md5, evpkdf, cipher-core, aes) | 4.2.0, © Jeff Mott, Evan Vosberg and contributors | MIT | `editor/js/cryptojs/aes.min.js` |
| spin.js | 2.0.0, © Felix Gnass | MIT | `editor/js/spin/spin.min.js` |
| rough.js | 4.6.6 | MIT | `editor/js/rough/rough.min.js` |
| perfect-freehand | © Steve Ruiz | MIT | `editor/js/freehand/perfect-freehand.js` |
| simple-peer | 9.10.0, © Feross Aboukhadijeh | MIT | `editor/js/simplepeer/simplepeer9.10.0.min.js` |
| Dropbox SDK for JavaScript | 2.5.13 | MIT | `editor/js/dropbox/Dropbox-sdk.min.js` |
| Microsoft OneDrive JavaScript SDK | © Microsoft Corporation | MIT (see upstream <https://github.com/microsoft/onedrive-js-sdk>) | `editor/js/onedrive/` |
| ELK layout bundle (`@drawio/elk`) | 0.1.0, © Eclipse Foundation / KIELER project | EPL-2.0 | `editor/js/elk/drawio-elk.min.js` |
| Mermaid bundle (`@drawio/mermaid`) | 0.1.0, © Mermaid contributors | MIT | `editor/js/mermaid/drawio-mermaid.min.js` |
| PlantUML-to-draw.io converter bundle (`@drawio/plantuml`) | © JGraph Ltd | Apache-2.0 (draw.io project); the PlantUML server/runtime is **not** bundled | `editor/js/plantuml/drawio-plantuml.min.js` |
| Gliffy-to-draw.io converter | © JGraph Ltd | Apache-2.0 | `editor/js/gliffy/drawio-gliffy.min.js` |
| Bridge.NET runtime + org-chart layout bundles | Bridge.NET 15.6.0, © Object.NET, Inc. (Apache-2.0); org-chart layout © draw.io project | Apache-2.0 | `editor/js/orgchart/` |
| Architects Daughter font | © 2012 Kimberly Geswein | SIL Open Font License 1.1 | `editor/styles/fonts/ArchitectsDaughter-Regular.ttf`, full text in `licenses/OFL-1.1.txt` |

`editor/` is a *modified* copy of the draw.io web application: `WEB-INF/`,
cloud-storage integration scripts, legacy unminified mxGraph sources, the
service worker, some stencil/icon libraries and development sources were
removed; `editor/index.html` is patched to inject the DSH bridge
(`editor/__dsh-bridge.js`); `js/stencils.min.js` was regenerated from the
retained core stencil XML files and `templates/index.xml` lists only the
retained templates. See `editor/NOTICE` for the upstream-compatible notice.

### draw.io additional terms for icons and stencils

From the draw.io project (reproduced in `editor/stencils/LICENSE`,
`editor/shapes/LICENSE` and `editor/img/LICENSE`):

> The icon sets and stencil libraries included in this software, and any
> derivatives thereof (including conversions to other formats, traced
> reproductions, substantially similar visual representations, or AI-generated
> images created using these icons as reference or training input), may not be
> used as software assets in, distributed for use with, or incorporated into
> Atlassian products or products distributed through the Atlassian marketplace
> or plugin ecosystem, without explicit written permission. This restriction
> does not apply to end-user diagram output (such as exported images or
> documents) created using this software.

### LGPL-2.1 compliance note (libavoid)

`editor/js/libavoid-js/libavoid.min.js` is a self-contained jQuery-free
JavaScript bundle generated by the draw.io project from the LGPL-2.1 libavoid
sources. In this repository it is shipped as an independent, unmodified file
loaded at runtime by the draw.io editor, so it can be replaced by the user with
a compatible build. The LGPL-2.1 text is included at
`editor/js/libavoid-js/LICENSE`; corresponding sources are available at
<https://github.com/jgraph/drawio-libavoid> and <https://www.adaptagrams.org/>.

## 2. Not redistributed — external programs invoked at runtime

The plugin can optionally call local programs. They are **not** bundled in this
repository or npm package:

| Program | Used for | License (upstream) |
| --- | --- | --- |
| LibreOffice (desktop app) | "Open in LibreOffice" external editing | MPL-2.0 |
| draw.io Desktop | page-image rendering for `.drawio` / Mermaid artifacts | Apache-2.0 |
| Google Chrome / Chromium | HTML → PDF snapshot for H5 report annotation | BSD-3-Clause and others |
| Feishu `lark-cli` (optional) | Feishu document/comment integration | Apache-2.0 |

PPTX/PDF rendering itself uses the LibreOffice Kit (`@deepseek-ai/libreoffice-kit`,
MPL-2.0) that ships with the DeepSeek Harness desktop application; it is a peer
runtime, not a dependency of this package.

## 3. Peer runtime contract

The client half is a DSH plugin and consumes the DeepSeek Harness sidebar
contract at runtime (MIT, © 2026 DeepSeek). No `@deepseek-ai/*` package is
vendored or bundled here.

## 4. Trademarks

- "draw.io" is a registered EU trademark (#018062448) of draw.io Ltd. This is
  an independent integration, not affiliated with, endorsed by or sponsored by
  draw.io Ltd. No draw.io logo or branding is used.
- Other product names (Feishu/Lark, LibreOffice, Chrome, Chromium, Dropbox,
  Microsoft OneDrive, PlantUML, Mermaid, ELK, MathJax) are trademarks or
  registered trademarks of their respective owners and are used only for
  identification.
