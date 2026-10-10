# Djot import scoring harness

Measures what the three Carve engines make of Djot input, against the HTML the djot.js
test suite expects, through the pinned reference renderer this repo already uses for the
CommonMark lane.

Two instruments, with different jobs:

- `cases/<set>.json` holds the input and the reference HTML. It is the oracle. Where
  djot.js contradicts its own documented contract, the row is re-derived from the
  contract and the ruling is referenced in the issue that made it.
- `expected/<set>.json` pins the Carve each engine writes, plus the fidelity diagnostics.
  It is a change detector: a row moving here means the importer's output moved, which may
  be a fix or a regression, and `measure.mjs` says which.

`baselines.json` records the match count per set, the engine commits the counts were taken
at, the reference renderer version, and the rows whose expectation is known to be waiting
on an open ruling.

## Sets

| set | rows | source |
| --- | --- | --- |
| `djot-suite` | 268 | `tests/djot-tests`, through the lane's own eligibility filter |
| `gen` | 468 | generated list and nested-block shapes |
| `gen2` | 92 | generated div-in-container shapes |
| `gen3` | 310 | generated link destination and autolink shapes |
| `gen4` | 392 | generated block interruption shapes |
| `gen5` | 667 | generated empty, escaped and attributed inline shapes |

2,197 rows in all. Regenerate `djot-suite` with `build-djot-suite.mjs`, which takes the
set from `validateDjotTests()`: the six cases that carry per-case options expect an AST
dump rather than HTML, so they cannot be scored here and the filter drops them. An earlier
count of 2,474 came from two copies of this set, one of them unfiltered at 277 rows.

## Running it

```sh
node tests/djot-score/run-engine.mjs js   ../carve-js        gen5 /tmp/js-gen5.json
node tests/djot-score/run-engine.mjs php  ../carve-php       gen5 /tmp/php-gen5.json
node tests/djot-score/run-engine.mjs rust ../carve-rs/target/release/carve gen5 /tmp/rs-gen5.json

node tests/djot-score/check-expected.mjs gen5 /tmp/js-gen5.json js
node tests/djot-score/measure.mjs gen5 /tmp/js-gen5.json --baseline --engine js
node tests/djot-score/regress.mjs gen5 /tmp/before.json /tmp/after.json
```

Build each engine from `origin/main` unless you mean to measure a branch. A checkout left
on a feature branch reads as a thousand false differences.

## Two things that make a reading trustworthy

**Three-engine agreement.** carve-js, carve-php and carve-rs are byte-identical on 2,195
of the 2,197 rows. An expectation only one engine satisfies is therefore wrong by
construction, which is the cheapest check available here. The two rows that do differ are
listed under `engineDivergences` with the issue that will settle them.

**Numbers live in `baselines.json`, not in a brief.** Every score in this area travelled by
prose until 2026-10-10, and two vintages of the expectations diverged without anyone
noticing, because each lane was internally consistent against its own copy. Re-record the
baselines in the same change that moves them.

## Regenerating an expectation

Replace only the rows the change governs, as a literal string replacement on the file
text. Parsing and re-dumping reorders nothing here but does rewrite the smart quotes and
other non-ASCII characters into escapes, and it buries a four-row change in a whole-file
diff.
