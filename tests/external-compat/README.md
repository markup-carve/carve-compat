# External AST compatibility

This corpus checks Carve against independent document parsers and renderers.
It lives outside the Carve specification and engine repositories. The adapters live in `scripts/compat/`; they are
test infrastructure, not new public Carve import APIs.

## Readers and formats

| Target | Foreign representation | Input and export format |
|---|---|---|
| `mdast` | remark's Markdown tree | CommonMark with GFM parsing |
| `hast` | rehype's HTML tree | HTML fragments |
| `commonmark` | commonmark.js node tree | CommonMark |
| `cmark` | cmark's XML AST | CommonMark |
| `djot` | djot.js node tree | Djot |
| `docutils` | Docutils doctree | reStructuredText |
| `asciidoctor` | Asciidoctor.js block model and converted inline HTML | AsciiDoc |
| `md4c` | MD4C block, span and text events | CommonMark |
| `pandoc` | Pandoc JSON AST | Pandoc Markdown |

The JavaScript packages are locked by `package-lock.json`. Docutils is pinned
in `scripts/compat/requirements.txt`. The native job uses Ubuntu 24.04's cmark
and MD4C packages and records the installed versions in its JSON report.

## What a passing case proves

Each entry in `cases.json` contains foreign source and an authored Carve
source or AST expectation. Ordinary source fixtures follow the checks below. For every selected target, the runner:

1. Parses the foreign source and maps its tree to Carve's published AST schema.
2. Compares the mapped semantic fields with the parsed Carve expectation.
3. Compares foreign HTML with HTML rendered from the mapped Carve
   tree. This checks elements, nesting, destinations, attributes and code
   content, not just visible text.
4. Serializes the mapped tree to Carve source, reparses it and compares the AST.
5. Writes and reads the AST as JSON through Carve's interchange API.
6. Exports to the foreign source format, reparses with the foreign reader and
   compares the mapped AST again.

Markdown, HTML and Djot cases also exercise Carve's existing source importers
and compare their rendered structure with the foreign reader's output.

The shared subset covers paragraphs, headings, emphasis, strong text, code,
links, loose lists, ordered starts, quotes and thematic breaks. Additional
fixtures cover tight and nested lists, hard breaks, references, images with
titles, authored attributes, GFM strike, literal markers and soft wraps where
the selected readers and writers support them. A fixture's `tools` list states
its coverage. A passing suite does not claim compatibility with every node in
any foreign schema or with the whole Carve vocabulary.

`losses.json` checks unsupported nodes and fields separately. A loss case must
produce the named diagnostic at its declared path, preserve the declared
readable content and yield a schema-valid fallback tree. Missing executables, parser errors and
unexplained losses fail the run.

## Normalization boundaries

Mapped trees have no Carve source coordinates and use `srcByteLength: 0`.
Foreign byte offsets or inclusive positions must not become Carve spans.
The semantic comparison excludes source positions, byte length, bullet and
delimiter spelling, attribute order and an explicit ordered start of one.
It treats escaped text and soft wraps as text. It preserves authored
attributes, list tightness, destinations and code whitespace.

Djot, reStructuredText and AsciiDoc generate section structure. The adapters
flatten that structure and report the normalization. The HTML comparison
removes known renderer wrappers and generated heading identifiers and classes.
It keeps authored attributes in the attribute fixture.

Docutils doctrees do not carry Carve list tightness. The Docutils adapter uses
loose lists and records that boundary. Asciidoctor's adapter does the same for
its paragraph-wrapped lists. Its block model supplies the structure; converted
inline HTML supplies inline semantics. Neither adapter claims source-span
compatibility.

Asciidoctor also converts each supported input and exported source to DocBook.
A separate XML mapper must agree with the primary HTML-derived inline tree.
This catches output-path and adapter mismatches, while both conversions share
Asciidoctor's parser. Loss fixtures do not require a lossless DocBook mapping.
reStructuredText heading levels follow the first appearance of each adornment
style; the exporter reports isolated or skipped levels it cannot preserve.
Docutils syntax highlighting is disabled, so language-tagged code requires no
optional highlighter. Source exporters separate adjacent lists and indented
blocks with empty comments to preserve block boundaries.
AsciiDoc export uses passthrough text to prevent replacements and automatic
links from changing literal content.

The corpus measures the listed node and field combinations. It does not prove
coverage of untested fields, parser extensions or arbitrary foreign trees.
Add a fixture when extending an adapter's claimed subset.

The pinned djot.js 0.3.2 writer throws for `hard_break`, although its parser
accepts that node. The Djot export adapter uses a subset writer for those
documents, emits `foreign-writer-workaround`, then verifies the result with
djot.js. Other Djot exports use its native writer.

## Run the suite

The JavaScript targets and failure-path tests run under `npm test` in this
standalone repository. To run just
the JavaScript compatibility sweep:

```sh
npm run compat:javascript -- --report=/tmp/external-compat-js.json
```

The full sweep requires cmark, Docutils and the MD4C driver. On Ubuntu:

```sh
sudo apt-get install cmark libmd4c-dev libmd4c-html0-dev
python3 -m venv /tmp/carve-compat-python
/tmp/carve-compat-python/bin/pip install -r scripts/compat/requirements.txt
cc -std=c99 -Wall -Wextra -Werror \
  "-DCARVE_MD4C_VERSION=\"$(dpkg-query -W -f='${Version}' libmd4c0)\"" \
  scripts/compat/md4c-driver.c -lmd4c -lmd4c-html \
  -o /tmp/carve-md4c-driver
CARVE_COMPAT_PYTHON=/tmp/carve-compat-python/bin/python \
CARVE_MD4C_DRIVER=/tmp/carve-md4c-driver \
  npm run compat:check -- --report=/tmp/external-compat.json
```

`CARVE_CMARK` can select a cmark executable. `--tools=mdast,djot` selects a
smaller sweep; the report names every unmeasured target. The default command
requires all nine targets and all three engines. It never skips a missing reader.

The `Compatibility and website` workflow provisions every reader on pull
requests, pushes to `main`, daily runs and manual dispatches. It uploads the
JSON report even when comparisons fail. Main-branch runs build and publish the
measured website after browser checks. See the root README for deployment and
report-freshness behavior.


## Rich nodes and engine coverage

Basic tables retain rows, cells, header flags and inline content. Task lists
retain checked and unchecked states in mdast, hast and Djot. Numeric footnotes
run through mdast, Djot and Pandoc. Definition lists and inline attributes run
through hast, Djot and Pandoc. Each fixture declares its selected targets.

Lettered and Roman lists preserve Carve's `olType` through Djot and Pandoc.
Repeated notes pass through mdast and Djot. Tables combine inline formatting,
Unicode, links, code and numeric note references. Nested task lists and multiple
definition terms have positive fixtures too.

Pandoc's JSON AST discards source note labels and shared-reference identity.
Numeric notes use document order. Repeated references, equal note bodies,
out-of-order numeric labels and named labels receive diagnostics. Unreferenced
note definitions retain their body as ordinary blocks and report the lost note
structure. Equal note bodies remain separate; content equality does not prove
that two notes shared a label.

HTML and Pandoc retain captions, widths, spans, row groups, section attributes
and block cells through AST interchange. GFM retains column alignment; Djot
retains captions and cell alignment. AST fixtures declare their source-conversion
diagnostics and exact reparsed before/after changes, and compare against authored
JSON expectations. Missing engine diagnostics are recorded separately. Pandoc exports these
fixtures through its native JSON format, since Markdown cannot spell every field.
Block cells, section attributes and short captions remain unspellable in Carve
source. Their rows do not claim Carve source round trips or public importer
coverage. Unsupported fields in narrower formats still require loss diagnostics. Djot export
keeps multiple descriptions as readable blocks under one term and reports the
lost description partition.

JavaScript verifies foreign imports, exports and public importers. PHP and
Rust consume the same mapped AST and check schema validity, JSON interchange,
Carve source round trips, authored-source parsing and rendered HTML. They do
not independently implement the foreign adapters. Loss fallbacks check native
JSON and HTML; source round trips are reserved for authored supported cases,
since synthesized fallback text need not preserve its source spelling.

Generated heading IDs and computed footnote numbers absent from the baseline
are normalized with visible diagnostics. Authored IDs, classes and other fields
remain assertions. A missing engine produces failed rows and metadata errors.
The website selects one engine at a time; totals include all measured engines.
