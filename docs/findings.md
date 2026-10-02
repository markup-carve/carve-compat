# Current findings

The expanded sweep measures nine foreign readers through three pinned Carve
engines. Results apply to the declared fixtures and versions. They do not rank
whole languages or establish compatibility with arbitrary documents.

## PHP authored IDs

The expanded sweep found five failed comparisons caused by the PHP canonical
writer dropping authored paragraph and span IDs. JSON retained the IDs, and the
schema already represented them. This was an engine bug.

[Issue #2831](https://github.com/markup-carve/carve-php/issues/2831) tracked the
reproduction. [PR #2833](https://github.com/markup-carve/carve-php/pull/2833)
fixed IDs supplied without an attribute-order entry and preserved classes when
that optional order was incomplete. The compat PHP pin now includes the merged
fix at `e15b786c668b5e97207b7d45a5356c9743308ee9`. The five comparisons pass.
Generated heading IDs retain their existing export behavior.

## Representation versus coverage

Carve already represents table captions, columns, widths, cell spans, notes,
checked task items, definitions, attributes and lettered/Roman list styles.
Several adapters support only a subset of those fields. Their loss diagnostics
are adapter boundaries; they do not establish AST design defects.

Positive fixtures now cover lettered and Roman lists, repeated notes in mdast
and Djot, distinct numeric notes, nested task lists, multiple definition terms,
and tables combining Unicode, formatting, links, code and note references.

Pandoc stores note bodies inline without source labels or shared-reference
identity. Repeated references, equal note bodies and out-of-order numeric labels
therefore receive explicit diagnostics. The adapter keeps readable note content
without deduplicating equal bodies. Named and unreferenced notes remain explicit
losses too.

## Rich tables and interchange

HTML and Pandoc adapters retain table captions, column widths, cell spans,
row and cell attributes, explicit row groups, section attributes and block
cells. GFM retains column alignment. Djot retains captions and cell alignment.
Combination fixtures include attributed spanning cells, formatted captions,
multiple body groups, row headers, footers and blocks inside cells.

An authored AST expectation distinguishes these interchange tests from ordinary
Carve source fixtures. They check foreign parsing, schema validity, exact field
mapping, JSON interchange, foreign interchange export and rendered HTML.
Pandoc JSON is the export format for its richer table model; Pandoc Markdown
does not preserve every JSON field. These rows explicitly list their scope.

Carve source cannot spell block cells, section attributes or short captions.
The reference engine's conversion report and reparsed source changes must match
each fixture's declared expectations. The pinned JavaScript writer also loses
some row-group information without reporting it. [Issue #2457](https://github.com/markup-carve/carve-js/issues/2457)
tracks that engine gap. Column metadata can reparse as table attributes instead
of the original AST fields. Both forms of change are visible in the evidence;
AST interchange passing does not claim a lossless source round trip.
Native engine rows verify JSON and HTML; they do not claim source round trips
for these AST fixtures or independent conversion-diagnostic implementations.

Pandoc has no vertical-alignment field. GFM and Djot still have narrower table
models. Unsupported caption structure, column attributes and other fields
continue to require explicit loss diagnostics. HTML width comparisons account
for renderer decimal precision; the AST width assertions remain exact.

## Combination coverage

Nested notes run through mdast and Djot. Definitions containing task lists run
through HTML and Djot. These cases complement repeated notes, nested tasks,
inline table formatting and note references inside table cells.

## Website freshness

Report and manifest requests bypass the browser HTTP cache on page load.
Script and stylesheet URLs include their content hashes so a new deployment
also loads the current application code. A
browser regression test caches an old report, changes the server's report,
then opens the dashboard and requires the new counts without a hard refresh.
An already open page still needs a reload to display a later deployment.

## Shared and independent checks

PHP and Rust add real engine coverage after foreign parsing and mapping. They
share the JavaScript adapters; they are not separate foreign-language importers.
Asciidoctor's DocBook and HTML paths have separate mappers but share one parser.
Generated IDs, renderer navigation and computed note numbers receive visible
normalization diagnostics. Authored attributes remain part of the comparison.
