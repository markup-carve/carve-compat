// Usage: node measure.mjs <set> <run.json> [--baseline] [--engine js|php|rust]
// Per-set match count against the reference HTML, with the diagnostic class of every non-match.
// --baseline compares the count with baselines.json and exits non-zero when it moved.
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { readCases, readRun, renderer } from './lib.mjs'
const argv = process.argv.slice(2)
const gate = argv.includes('--baseline')
const engine = argv[argv.indexOf('--engine') + 1] ?? 'js'
const [set, ...runs] = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--engine')
const cases = readCases(set)
const { status, reportClass } = await renderer()
const baselines = JSON.parse(readFileSync(new URL('./baselines.json', import.meta.url), 'utf8'))
const b = baselines.sets[set] ?? {}
const want = engine === 'rust' && b.rustMatches !== undefined ? b.rustMatches : b.matches
let failed = false
for (const path of runs) {
  const got = readRun(path)
  const counts = {}
  for (const c of cases) {
    const g = got.get(c.id)
    const s = status(c, g?.carve)
    const key = s === 'mismatch' ? `mismatch/${reportClass(g?.diagnostics ?? [])}` : s
    counts[key] = (counts[key] ?? 0) + 1
  }
  const have = counts.match ?? 0
  const line = `${set} ${basename(path)}: ${have} of ${cases.length} match ${JSON.stringify(counts)}`
  if (gate && want !== undefined && have !== want) { failed = true; console.log(`BASELINE ${want} != ${have}  ${line}`) } else console.log(line)
}
process.exitCode = failed ? 1 : 0
