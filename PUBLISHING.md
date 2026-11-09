# Publishing

This file is the maintainer checklist for cutting a release. Nothing in the
"Commands" section has been executed in this working copy: the repository has no
remote yet and no package has been published to npm.

## Current status

- Version: see `package.json` (`0.14.5`).
- Licensing: MIT for this project; `editor/` remains draw.io/Apache-2.0 and
  friends — see `THIRD-PARTY-NOTICES.md`.
- **License gate (2026-11-10):** `COMPLIANCE.md` item 1 (libavoid LGPL-2.1
  source/replaceability) must be resolved before `npm publish` or attaching a
  GitHub Release asset. Shipping the repo as public source is allowed with the
  disclosure in `THIRD-PARTY-NOTICES.md`.
- Package name: `dsh-ppt-workbench` (kept for compatibility, see the naming
  migration note below).
- Distribution channel: DSH bundle install (`install_bundle`), not a plain
  `npm install`.

## Pre-release checklist

1. `npm run check` — syntax check passes.
2. `npm run test:smoke` — starts from a clean checkout.
3. `npm test` on a machine with the DSH desktop app (LibreOffice Kit +
   python-pptx), draw.io Desktop and Chrome — all 18 tests pass.
4. `npm pack --dry-run` — inspect file list; `LICENSE`,
   `THIRD-PARTY-NOTICES.md`, `SECURITY.md`, `editor/` and `lib/` must be inside;
   `test/` must not be.
5. `git status` is clean and the working tree contains no local paths,
   credentials or generated decks.
6. `CHANGELOG.md` has an entry for the version and the version in
   `package.json` matches the tag you are about to create.
7. DSH compatibility re-check: fresh profile → install the tarball → open one
   `.pptx`, one `.pdf`, one `.html` and one `.drawio`; verify annotations,
   auto-save, and "open externally".
8. Run a DSH plugin compatibility audit (E0–E3 style checks) on both the rc and
   alpha DSH lines.

## Versioning

- SemVer. Package `0.x`: minor bump for user-visible features/breaking format
  changes, patch bump for fixes and docs/open-source plumbing.
- Keep the annotation sidecar schema (`dsh-artifact-annotation@2`) and the
  legacy `dsh-ppt-annotation@1` migration path for at least one minor version.
- Keep the renderer key / tab ids (`dsh-ppt-workbench/*`) for one release cycle
  after any rename.

## Commands (NOT EXECUTED)

Create the GitHub repository and push (run only after the maintainer confirms
the target org/repository URL in `package.json`):

```bash
# from the repository root
gh repo create endlass/dsh-artifact-workbench --public --source=. --remote=origin
git push -u origin main
```

npm publish (requires the maintainer's npm login and 2FA):

```bash
npm login
npm publish --access public
npm pack --dry-run   # check output first
```

Tag and GitHub release:

```bash
git tag -a v0.14.5 -m "Artifact Workbench v0.14.5"
git push origin v0.14.5
gh release create v0.14.5 --notes-from-tag
```

## Post-publish verification

1. `npm view dsh-ppt-workbench@0.14.5 dist.tarball` returns the tarball.
2. Clean profile: `install_bundle target dsh-ppt-workbench@0.14.5` → open a
   `.pptx`, add an annotation, save an edit, reload the tab.
3. Static asset routes work: draw.io editor iframe loads, H5 report iframe
   loads, PDF page images render.
4. `npm pack` size stays in the ~12 MB (compressed) range; if it grows
   noticeably, revisit the vendor-splitting proposal below.

## Naming migration note (future work)

The project is branded Artifact Workbench while the npm package/plugin id remain
`dsh-ppt-workbench`. If the package is ever renamed to
`dsh-artifact-workbench`:

1. Declare the new package name and keep the old renderer key / body key /
   sidecar schema as aliases for one version.
2. Keep reading old annotation sidecars (`dsh-artifact-annotation@2` already
   covers the v1 migration).
3. Verify with a fresh profile that old tabs and old sidecars still work.
4. Deprecate the old package with a note pointing to the new one.
5. Only then remove the old keys and routes.

## Packaging note: `editor/` vendor

`npm pack` is ~11.5 MB compressed / ~43 MB unpacked, of which ~42 MB unpacked is
the trimmed draw.io webapp in `editor/` (770 files). It is included because the
plugin must work offline and install as a single bundle. Options if the size
becomes a problem (not implemented in this release):

- move `editor/` to a separate asset package (e.g. `@dsh-artifact-workbench/drawio-editor`)
  resolved at install time, keeping the JS bundle small;
- trim further in `editor/` (already trimmed: WEB-INF, cloud integrations,
  legacy unminified sources, specialist stencils);
- publish the vendor tree as a GitHub release artifact and download it on first
  use (needs network and a hash check, breaks offline-by-default).

Any such split must keep the Apache-2.0/NOTICE files and the LGPL-2.1 libavoid
file intact and documented in `THIRD-PARTY-NOTICES.md`.
