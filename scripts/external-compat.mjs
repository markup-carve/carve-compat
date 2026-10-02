import { writeFileSync } from 'node:fs'
import { runCompatibility } from './compat/check.mjs'
import { engineNames } from './compat/engines.mjs'
import { toolNames, nativeTools } from './compat/tools.mjs'

let selected = toolNames, selectedEngines = engineNames, reportPath
for (const arg of process.argv.slice(2)) {
  if (arg === '--javascript') { selected = toolNames.filter(t => !nativeTools.includes(t)); selectedEngines=['javascript'] }
  else if (arg.startsWith('--tools=')) selected = arg.slice(8).split(',')
  else if (arg.startsWith('--engines=')) selectedEngines=arg.slice(10).split(',')
  else if (arg.startsWith('--report=')) reportPath = arg.slice(9)
  else throw new Error(`Unknown argument: ${arg}`)
}
const report = await runCompatibility(selected,selectedEngines)
if (reportPath) writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')
for (const engine of selectedEngines) for (const tool of selected) {
  const rows = report.rows.filter(r => r.tool === tool && r.engine === engine)
  console.log(`${engine}/${tool}: ${rows.filter(r => r.status === 'passed').length}/${rows.length} passed`)
  for (const row of rows.filter(r => r.status === 'failed')) console.error(`${engine}/${tool}/${row.case}: ${row.error}`)
}
if (report.notMeasured.length) console.log(`Not measured: ${report.notMeasured.join(', ')}`)
console.log(`${report.passed} passed, ${report.failed} failed`)
process.exitCode = report.failed ? 1 : 0
