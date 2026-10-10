// Usage: node build-djot-suite.mjs
// Regenerates cases/djot-suite.json from the djot.js test suite, through the same eligibility
// filter the djot-tests lane uses: no per-case options, no filters. The cases those exclude
// carry an AST dump rather than HTML in their expected output and cannot be scored here.
import { writeFileSync } from 'node:fs'
import { validateDjotTests } from '../../scripts/compat/djot-tests.mjs'
const { examples, excluded } = validateDjotTests()
const rows = examples.map(e => ({ id: e.example, djot: e.source, expectedHtml: e.html }))
writeFileSync(new URL('./cases/djot-suite.json', import.meta.url), JSON.stringify(rows, null, 1) + '\n')
console.log(`djot-suite: ${rows.length} rows; excluded ${JSON.stringify(excluded)}`)
