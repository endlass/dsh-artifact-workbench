# License texts and third-party component index

This directory contains the full license texts for the third-party components
redistributed with Artifact Workbench, plus the copyright lines that must
accompany them.

The repository root (`index.js`, `client.js`, `lib/`, docs) is **MIT** — see
`../LICENSE`. The vendored draw.io web application under `../editor/` remains
under its own licenses (mostly Apache-2.0, with EPL-2.0, CC-BY-4.0, OFL-1.1
and the draw.io icon/stencil additional terms). Nothing under
`../editor/` is relicensed under MIT.

## Texts in this directory

| File | License |
| --- | --- |
| `mit.txt` | MIT (used by many JavaScript components listed below) |
| `apache-2.0.txt` | Apache License 2.0 |
| `zlib.txt` | zlib License (pako's second license) |
| `epl-2.0.txt` | Eclipse Public License 2.0 (ELK) |
| `cc-by-4.0.txt` | Creative Commons Attribution 4.0 (draw.io diagram templates) |
| `OFL-1.1.txt` | SIL Open Font License 1.1 (Architects Daughter font) |

## Component index

Paths are relative to the repository root. "Text" points to the file above that
contains the license; MIT components all share `mit.txt`, but each component's
copyright line is listed here because MIT requires it to be reproduced.

| Component | Version | License | Location | Text | Copyright line(s) |
| --- | --- | --- | --- | --- | --- |
| draw.io web application | 31.4.5 | Apache-2.0 | `editor/` | `apache-2.0.txt` (+ `editor/LICENSE`) | Copyright (c) 2006-2026 JGraph Holdings Ltd and draw.io AG (as stated in source files) |
| dsh-drawioedit (upstream packaging this tree came from) | main `6029d77` (2026-11-05); npm 1.3.0 | Apache-2.0 | `editor/` | `apache-2.0.txt` (+ `editor/NOTICE`) | Copyright 2026 zhang-guo-wen |
| MathJax (core/input/output/extensions) | 4.1.3 | Apache-2.0 | `editor/math4/` | `apache-2.0.txt` | Copyright (c) The MathJax Consortium (see upstream distribution) |
| MathJax web fonts (WOFF2) | 4.1.3 | Apache-2.0 | `editor/math4/es5/fonts/` | `apache-2.0.txt` | Copyright (c) The MathJax Consortium |
| mhchem (MathJax TeX extension) | 4.2.1 | Apache-2.0 | `editor/math4/es5/input/tex/extensions/mhchem.js` | `apache-2.0.txt` | Copyright (c) 2015-2023 Martin Hensel |
| DOMPurify | 3.4.15 | Apache-2.0 **or** MPL-2.0 (this repository elects Apache-2.0) | `editor/js/sanitizer/purify.min.js`; embedded in `editor/js/{app,viewer,viewer-static}.min.js` | `apache-2.0.txt` | Copyright (c) Cure53 and other contributors |
| jQuery | 3.6.0 | MIT | `editor/js/jquery/jquery-3.6.0.min.js` | `mit.txt` | Copyright OpenJS Foundation and other contributors, https://openjsf.org/ |
| JSZip | 3.10.0 | MIT **or** GPL-3.0 (this repository elects MIT) | `editor/js/jszip/jszip.min.js`; embedded in `editor/js/extensions.min.js` | `mit.txt` | Copyright (c) 2009-2016 Stuart Knightley |
| pako | 2.2.0 | MIT **AND** Zlib | `editor/js/deflate/pako.min.js`; embedded in `editor/js/app.min.js` | `mit.txt` + `zlib.txt` | MIT: Copyright (C) 2014-2017 Vitaly Puzrin and Andrei Tuputcyn; Zlib: (C) 1995-2022 Jean-loup Gailly and Mark Adler |
| CryptoJS (trimmed rollup: core/enc-base64/md5/evpkdf/cipher-core/aes) | 4.2.0 | MIT | `editor/js/cryptojs/aes.min.js`; embedded in `editor/js/app.min.js` | `mit.txt` | Copyright (c) 2009-2013 Jeff Mott; Copyright (c) 2013-2016 Evan Vosberg |
| spin.js | banner says 2.0.0; the bundled code is the 1.3.3 minified build (same as upstream draw.io 31.4.5) | MIT | `editor/js/spin/spin.min.js`; embedded in `editor/js/app.min.js` | `mit.txt` | Copyright (c) Felix Gnass |
| rough.js | 4.6.6 | MIT | `editor/js/rough/rough.min.js` | `mit.txt` | Copyright (c) 2019 Preet Shihn |
| perfect-freehand | upstream draw.io build (no version banner; API ≤0.4.x) | MIT | `editor/js/freehand/perfect-freehand.js` | `mit.txt` | Copyright (c) 2021 Stephen Ruiz Ltd |
| simple-peer (with bundled browser shims) | 9.10.0 | MIT | `editor/js/simplepeer/simplepeer9.10.0.min.js`; embedded in `editor/js/app.min.js` | `mit.txt` | Copyright (c) Feross Aboukhadijeh; bundled shims retain their own MIT notices (readable-stream, randombytes, get-browser-rtc, buffer, debug, ms, safe-buffer, string_decoder, inherits, events, process) |
| Dropbox SDK for JavaScript | 2.5.13 | MIT | `editor/js/dropbox/Dropbox-sdk.min.js` | `mit.txt` | Copyright (c) 2016 Dropbox Inc. |
| Microsoft OneDrive JavaScript SDK | JS SDK v7.2 (draw.io-modified copy) | MIT | `editor/js/onedrive/{OneDrive.js,OneDriveOrig.js,mxODPicker.js,mxODPickerV2.js}` | `mit.txt` | Copyright (c) Microsoft Corporation |
| es6-promise (bundled in Dropbox/OneDrive SDKs) | 3.3.1 | MIT | inside `editor/js/dropbox/Dropbox-sdk.min.js`, `editor/js/onedrive/*` | `mit.txt` | Copyright (c) 2014 Yehuda Katz, Tom Dale, Stefan Penner and contributors |
| Mermaid to draw.io bundle | `@drawio/mermaid 0.1.0+commit.7003579` (2026-09-08); the copy embedded in `extensions.min.js` is `0.1.0+commit.be7192b` (2026-08-26) | MIT | `editor/js/mermaid/drawio-mermaid.min.js`; embedded in `editor/js/extensions.min.js` | `mit.txt` | Copyright (c) 2014-2022 Knut Sveidqvist and Mermaid contributors |
| dagre (inside Mermaid bundle) | bundled | MIT | inside Mermaid bundle | `mit.txt` | Copyright (c) 2012-2014 Chris Pettitt |
| graphlib (inside Mermaid bundle) | bundled | MIT | inside Mermaid bundle | `mit.txt` | Copyright (c) 2012-2014 Chris Pettitt |
| lodash (inside Mermaid/dagre bundle) | bundled | MIT | inside Mermaid bundle | `mit.txt` | Copyright OpenJS Foundation and other contributors; based on Underscore.js, copyright Jeremy Ashkenas, DocumentCloud and Investigative Reporters & Editors |
| ELK / elkjs bundle | `@drawio/elk 0.1.0+commit.ddfc94b` (2026-08-27); embedded in `editor/js/extensions.min.js` | EPL-2.0 | `editor/js/elk/drawio-elk.min.js`; embedded in `editor/js/extensions.min.js` | `epl-2.0.txt` (+ `editor/js/elk/LICENSE`, `editor/js/elk/SOURCE.md`) | Copyright (c) Eclipse Foundation, Inc. and contributors (ELK/KIELER project) |
| Bridge.NET runtime | 15.6.0 | Apache-2.0 | `editor/js/orgchart/{bridge.min.js,bridge.collections.min.js}`; `editor/js/orgchart.min.js`; embedded in `editor/js/extensions.min.js` | `apache-2.0.txt` | Copyright 2008-2016 Object.NET, Inc. |
| OrgChart.Layout (Bridge.NET assembly) | bundled | Apache-2.0 | `editor/js/orgchart/OrgChart.Layout.min.js` | `apache-2.0.txt` | Copyright (c) JGraph Holdings Ltd and draw.io AG (draw.io project) |
| PlantUML-to-draw.io converter | `@drawio/plantuml` build (no version banner) | Apache-2.0 | `editor/js/plantuml/drawio-plantuml.min.js` | `apache-2.0.txt` | Copyright (c) 2006-2026 JGraph Ltd |
| Gliffy-to-draw.io converter | `@drawio/gliffy` build (no version banner) | Apache-2.0 | `editor/js/gliffy/drawio-gliffy.min.js` | `apache-2.0.txt` | Copyright (c) 2006-2026 JGraph Ltd |
| WebCola | 3.3.7 | MIT | `editor/plugins/webcola/cola.min.js` | `mit.txt` | Copyright (c) 2013 Tim Dwyer |
| bmp-js | bundled in draw.io VSDS importer | MIT | `editor/js/diagramly/vsdx/bmpDecoder.js` | `mit.txt` | Copyright (c) 2014 shaozilee |
| draw.io stencils / shapes / icon sets | 31.4.5 | Apache-2.0 + draw.io additional terms for icons and stencil libraries | `editor/stencils/`, `editor/shapes/`, `editor/img/` | `apache-2.0.txt` + additional terms in `editor/{img,shapes,stencils}/LICENSE` | Copyright (c) JGraph Holdings Ltd and draw.io AG (as stated in source files) |
| draw.io UI translations | 31.4.5 | Apache-2.0 | `editor/resources/*.txt` | `apache-2.0.txt` | Copyright (c) JGraph Holdings Ltd and draw.io AG / draw.io contributors |
| draw.io diagram templates | 31.4.5 | CC-BY-4.0 | `editor/templates/` | `cc-by-4.0.txt` (+ `editor/templates/ATTRIBUTION.md`) | Copyright (c) JGraph Holdings Ltd and draw.io AG (draw.io project) |
| draw.io branding images and third-party logos | 31.4.5 | see `THIRD-PARTY-NOTICES.md` §Trademarks | `editor/images/` | — | Trademarks of their respective owners; draw.io is a registered EU trademark (#018062448) of draw.io Ltd |
| Architects Daughter font | 1.003 (draw.io 31.4.5 copy) | OFL-1.1 | `editor/styles/fonts/ArchitectsDaughter-Regular.ttf` | `OFL-1.1.txt` | Copyright (c) 2010, Kimberly Geswein (kimberlygeswein.com) |
| python-pptx (runtime, not distributed) | DSH runtime Python | MIT | not in this package; imported at runtime from the DSH runtime | `mit.txt` | Copyright (c) 2013 Steve Canny and python-pptx contributors |
| DSH LibreOffice Kit (runtime peer, not distributed) | ships with DSH | MPL-2.0 | not in this package | see upstream | Copyright (c) 2026 DeepSeek |
| React (host peer, not bundled) | host DSH client | MIT | not in this package | see upstream | Copyright (c) Meta Platforms, Inc. and affiliates |

## Notes

- Components marked "embedded in …" are statically merged into a draw.io bundle
  and are actually executed from there; the standalone files are draw.io's
  build inputs/copies and may not be loaded at runtime.
- `COMPLIANCE.md` records the resolved libavoid removal (0.15.1): the LGPL
  append and `licenses/lgpl-2.1.txt` were removed; `test/editor-license.mjs`
  guards against reintroduction.
- Third-party copyright lines are reproduced as they appear in the upstream
  distributions or package registries. Where upstream ships no explicit
  copyright line, the project attribution above is used; confirm against
  upstream releases when updating the vendored tree.
