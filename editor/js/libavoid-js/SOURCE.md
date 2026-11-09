# libavoid (Adaptagrams) — license, runtime location and source status

`libavoid` is an obstacle-avoiding orthogonal edge router (Adaptagrams project),
licensed under **LGPL-2.1**. A copy of the license text is shipped in this
directory (`LICENSE`) and in `../../licenses/lgpl-2.1.txt`.

## Where the code actually runs

- draw.io builds a pure-JavaScript bundle from libavoid and **statically merges
  it into `editor/js/extensions.min.js`** (the 3.9 MB extensions bundle that
  the editor loads at startup). Symbols such as `initAvoidModule`,
  `ShapeConnectionPin`, `RouterFlag`, `processTransaction` and `computeRoutes`
  are present in `editor/js/extensions.min.js`.
- The file `editor/js/libavoid-js/libavoid.min.js` is the same build kept as a
  standalone copy by draw.io/dsh-drawioedit, but **it is not loaded by the
  editor** (`bootstrap.js` / `index.html` / `main.js` contain no reference to
  it). Shipping it does not change the LGPL obligation: the code inside
  `extensions.min.js` is the copy actually distributed and executed.

## Source availability status (open item)

LGPL-2.1 requires that recipients can obtain the corresponding source of the
library and can replace/relink the library. At the time of the 2026-11-09
license audit:

- the libavoid C++ sources are public at
  <https://github.com/mjwybrow/adaptagrams> / <https://www.adaptagrams.org/>
  (LGPL-2.1);
- however, the draw.io libavoid JavaScript build repository
  (`jgraph/drawio-libavoid`, referenced by draw.io's documentation) returned
  **404 / not publicly available**, so the exact embind binding and build
  scripts used for the committed bundle could not be obtained;
- as a result, the complete corresponding source for the bundled build is
  **not currently published by this repository**.

This is recorded as an open compliance item in `../../COMPLIANCE.md`. The two
paths to close it are:

1. rebuild `editor/js/extensions.min.js` from draw.io 31.4.5 sources **without**
   libavoid (removes the LGPL component), or
2. obtain the libavoid build sources/patches from the draw.io project, publish
   them alongside this repository, and document how to replace the library.

Until one of these is done, do not describe this component as "independent,
runtime-loaded and replaceable", and do not publish the package to npm.
