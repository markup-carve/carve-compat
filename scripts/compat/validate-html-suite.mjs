import assert from 'node:assert/strict'
import { honesty, honestyOutcomes, reportClass } from './importer-report.mjs'
import { engineNames } from './engines.mjs'
import { reportDisagreements, declarationSummaries } from './html-suite.mjs'

export function validateHtmlSuite(measurement, {label,examples,differences,sourceKey}) {
  const byExample = new Map(examples.map(e => [e.example,e]))
  assert.ok(Array.isArray(measurement.selectedEngines), 'Missing selected engines')
  assert.ok(measurement.selectedEngines.every(engine => engineNames.includes(engine)), 'Unknown suite engine')
  const declaredExamples = new Map(differences.flatMap(d => d.examples.map(example => [example,d.id])))
  assert.ok(Array.isArray(measurement.rows) && Array.isArray(measurement.selectedEngines) && measurement.selectedEngines.length > 0)
  assert.equal(new Set(measurement.selectedEngines).size, measurement.selectedEngines.length)
  assert.ok(measurement.rows.every(r => measurement.selectedEngines.includes(r.engine) && ['match','mismatch','declared','not-comparable','failed'].includes(r.status)), `Invalid ${label} result row`)
  assert.deepEqual(Object.keys(measurement.totals).sort(), [...measurement.selectedEngines].sort())
  const statuses = [['match','match'],['mismatch','mismatch'],['not-comparable','notComparable'],['failed','failed']]
  const engineStatuses = [...statuses,['declared','declared']]
  assert.ok(label === 'CommonMark' || !Object.hasOwn(measurement, 'baselines'), 'Djot reports have no baselines')
  assert.ok(measurement.baselines === undefined || (measurement.baselines !== null && typeof measurement.baselines === 'object' && !Array.isArray(measurement.baselines)), `Invalid ${label} baselines`)
  const baselines = Object.keys(measurement.baselines ?? {})
  for (const name of baselines) {
    assert.equal(name, 'pandoc-djot', 'Unknown CommonMark baseline')
    const baseline = measurement.baselines[name], rows = baseline.rows
    assert.ok(!Object.hasOwn(baseline.totals, 'declared'), `${label} baseline has no declared count`)
    for (const tool of ['converter','renderer']) for (const key of ['name','version']) assert.equal(typeof baseline[tool]?.[key], 'string', `Missing ${label} baseline ${tool} ${key}`)
    assert.equal(baseline.converter.command, '-f commonmark -t djot --wrap=preserve', `Invalid ${label} baseline command`)
    assert.ok(Array.isArray(rows), `${label} ${name}: missing rows`)
    assert.equal(rows.length, examples.length, `${label} ${name}: incomplete rows`)
    assert.equal(new Set(rows.map(r => r.example)).size, examples.length, `${label} ${name}: duplicate example`)
    for (const row of rows) {
      assert.ok(['match','mismatch','not-comparable','failed'].includes(row.status), `Invalid ${label} baseline status`)
      assert.equal(row.section, byExample.get(row.example)?.section, `Invalid ${label} baseline example or section`)
      for (const key of ['output','html']) assert.equal(typeof row[key], 'string', `${label} baseline row missing ${key}`)
      if (Object.hasOwn(row, 'error')) assert.equal(typeof row.error, 'string', `Invalid ${label} baseline error`)
      assert.ok(!Object.hasOwn(row, 'honesty') && !Object.hasOwn(row, 'reportClass'), `${label} baseline has no fidelity report`)
      assert.ok(!Object.hasOwn(row, 'declaration'), `${label} baseline has no declaration`)
    }
    for (const [status,key] of statuses) assert.equal(baseline.totals?.[key], rows.filter(r => r.status === status).length, `${label} ${name}: inconsistent ${key} count`)
  }
  for (const row of measurement.rows) {
    if (sourceKey === 'source') assert.equal(row.link, byExample.get(row.example)?.link, 'Invalid Djot example link')
    assert.equal(row.section, byExample.get(row.example)?.section, `Invalid ${label} example or section`)
    assert.equal(row[sourceKey], byExample.get(row.example)?.[sourceKey], `${label} source differs from the suite`)
    assert.equal(row.expectedHtml, byExample.get(row.example)?.html, `${label} expected HTML differs from the spec`)
    for (const key of [sourceKey,'expectedHtml','carve','carveHtml']) assert.equal(typeof row[key], 'string', `${label} row missing ${key}`)
    assert.ok(Array.isArray(row.diagnostics) && row.diagnostics.every(d => typeof d?.code === 'string'), `Invalid ${label} diagnostics`)
    assert.equal(row.reportClass, reportClass(row.diagnostics), 'Report class differs from diagnostics')
    assert.ok(['names-loss','unverified-only','clean'].includes(row.reportClass), `Invalid ${label} report class`)
    assert.equal(row.honesty, ['match','mismatch','declared'].includes(row.status) ? honesty(row.status !== 'mismatch', row.reportClass) : null, `Invalid ${label} honesty outcome`)
    const id = declaredExamples.get(row.example)
    if (row.status === 'declared' || (row.status === 'mismatch' && id)) {
      assert.ok(id, `Undeclared ${label} example`)
      assert.deepEqual(row.declaration, row.status === 'declared' ? {id} : {id,insufficient:true}, `Invalid ${label} declaration annotation`)
    } else assert.ok(!Object.hasOwn(row, 'declaration'), `Unexpected ${label} declaration annotation`)
  }
  assert.ok(Array.isArray(measurement.declarations), `Missing ${label} declarations`)
  assert.deepEqual(measurement.declarations, declarationSummaries(differences, measurement.rows, measurement.selectedEngines), `Inconsistent ${label} declaration summaries`)
  for (const engine of measurement.selectedEngines) {
    const rows = measurement.rows.filter(r => r.engine === engine), totals = measurement.totals[engine]
    assert.equal(typeof measurement.engines?.[engine]?.name, 'string', `Missing ${label} engine metadata: ${engine}`)
    assert.equal(rows.length, examples.length, `${label} ${engine}: incomplete rows`)
    assert.equal(new Set(rows.map(r => r.example)).size, examples.length, `${label} ${engine}: duplicate example`)
    for (const [status,key] of engineStatuses) assert.equal(totals[key], rows.filter(r => r.status === status).length, `${label} ${engine}: inconsistent ${key} count`)
    assert.ok(rows.filter(r => r.status === 'mismatch').every(r => ['names-loss','unverified-only','clean'].includes(r.reportClass)), `Invalid ${label} mismatch report class`)
    for (const cls of ['names-loss','unverified-only','clean']) assert.equal(totals.mismatchByReport?.[cls], rows.filter(r => r.status === 'mismatch' && r.reportClass === cls).length, `${label} ${engine}: inconsistent ${cls} count`)
    for (const outcome of honestyOutcomes) assert.equal(totals.honesty?.[outcome], rows.filter(r => r.honesty === outcome).length, `${label} ${engine}: inconsistent ${outcome} honesty count`)
    assert.equal(Object.values(totals.honesty).reduce((sum,n) => sum+n, 0), totals.match + totals.mismatch + totals.declared, `${label} ${engine}: inconsistent honesty total`)
  }
  assert.deepEqual(measurement.reportDisagreements, reportDisagreements(examples, measurement.rows), 'Inconsistent report disagreements')
  assert.ok(Array.isArray(measurement.reportDisagreements), `Missing ${label} report disagreements`)
  assert.ok(Array.isArray(measurement.sections), `Missing ${label} section results`)
  assert.deepEqual(measurement.sections.map(s => s.section), [...new Set(examples.map(e => e.section))], `Invalid ${label} section order`)
  for (const s of measurement.sections) {
    assert.equal(s.examples, examples.filter(e => e.section === s.section).length)
    assert.deepEqual(Object.keys(s.baselines ?? {}).sort(), [...baselines].sort(), `Invalid ${label} section baselines`)
    for (const name of baselines) for (const [status,key] of statuses) assert.equal(s.baselines[name]?.[key], measurement.baselines[name].rows.filter(r => r.section === s.section && r.status === status).length, `${label} ${name}/${s.section}: inconsistent ${key} count`)
    for (const engine of measurement.selectedEngines) for (const [status,key] of engineStatuses) assert.equal(s.results?.[engine]?.[key], measurement.rows.filter(r => r.engine === engine && r.section === s.section && r.status === status).length, `${label} ${engine}/${s.section}: inconsistent ${key} count`)
  }
}
