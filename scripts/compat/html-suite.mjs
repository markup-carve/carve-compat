import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { parse, resolve, renderHtml } from '@markup-carve/carve'
import { engineNames, engineMetadata } from './engines.mjs'
import { reportClass, honesty, honestyOutcomes, runImportBatch } from './importer-report.mjs'

const counts = () => ({ match:0, mismatch:0, notComparable:0, failed:0 })
const engineCounts = () => ({ ...counts(), declared:0 })
const countKey = status => status === 'not-comparable' ? 'notComparable' : status

export function declarationSummaries(differences, rows, selectedEngines) {
  return differences.map(d => {
    const selected = engine => rows.filter(r => r.engine === engine && d.examples.includes(r.example))
    return { ...d, declared:Object.fromEntries(selectedEngines.map(engine => [engine,selected(engine).filter(r => r.status === 'declared').length])), stale:Object.fromEntries(selectedEngines.map(engine => [engine,selected(engine).filter(r => r.status === 'match').map(r => r.example)])), insufficient:Object.fromEntries(selectedEngines.map(engine => [engine,selected(engine).filter(r => r.declaration?.insufficient).map(r => r.example)])) }
  })
}

export function reportDisagreements(examples, rows) {
  return examples.flatMap(e => {
    const results = rows.filter(row => row.example === e.example)
    if (new Set(results.map(row => row.reportClass)).size < 2) return []
    return [{ example:e.example, section:e.section, ...(e.link ? {link:e.link} : {}), classes:Object.fromEntries(results.map(row => [row.engine,row.reportClass])), codes:Object.fromEntries(results.map(row => [row.engine,row.diagnostics.map(d => d.code)])) }]
  })
}

export function runHtmlSuite(selectedEngines, { examples, format, sourceKey, differences = [], baselines, compare }) {
  assert.ok(selectedEngines.length > 0, 'No engines selected')
  assert.equal(new Set(selectedEngines).size, selectedEngines.length, 'Duplicate selected engine')
  for (const engine of selectedEngines) assert.ok(engineNames.includes(engine), `Unknown engine: ${engine}`)
  const byExample = new Map(differences.flatMap(d => d.examples.map(example => [example,d])))
  const metadata = Object.fromEntries(selectedEngines.map(engine => [engine,engineMetadata(engine)]))
  const engines = Object.fromEntries(Object.entries(metadata).map(([engine,{root,binary,...meta}]) => [engine,meta]))
  const reference = engineMetadata('javascript'), pkg = JSON.parse(readFileSync(new URL('../../node_modules/@markup-carve/carve/package.json', import.meta.url)))
  const totals = Object.fromEntries(selectedEngines.map(engine => [engine,{ ...engineCounts(), honesty:Object.fromEntries(honestyOutcomes.map(outcome => [outcome,0])), mismatchByReport:{ 'names-loss':0, 'unverified-only':0, clean:0 } }]))
  const sections = [...new Set(examples.map(e => e.section))].map(section => ({ section, examples:examples.filter(e => e.section === section).length, results:Object.fromEntries(selectedEngines.map(engine => [engine,engineCounts()])), ...(baselines ? {baselines:Object.fromEntries(Object.keys(baselines).map(baseline => [baseline,counts()]))} : {}) }))
  for (const [baseline,result] of Object.entries(baselines ?? {})) for (const row of result.rows) sections.find(s => s.section === row.section).baselines[baseline][countKey(row.status)]++
  const rows = []
  for (const engine of selectedEngines) {
    const batch = runImportBatch(engine, examples.map(e => ({format,source:e[sourceKey]})))
    for (const [i,e] of examples.entries()) {
      const result = batch[i], diagnostics = result.report?.diagnostics ?? []
      const row = { engine, example:e.example, section:e.section, ...(e.link ? {link:e.link} : {}), status:'failed', [sourceKey]:e[sourceKey], expectedHtml:e.html, carve:result.value ?? '', carveHtml:'', diagnostics, reportClass:reportClass(diagnostics) }
      if (Object.hasOwn(result, 'error')) row.error = result.error
      else {
        try {
          row.carveHtml = renderHtml(resolve(parse(result.value)))
          const comparison = compare({expectedHtml:e.html,carveHtml:row.carveHtml,difference:byExample.get(e.example)})
          row.status = comparison.status
          if (comparison.declaration) row.declaration = comparison.declaration
        } catch (error) { row.error = `Rendering the imported Carve failed: ${error.message}` }
      }
      row.honesty = ['match','mismatch','declared'].includes(row.status) ? honesty(row.status !== 'mismatch', row.reportClass) : null
      if (row.honesty !== null) totals[engine].honesty[row.honesty]++
      rows.push(row)
      totals[engine][countKey(row.status)]++
      if (row.status === 'mismatch') totals[engine].mismatchByReport[row.reportClass]++
      sections.find(s => s.section === e.section).results[engine][countKey(row.status)]++
    }
  }
  let suiteRevision
  try { suiteRevision = execFileSync('git', ['rev-parse','HEAD'], { encoding:'utf8' }).trim() } catch { suiteRevision = 'unavailable' }
  return { renderer:{ name:pkg.name, version:reference.version, dependency:reference.dependency }, engines, selectedEngines, notMeasuredEngines:engineNames.filter(e => !selectedEngines.includes(e)), engineConfigSha256:createHash('sha256').update(readFileSync(new URL('../../resources/engines.json', import.meta.url))).digest('hex'), suiteRevision, declarations:declarationSummaries(differences, rows, selectedEngines), totals, ...(baselines ? {baselines} : {}), sections, rows, reportDisagreements:reportDisagreements(examples, rows) }
}
