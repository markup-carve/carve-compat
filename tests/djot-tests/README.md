# djot.js functional tests

These are verbatim upstream files from the `test/` directory of
[jgm/djot.js](https://github.com/jgm/djot.js) at commit
`596e7fcf487f35c739de6a9c33e9a944c1927e56`. The upstream MIT license is in
[LICENSE](LICENSE).

The lane uses the file list and parser from upstream `functional.spec.ts`.
That list excludes `filters.test`. Examples with renderer options or a `!`
filter separator are excluded from measurement. Upstream leaves filter parsing
as a TODO; the parser retains that output and marks the separator for exclusion.
The selected files contain 274 examples, including six with options. The lane
measures the remaining 268 examples against their expected HTML.

`scripts/compat/djot-tests.mjs` pins the SHA-256 of all `.test` files and
`LICENSE`, sorted by file name, with each name followed by a NUL byte and its
unchanged content. The README and optional declarations are outside that hash.

Both sides of the HTML comparison use generated mode with the Djot renderer.
This removes generated section wrappers and heading IDs. It also ignores
authored heading IDs, so this lane does not measure them. Code whitespace stays
significant; rendered HTML whitespace is collapsed outside code.

`declared.json` lists two documented Carve rendering differences: the
`role="math"` attribute on math spans and a lone image rendered without `<p>`.
Each one is re-checked through its normalization, applied to both sides, as in
the CommonMark lane.
