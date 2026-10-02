# Carve compatibility

Cross-format AST adapters, tests and measured reports for Carve. The website
shows coverage, source examples, mapped trees, exported source, diagnostics and
pinned revisions for each run.

- [**Website**](https://markup-carve.github.io/carve-compat/)
- [Full methodology and adapter boundaries](tests/external-compat/README.md)

The suite lives independently of the Carve specification repository. It measures
nine external parser targets through pinned JavaScript, PHP and Rust Carve
engines: mdast, hast, commonmark.js, cmark, djot.js, Docutils, Asciidoctor.js,
MD4C and Pandoc. Foreign adapters and public importers run through JavaScript;
PHP and Rust check the mapped AST, JSON interchange, Carve source and HTML.
See [current findings](docs/findings.md) for reproduced engine differences.

## What the report means

Supported fixtures check Carve's AST schema, semantic structure, rendered HTML,
Carve source, JSON interchange and foreign source round trips. Markdown, HTML
and Djot also exercise the public Carve source importers.

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
