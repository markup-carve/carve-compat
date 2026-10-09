import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { engineNames } from './compat/engines.mjs'
import { runDjotTests } from './compat/djot-tests.mjs'

let selectedEngines = engineNames, reportPath
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('--engines=')) selectedEngines = arg.slice('--engines='.length).split(',')
  else if (arg.startsWith('--report=') && arg.slice('--report='.length)) reportPath = arg.slice('--report='.length)
  else throw new Error(`Unknown argument: ${arg}`)
}
const report = runDjotTests(selectedEngines)
if (reportPath) { mkdirSync(dirname(reportPath), { recursive:true }); writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n') }
console.log(`${report.suite.examples} Djot examples; excluded: ${report.suite.excluded.options} options, ${report.suite.excluded.filters} filters`)
for (const engine of selectedEngines) {
  const t = report.totals[engine]
  console.log(`${engine}: ${t.match} match, ${t.mismatch} mismatch, ${t.declared} declared, ${t.notComparable} not comparable, ${t.failed} failed; honesty: ${JSON.stringify(t.honesty)}; mismatches by report: ${JSON.stringify(t.mismatchByReport)}`)
}
console.log(`${report.reportDisagreements.length} report class disagreements`)
for (const s of report.sections) console.log(`${s.section} (${s.examples} examples): ${selectedEngines.map(engine => {const t = s.results[engine];return `${engine} ${t.match}/${t.match + t.mismatch + t.declared} match/comparable, ${t.notComparable} not comparable, ${t.failed} failed`}).join('; ')}`)
