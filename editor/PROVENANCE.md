# Provenance of the vendored `editor/` tree

This directory contains a vendored copy of the draw.io web application as
packaged by the DSH plugin `dsh-drawioedit`. It is **not** a clean export of
`jgraph/drawio` and it is not relicensed under this repository's MIT license.

## Upstream chain

1. **draw.io web application** — <https://github.com/jgraph/drawio>, version
   **31.4.5** (`mxClient.VERSION` / `EditorUi.VERSION` in
   `editor/js/app.min.js`; key files are byte-identical to the upstream
   `v31.4.5` tree, e.g. `editor/js/app.min.js` SHA-256
   `05344dcc120938e295e4b81c9ab3c8ec266a0d0264e59ae28fc54795bd2a3a2b`).
   Apache-2.0, © JGraph Holdings Ltd and draw.io AG.
2. **dsh-drawioedit** — <https://github.com/zhang-guo-wen/dsh-drawioedit>
   (npm `@guowenzhang/dsh-drawioedit`), a DSH plugin that trims the draw.io
   webapp for sidebar use and ships it as its `editor/` tree. Apache-2.0,
   © 2026 zhang-guo-wen. The copy in this repository corresponds to
   **main branch commit `6029d77801f3169c0e3bddf6412dc200680be3be`
   (2026-11-05)**; package version **1.3.0** is a slightly older snapshot
   (`editor/js/app.min.js` differs from 1.3.0 but matches main).
3. **This repository (Artifact Workbench)** — derives its `editor/` from step 2
   and adds a small number of files/edits. See `MODIFICATIONS.md`.

## How the tree was verified

- `editor/js/app.min.js`, `editor/js/viewer.min.js`,
  `editor/js/viewer-static.min.js`, `editor/index.html`,
  `editor/js/bootstrap.js`, the third-party bundles under `editor/js/*/`, the
  license files under `editor/{img,shapes,stencils,templates}` and
  `editor/math4/es5/{startup,core}.js` were compared byte-for-byte against
  `jgraph/drawio@v31.4.5`: identical (except line-ending normalization where the
  working copy converted CRLF→LF).
- `editor/js/extensions.min.js` is **modified**: the upstream v31.4.5 file
  (SHA-256 `06dd7eea…`) is the source, and its libavoid append
  (`libavoid.min.js` + `libavoid-routing.js` + `LibavoidRouting.js`, 627,678
  bytes) was removed. The generated bundle is produced by
  `scripts/build-drawio-extensions.mjs`; current output SHA-256
  `b293c086ba22ae1f2bcb5e2bdde5ae6f1cb8f15d9f92c05b6e6b113a37aa28e9`.
  See `MODIFICATIONS.md`.
- `editor/NOTICE` is byte-identical to the `NOTICE` shipped by
  `@guowenzhang/dsh-drawioedit` 1.3.0 (4,087 bytes).
- `editor/styles/fonts/ArchitectsDaughter-Regular.ttf` matches the draw.io
  31.4.5 copy (SHA-256
  `8116fb167643f707c4a99f544e9bcdb9cb7ba00c0a72c9bbc9e0b20966ed9810`).
- The standalone `editor/js/libavoid-js/` tree is no longer present in this
  repository (removed in 0.15.1); it existed only as a second copy of the
  libavoid append.
- The 5 `CLAUDE.md` files that came with the dsh-drawioedit tree were removed
  during open-source preparation (they are development notes, not part of the
  runtime); see `MODIFICATIONS.md`.

## Updating this tree

When refreshing `editor/` from a newer draw.io or dsh-drawioedit release:

1. record the new draw.io and dsh-drawioedit versions/commits above;
2. re-run the byte comparison and update the SHA-256 values;
3. re-check the third-party component inventory in
   `../THIRD-PARTY-NOTICES.md` and `../licenses/README.md` (new draw.io
   releases may add/remove components);
4. update `MODIFICATIONS.md` and re-run `scripts/build-drawio-extensions.mjs`;
5. re-run `node test/editor-license.mjs` and confirm the bundle has no libavoid.
