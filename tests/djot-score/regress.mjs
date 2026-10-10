// Usage: node regress.mjs <set> <before.json> <after.json>
// Rows that matched the reference before and no longer do, plus rows that match while the
// fidelity report names a loss.
import { readCases, readRun, renderer } from './lib.mjs'
const [set, bf, af] = process.argv.slice(2)
const cases = readCases(set)
const B = readRun(bf), A = readRun(af)
const { status, reportClass } = await renderer()
let reg = 0, falseLoss = 0, before = 0, after = 0
for (const c of cases) {
  const b = status(c, B.get(c.id)?.carve), a = status(c, A.get(c.id)?.carve)
  if (b === 'match') before++
  if (a === 'match') after++
  if (b === 'match' && a !== 'match') {
    reg++
    console.log(`REGRESSION ${c.id} ${JSON.stringify(c.djot)}\n   before ${JSON.stringify(B.get(c.id)?.carve)}\n   after  ${JSON.stringify(A.get(c.id)?.carve)}`)
  }
  if (a === 'match' && reportClass(A.get(c.id)?.diagnostics ?? []) === 'names-loss') {
    falseLoss++
    console.log(`FALSE-LOSS ${c.id} ${JSON.stringify(c.djot)}`)
  }
}
console.log(`${set}: matches ${before} -> ${after}; regressions ${reg}; false losses ${falseLoss}; of ${cases.length}`)
process.exitCode = reg ? 1 : 0
