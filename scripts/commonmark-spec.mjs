import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { engineNames } from './compat/engines.mjs'
import { runCommonmarkSpec } from './compat/commonmark-spec.mjs'

let selectedEngines = engineNames, reportPath
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('--engines=')) selectedEngines = arg.slice('--engines='.length).split(',')
  else if (arg.startsWith('--report=') && arg.slice('--report='.length)) reportPath = arg.slice('--report='.length)
  else throw new Error(`Unknown argument: ${arg}`)
}
const report = runCommonmarkSpec(selectedEngines)
if (reportPath) { mkdirSync(dirname(reportPath), { recursive:true }); writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n') }
for (const engine of selectedEngines) {
  const t = report.totals[engine]
  console.log(`${engine}: ${t.match} match, ${t.mismatch} mismatch, ${t.notComparable} not comparable, ${t.failed} failed; ${t.mismatchByReport.clean} silent losses (clean reports)`)
}
for (const s of report.sections) console.log(`${s.section} (${s.examples} examples): ${selectedEngines.map(engine => { const t = s.results[engine]; return `${engine} ${t.match}/${t.match + t.mismatch} match/comparable, ${t.notComparable} not comparable, ${t.failed} failed` }).join('; ')}`)
