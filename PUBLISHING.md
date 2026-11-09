# Publishing

This file is the maintainer checklist for cutting a release. The repository is
public at <https://github.com/endlass/dsh-artifact-workbench> and
`dsh-artifact-workbench@0.15.1` is published on npm (2026-11-10).

## Current status

- Version: see `package.json` (`0.15.1`).
- Licensing: MIT for this project; `editor/` remains draw.io/Apache-2.0 and
  friends — see `THIRD-PARTY-NOTICES.md`.
- **License gate (2026-11-10, updated for 0.15.1):** the libavoid LGPL-2.1
  blocker is resolved — the editor bundle no longer contains libavoid. The
  remaining ELK (EPL-2.0) and PlantUML converter provenance items are documented
  as medium risk in `COMPLIANCE.md`; have counsel review them before commercial
  distribution. No LGPL component remains in the package.
- Package name: `dsh-artifact-workbench` (renamed from `dsh-ppt-workbench` in
  0.15.0; see `MIGRATION.md`; 0.15.1 removes libavoid and drops the
  Orthogonal Routing layout action).
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
- Keep the renderer key / tab ids (`dsh-artifact-workbench/*`) for one release cycle
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
git tag -a v0.15.1 -m "Artifact Workbench v0.15.1"
git push origin v0.15.1
gh release create v0.15.1 --notes-from-tag
```

## Post-publish verification

1. `npm view dsh-artifact-workbench@0.15.1 dist.tarball` returns the tarball.
2. Clean profile: `install_bundle target dsh-artifact-workbench@0.15.1` → open a
   `.pptx`, add an annotation, save an edit, reload the tab.
3. Static asset routes work: draw.io editor iframe loads, H5 report iframe
   loads, PDF page images render.
4. `npm pack` size stays in the ~12 MB (compressed) range; if it grows
   noticeably, revisit the vendor-splitting proposal below.

## Naming migration (done in 0.15.0)

0.15.0 renamed the package/plugin from `dsh-ppt-workbench` to
`dsh-artifact-workbench`. Consequences for a release:

1. The npm package name is `dsh-artifact-workbench`; the old name was never
   published to npm, so there is no old package to deprecate.
2. Install with `install_bundle target dsh-artifact-workbench@0.15.1`; existing
   profiles that `link:` the repo must update the profile dependency name.
3. Renderer/tab keys and API routes changed; tabs opened before the upgrade must
   be reopened once. Annotation sidecars (`<artifact>.workbench/`) are keyed by
   file path and are unaffected.
4. `$DSH_HOME/storages/dsh-ppt-workbench` is migrated to
   `$DSH_HOME/storages/dsh-artifact-workbench` on first start (unless an explicit
   `ARTIFACT_WORKBENCH_STORAGE`/legacy `PPT_WORKBENCH_STORAGE` is set).
5. Legacy `PPT_WORKBENCH_*` environment variables are still read; new
   `ARTIFACT_WORKBENCH_*` names take precedence.

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

Any such split must keep the Apache-2.0/NOTICE files, the EPL-2.0/ELK notices and
the libavoid-removal note intact and documented in `THIRD-PARTY-NOTICES.md`.
