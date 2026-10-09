import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { engineNames } from './compat/engines.mjs'
import { runCommonmarkSpec } from './compat/commonmark-spec.mjs'

let selectedEngines = engineNames, baselines = ['pandoc-djot'], reportPath
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('--engines=')) selectedEngines = arg.slice('--engines='.length).split(',')
  else if (arg === '--baselines=none') baselines = []
  else if (arg === '--baselines=pandoc-djot') baselines = ['pandoc-djot']
  else if (arg.startsWith('--report=') && arg.slice('--report='.length)) reportPath = arg.slice('--report='.length)
  else throw new Error(`Unknown argument: ${arg}`)
}
const report = runCommonmarkSpec(selectedEngines, { baselines })
if (reportPath) { mkdirSync(dirname(reportPath), { recursive:true }); writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n') }
for (const engine of selectedEngines) {
  const t = report.totals[engine]
  console.log(`${engine}: ${t.match} match, ${t.mismatch} mismatch, ${t.declared} declared, ${t.notComparable} not comparable, ${t.failed} failed; ${t.mismatchByReport.clean} silent losses (clean reports)`)
}
for (const d of report.declarations) for (const engine of selectedEngines) for (const kind of ['stale','insufficient']) {
  if (d[kind][engine].length) console.log(`Warning: ${d.id} ${kind} for ${engine}: examples ${d[kind][engine].join(', ')}`)
}
for (const [baseline,{totals:t}] of Object.entries(report.baselines)) console.log(`${baseline} (baseline): ${t.match} match, ${t.mismatch} mismatch, ${t.notComparable} not comparable, ${t.failed} failed`)
for (const s of report.sections) console.log(`${s.section} (${s.examples} examples): ${[...selectedEngines.map(engine => [engine,s.results[engine]]),...Object.entries(s.baselines).map(([baseline,t]) => [`${baseline} (baseline)`,t])].map(([name,t]) => `${name} ${t.match}/${t.match + t.mismatch + (t.declared ?? 0)} match/comparable, ${t.notComparable} not comparable, ${t.failed} failed`).join('; ')}`)
