// Usage: node check-expected.mjs <set> <out.json> [js|php|rust]
// Lists every id whose Carve output or (code, path) diagnostics differ from expected/<set>.json.
// With an engine name, a row listed under baselines.json engineDivergences may instead carry that
// engine's recorded form.
import { readFileSync } from 'node:fs'
import { readExpected, readRun } from './lib.mjs'
const [set, path, engine] = process.argv.slice(2)
const { engineDivergences = {} } = JSON.parse(readFileSync(new URL('./baselines.json', import.meta.url), 'utf8'))
const exp = readExpected(set)
const got = readRun(path)
let bad = 0, declared = 0
for (const e of exp) {
  const g = got.get(e.id)
  const gd = JSON.stringify((g?.diagnostics ?? []).map(d => [d.code, d.path ?? null]))
  const ed = JSON.stringify(e.diagnostics.map(([c, p]) => [c, p ?? null]))
  if (g && g.carve === e.carve && gd === ed) continue
  const alt = engine && engineDivergences[e.id]?.[engine]
  if (alt !== undefined && g?.carve === alt && gd === ed) { declared++; continue }
  bad++
  console.log(`--- ${e.id}\n  want ${JSON.stringify(e.carve)} ${ed}\n  got  ${JSON.stringify(g?.carve)} ${gd}`)
}
console.log(bad ? `${bad} of ${exp.length} differ` : `all ${exp.length} identical${declared ? ` (${declared} through a declared engine divergence)` : ''}`)
process.exitCode = bad ? 1 : 0
