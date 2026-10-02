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

Table caption, alignment, width, span, footer partition, section attributes and
block-cell fallbacks have loss fixtures. Djot export reports multiple descriptions
under one term because its source grammar groups those blocks into one body.
These checks cover the declared combinations, not every possible rich document.

## Shared and independent checks

PHP and Rust add real engine coverage after foreign parsing and mapping. They
share the JavaScript adapters; they are not separate foreign-language importers.
Asciidoctor's DocBook and HTML paths have separate mappers but share one parser.
Generated IDs, renderer navigation and computed note numbers receive visible
normalization diagnostics. Authored attributes remain part of the comparison.
