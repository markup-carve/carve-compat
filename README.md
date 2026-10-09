# Carve compatibility

Cross-format AST adapters, tests and measured reports for Carve. The website
shows coverage, source examples, mapped trees, exported source, diagnostics and
pinned revisions for each run.

- [**Website**](https://markup-carve.github.io/carve-compat/)
- [Full methodology and adapter boundaries](tests/external-compat/README.md)

The suite lives independently of the Carve specification repository. It measures
nine external parser targets through pinned JavaScript, PHP and Rust Carve
engines: mdast, hast, commonmark.js, cmark, djot.js, Docutils, Asciidoctor.js,
MD4C and Pandoc. Foreign adapters run through JavaScript. All three engines
check the public importers, mapped AST, JSON interchange, Carve source and HTML.
See [current findings](docs/findings.md) for reproduced engine differences.

## What the report means

Supported fixtures check Carve's AST schema, semantic structure, rendered HTML,
Carve source, JSON interchange and foreign source round trips. Markdown, HTML
and Djot also exercise each engine's public source importer on supported fixtures
without authored AST expectations. The importer record compares its fidelity
report with rendered structure:

- `reported`: structure was lost and the report names a loss.
- `unassessed`: structure was lost and only `fidelity-unverified` was reported.
- `silent-loss`: structure was lost with a clean report.
- `false-loss`: structure was kept but the report names a loss.
- `ok`: structure was kept without a named loss.

Supported fixtures fail on `silent-loss` or `false-loss`. `unassessed` passes the
honesty check unless the engine and format are listed in
[`resources/importer-assessment.json`](resources/importer-assessment.json).
Existing rendering assertions still apply. The assessment lists start empty.
Add a format to an engine's list once it ships construct-level diagnostics for
that format, per [carve#2792](https://github.com/markup-carve/carve/issues/2792).
From then on, `unassessed` fails as an unassessed importer. Reports include the
assessment file's SHA-256 hash.

Loss fixtures require a diagnostic code, fidelity and exact AST path, a valid
fallback tree and retained readable content. A passing loss case records a
known boundary; it does not mean the feature survived unchanged. Empty matrix
cells are outside that target's declared fixture coverage.

The report is a measurement of the listed cases and versions, not a percentage
of all possible documents. Foreign source spans are not Carve spans. List
layout and heading levels have documented boundaries. Asciidoctor's inline tree also has to match a separate DocBook conversion.
Both conversions share Asciidoctor's parser.

## Run locally

Use Node 24 or newer and Python 3.12 or newer. The JavaScript and Python readers
are pinned. Native reader versions are recorded in each report.

```sh
npm ci
npm test
mkdir -p reports
npm run compat:javascript -- --report=reports/javascript.json
```

For all nine readers and three engines on Ubuntu, install Rust with Cargo,
PHP 8.3 or newer, and the native dependencies below:

```sh
sudo apt-get install php-cli php-xml cmark libmd4c-dev libmd4c-html0-dev
python3 -m venv .cache/python
.cache/python/bin/pip install -r scripts/compat/requirements.txt
mkdir -p .cache/compat reports
cc -std=c99 -Wall -Wextra -Werror \
  "-DCARVE_MD4C_VERSION=\"$(dpkg-query -W -f='${Version}' libmd4c0)\"" \
  scripts/compat/md4c-driver.c -lmd4c -lmd4c-html \
  -o .cache/compat/md4c-driver
npm run compat:provision
CARVE_PANDOC=.cache/pandoc/bin/pandoc \
CARVE_COMPAT_PYTHON=.cache/python/bin/python \
  npm run compat:check -- --report=reports/latest.json
```

`CARVE_CMARK`, `CARVE_MD4C_DRIVER` and `CARVE_PANDOC` select native executables.
The provisioner downloads Pandoc 3.11 with a verified archive checksum and
builds the pinned Rust engine with its lockfile. PHP runs through a small
autoload driver. `--engines=javascript` selects the reference engine alone;
native selections must include JavaScript to provide the mapped baseline.
`--tools=mdast,djot` measures a narrower selection and records every unmeasured
target. Missing readers fail the full sweep instead of becoming skips.

## CommonMark spec examples

This measurement lane imports all 652 CommonMark 0.31.2 spec examples with each
selected Carve engine. Every engine's Carve output is rendered by the JavaScript
reference renderer and compared structurally with the spec's expected HTML.
The comparator removes renderer indentation before tags, collapses HTML whitespace
outside code, trims inline edges in paragraphs, headings, table cells, and definition
terms, and ignores Carve's generated heading IDs and section wrappers. Code whitespace
remains significant.

Results are `match`, `mismatch`, `not-comparable` when the HTML mapper cannot
represent the expected structure, or `failed` when importing fails. Importer
reports have three classes: `names-loss` names a degraded or dropped feature;
`unverified-only` has `fidelity-unverified` without a named loss; `clean` has
neither. Comparable rows also use the five honesty outcomes described above;
`not-comparable` and `failed` rows have no honesty outcome. Totals count each
outcome, and `reportDisagreements` lists examples with different report classes
across the selected engines.

This lane measures all outcomes without gating on honesty. A `false-loss` can
be a real loss that the whitespace-collapsing comparator cannot see. Example 40
drops a leading tab that HTML rendering collapses anyway. JavaScript names
`structure-unspellable`; PHP and Rust report only `fidelity-unverified`.

```sh
npm run compat:commonmark -- --report=reports/commonmark.json
```

The default selects JavaScript, PHP, and Rust. Use `--engines=javascript` for the
reference importer alone. Mismatches never fail this lane's CI step. Infrastructure
errors, including invalid vendored data, engine pin mismatches, and crashed drivers,
fail the run. The report includes every example and totals by engine and spec section.
The site includes the report when present; `--commonmark=path` selects another file.
See [vendored data provenance and license](tests/commonmark-spec/README.md).

## Build and preview the website

```sh
npm run site:build
npm run site:preview
```

Open `http://localhost:4173`. The builder requires a report with provenance;
it never substitutes sample results. To build from another measured report:

```sh
npm run site:build -- reports/javascript.json
```

The site uses static HTML, CSS, SVG and JavaScript, with no external fonts,
analytics or runtime service. Sources and foreign HTML appear as text, not
executable markup. Browser checks cover desktop and mobile views, filters,
case permalinks, loss diagnostics, unavailable reports and HTML injection.

```sh
npx playwright install chromium
npm run test:site
```

## GitHub Actions and Pages

Pull requests run unit tests, provision all readers, measure compatibility,
build the website and run browser checks. They upload evidence and a site
artifact without publishing.

Pushes to `main`, daily schedules and manual runs publish through GitHub Pages.
Pages uses the GitHub Actions build type. The deployment environment is
`github-pages`; deployment runs only from `main`.

A comparison failure still produces a report and makes the workflow fail.
Once the site build and browser checks pass, that report can publish with the
failure visible. Setup, unit, build or browser failures prevent deployment.
The previous report stays available with its measurement date; the page flags
reports older than 48 hours.

## Revisions and upstream work

JavaScript is pinned in `package.json` and the lockfile. PHP, Rust and Pandoc
are pinned in `resources/engines.json`; reports include its hash. Rust binaries
also have a build manifest with the source revision and binary SHA-256. The AST schema is
a vendored snapshot whose source revision and license are recorded in
`resources/provenance.json`. Each report also includes its SHA-256 hash, the
hashes of the raw fixture files, tool versions, suite revision and measurement time.

Daily runs test the locked dependencies. Updating an engine, schema or reader
requires a reviewed dependency change and a new measured report. Keep the
schema snapshot and its provenance together when updating the contract.

The pinned Djot writer cannot serialize hard breaks. A tested adapter workaround
keeps those cases measurable and emits a diagnostic. [Djot upstream PR #158](https://github.com/jgm/djot.js/pull/158)
merged the native fix on October 2, 2026. Remove the workaround only after a pinned version
contains it and the regression tests confirm it.

## License

MIT. The vendored Carve AST schema and migrated compatibility code retain the
license in [LICENSE](LICENSE).
