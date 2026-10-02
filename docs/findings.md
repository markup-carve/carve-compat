# Current findings

The expanded sweep measures nine foreign readers through three pinned Carve
engines. Results apply to the declared fixtures and versions. They do not rank
whole languages or establish compatibility with arbitrary documents.

## PHP authored IDs

At revision `aeeb4c3c40676c811ac3adff06aebd366e4a169c`, PHP preserves authored
IDs in JSON but drops them in its canonical Carve writer. A paragraph carrying
`{#authored .note}` reparses with the class and no ID. An inline span carrying
`{#word .token key="value"}` keeps its class and key/value but loses its ID.
These are two writer reproductions appearing in five target/case comparisons.
They remain visible failures rather than accepted losses.

The schema supports these IDs. This is an engine round-trip issue, not a need
for an additional AST field. Use the website's PHP filter and open
`authored-attributes` or `inline-attributes` to inspect the input AST, canonical
source and failed comparison. The engine pin stays unchanged so the report
continues to reproduce the behavior.

## Representation versus coverage

Carve already represents table captions, columns, widths, cell spans, notes,
checked task items, definitions, attributes and lettered/Roman list styles.
Several adapters support only a subset of those fields. Their loss diagnostics
are adapter boundaries; they do not establish AST design defects.

New positive fixtures cover basic tables, numeric notes, tasks, definitions and
inline attributes. Named Pandoc notes and HTML table spans have explicit loss
fixtures. Repeated note references, complex table sections and combinations
outside those fixtures still need coverage before making broader claims.

## Shared and independent checks

PHP and Rust add real engine coverage after foreign parsing and mapping. They
share the JavaScript adapters; they are not separate foreign-language importers.
Asciidoctor's DocBook and HTML paths have separate mappers but share one parser.
Generated IDs, renderer navigation and computed note numbers receive visible
normalization diagnostics. Authored attributes remain part of the comparison.
