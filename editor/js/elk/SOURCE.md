# ELK (Eclipse Layout Kernel) — license and source

`editor/js/elk/drawio-elk.min.js` is a bundled build of ELK produced by the
draw.io project: banner `@drawio/elk 0.1.0+commit.ddfc94b (built 2026-08-27)`.
The same code is also embedded in `editor/js/extensions.min.js`.

## License

ELK / elkjs is licensed under the **Eclipse Public License 2.0 (EPL-2.0)**.
A copy of the license text is shipped in this directory (`LICENSE`) and in
`../../licenses/epl-2.0.txt`.

The EPL is a weak copyleft license: it applies to the EPL-licensed component
itself, not to the MIT-licensed plugin code that merely aggregates it.

## Source code availability

- ELK upstream: <https://github.com/eclipse/elk> (EPL-2.0), © Eclipse
  Foundation, Inc. and contributors.
- The draw.io wrapper/bundle project (`@drawio/elk`) is built by the draw.io
  project; its build configuration is not published in this repository. The
  bundled artifact's commit id is `ddfc94b` as printed in its banner.
- If you need the exact corresponding sources for the bundled ELK build,
  obtain the Eclipse ELK sources from the upstream repository above and the
  `@drawio/elk` build from the draw.io project; the bundled file is an
  unmodified build artifact of that project.

This component is tracked in the repository's `COMPLIANCE.md`; replacing the
vendored editor with a build that omits ELK would remove this obligation
entirely.
