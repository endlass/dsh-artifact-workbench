# Tests

Every test is a plain `node` script (`node test/<name>.mjs`); no test runner or
npm dependency is required.

- `npm run check` — syntax-check every hand-written JS file.
- `npm run test:smoke` — the dependency-free subset that also runs in CI.
- `npm test` — the full suite; several tests need the local DSH desktop
  application and/or locally installed programs (see the matrix below).

## Environment requirements

| Requirement | Why | Env override |
| --- | --- | --- |
| `@deepseek-ai/libreoffice-kit` from the installed DSH desktop app | PPTX/PDF page rendering + inventory (`inventory.py`) | `DSH_RESOURCES` / `ARTIFACT_WORKBENCH_RESOURCES` |
| python-pptx in the DSH runtime Python | PPTX inventory and structured edit ops | `ARTIFACT_WORKBENCH_PYTHON` |
| LibreOffice.app (macOS) / libreoffice (other) | only `open-native` dry-run tests; not needed by the rest | `ARTIFACT_WORKBENCH_LIBREOFFICE` |
| draw.io Desktop | `.drawio`/`.mmd` page rendering (`diagram-smoke`, `source-http`) | `ARTIFACT_WORKBENCH_DRAWIO` |
| Chrome/Chromium | HTML → PDF snapshots (`html-smoke`) | `ARTIFACT_WORKBENCH_CHROME` |
| bash | `test/feishu-smoke.mjs` runs a fake `lark-cli` fixture | — |

Fixtures are synthetic: `test/fixtures/deck-v1.pptx` (12-slide python-pptx test
deck), `test/fixtures/deck-v1-lort.pptx` (LibreOffice round-trip variant),
`test/fixtures/sample-report.{html,pdf}` (two-page report used for H5/PDF
pipelines). No real business documents or personal data are included.

Tests write only to OS temp directories and the plugin storage root
(`$DSH_HOME/storages/dsh-artifact-workbench`, override with
`ARTIFACT_WORKBENCH_STORAGE`).

## Matrix

| Test | CI smoke | Needs |
| --- | --- | --- |
| `editor-assets.mjs` | ✅ | — |
| `drawio-annotations.mjs` | ✅ | — |
| `html-artifact.mjs` | ✅ | — |
| `feishu-smoke.mjs` | ✅ | bash |
| `feishu-oauth.mjs` | ✅ | — |
| `p0-regression.mjs` | ✅ | — |
| `history-immutable.mjs` | ✅ | deck fixture |
| `host-smoke.mjs` | — | DSH LibreOffice Kit + python-pptx |
| `annotation-multi.mjs` | — | DSH LibreOffice Kit |
| `annotation-concurrency.mjs` | — | DSH LibreOffice Kit |
| `annotation-schema.mjs` | — | DSH LibreOffice Kit |
| `edit-smoke.mjs` | — | DSH LibreOffice Kit + python-pptx |
| `edit-http.mjs` | — | DSH LibreOffice Kit + python-pptx |
| `pdf-smoke.mjs` | — | DSH LibreOffice Kit |
| `pdf-http.mjs` | — | DSH LibreOffice Kit |
| `html-smoke.mjs` | — | DSH LibreOffice Kit + Chrome/Chromium |
| `diagram-smoke.mjs` | — | draw.io Desktop CLI |
| `source-http.mjs` | — | draw.io Desktop CLI |

`host-smoke.mjs` additionally compares a LibreOffice round-trip deck
(`deck-v1-lort.pptx`): shape ids change, so anchor repair has to fall back to
shape names. Both deck files are committed fixtures; `ARTIFACT_WORKBENCH_TEST_DECK`,
`ARTIFACT_WORKBENCH_TEST_DECK_LORT` and `ARTIFACT_WORKBENCH_TEST_PDF` /
`ARTIFACT_WORKBENCH_TEST_HTML` can point at larger local samples.
