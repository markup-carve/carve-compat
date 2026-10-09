import { readFileSync, mkdirSync, cpSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { honesty, honestyOutcomes } from './compat/importer-report.mjs'
import { validateDeclarations } from './compat/commonmark-spec.mjs'
let reportPath = 'reports/latest.json', commonmarkPath = 'reports/commonmark.json', positional = false
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('--commonmark=') && arg.slice('--commonmark='.length)) commonmarkPath = arg.slice('--commonmark='.length)
  else if (!arg.startsWith('-') && !positional) { reportPath = arg; positional = true }
  else throw new Error(`Unknown argument: ${arg}`)
}
const report = JSON.parse(readFileSync(reportPath))
assert.equal(report.schemaVersion, 1)
assert.ok(report.generatedAt && report.engine && report.schema, 'Generate a fresh provenance-bearing report before building the site')
assert.equal(report.rows.length, report.passed + report.failed)
assert.equal(report.rows.filter(r => r.status === 'passed').length, report.passed)
assert.equal(report.rows.filter(r => r.status === 'failed').length, report.failed)
assert.ok(report.rows.every(r => report.selected.includes(r.tool)))
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex')
assert.equal(report.schema.sha256, hash('resources/ast-schema.json'), 'Schema changed after this report was measured')
for (const file of ['cases.json', 'losses.json']) assert.equal(report.fixtureHashes?.[file], hash(`tests/external-compat/${file}`), `${file} changed after this report was measured`)
if(report.engineConfigSha256)assert.equal(report.engineConfigSha256,hash('resources/engines.json'),'Engine pins changed after this report was measured')
if (Object.hasOwn(report, 'importerAssessmentSha256')) assert.equal(report.importerAssessmentSha256, hash('resources/importer-assessment.json'), 'Importer assessment changed after this report was measured')
let commonmark
if (existsSync(commonmarkPath)) {
  commonmark = JSON.parse(readFileSync(commonmarkPath))
  assert.equal(commonmark.schemaVersion, 1)
  assert.equal(commonmark.kind, 'commonmark-spec')
  assert.equal(commonmark.spec?.sha256, hash('tests/commonmark-spec/spec.json'), 'CommonMark spec changed after this report was measured')
  assert.equal(commonmark.engineConfigSha256, hash('resources/engines.json'), 'Engine pins changed after the CommonMark measurement')
  assert.equal(commonmark.declaredSha256, hash('tests/commonmark-spec/declared.json'), 'Declarations changed after the CommonMark measurement')
  const spec = JSON.parse(readFileSync('tests/commonmark-spec/spec.json')), byExample = new Map(spec.map(e => [e.example,e]))
  const differences = validateDeclarations(readFileSync('tests/commonmark-spec/declared.json'), spec)
  const declaredExamples = new Map(differences.flatMap(d => d.examples.map(example => [example,d.id])))
  assert.equal(commonmark.spec.examples, spec.length, 'Incomplete CommonMark spec measurement')
  assert.ok(Array.isArray(commonmark.rows) && Array.isArray(commonmark.selectedEngines) && commonmark.selectedEngines.length > 0)
  assert.equal(new Set(commonmark.selectedEngines).size, commonmark.selectedEngines.length)
  assert.ok(commonmark.rows.every(r => commonmark.selectedEngines.includes(r.engine) && ['match','mismatch','declared','not-comparable','failed'].includes(r.status)), 'Invalid CommonMark result row')
  assert.deepEqual(Object.keys(commonmark.totals).sort(), [...commonmark.selectedEngines].sort())
  const statuses = [['match','match'],['mismatch','mismatch'],['not-comparable','notComparable'],['failed','failed']]
  const engineStatuses = [...statuses,['declared','declared']]
  assert.ok(commonmark.baselines === undefined || (commonmark.baselines !== null && typeof commonmark.baselines === 'object' && !Array.isArray(commonmark.baselines)), 'Invalid CommonMark baselines')
  const baselines = Object.keys(commonmark.baselines ?? {})
  for (const name of baselines) {
    assert.equal(name, 'pandoc-djot', 'Unknown CommonMark baseline')
    const baseline = commonmark.baselines[name], rows = baseline.rows
    assert.ok(!Object.hasOwn(baseline.totals, 'declared'), 'CommonMark baseline has no declared count')
    for (const tool of ['converter','renderer']) for (const key of ['name','version']) assert.equal(typeof baseline[tool]?.[key], 'string', `Missing CommonMark baseline ${tool} ${key}`)
    assert.equal(baseline.converter.command, '-f commonmark -t djot --wrap=preserve', 'Invalid CommonMark baseline command')
    assert.ok(Array.isArray(rows), `CommonMark ${name}: missing rows`)
    assert.equal(rows.length, spec.length, `CommonMark ${name}: incomplete rows`)
    assert.equal(new Set(rows.map(r => r.example)).size, spec.length, `CommonMark ${name}: duplicate example`)
    for (const row of rows) {
      assert.ok(['match','mismatch','not-comparable','failed'].includes(row.status), 'Invalid CommonMark baseline status')
      assert.equal(row.section, byExample.get(row.example)?.section, 'Invalid CommonMark baseline example or section')
      for (const key of ['output','html']) assert.equal(typeof row[key], 'string', `CommonMark baseline row missing ${key}`)
      if (Object.hasOwn(row, 'error')) assert.equal(typeof row.error, 'string', 'Invalid CommonMark baseline error')
      assert.ok(!Object.hasOwn(row, 'honesty') && !Object.hasOwn(row, 'reportClass'), 'CommonMark baseline has no fidelity report')
      assert.ok(!Object.hasOwn(row, 'declaration'), 'CommonMark baseline has no declaration')
    }
    for (const [status,key] of statuses) assert.equal(baseline.totals?.[key], rows.filter(r => r.status === status).length, `CommonMark ${name}: inconsistent ${key} count`)
  }
  for (const row of commonmark.rows) {
    assert.equal(row.section, byExample.get(row.example)?.section, 'Invalid CommonMark example or section')
    assert.equal(row.markdown, byExample.get(row.example)?.markdown, 'CommonMark Markdown differs from the spec')
    assert.equal(row.expectedHtml, byExample.get(row.example)?.html, 'CommonMark expected HTML differs from the spec')
    for (const key of ['markdown','expectedHtml','carve','carveHtml']) assert.equal(typeof row[key], 'string', `CommonMark row missing ${key}`)
    assert.ok(Array.isArray(row.diagnostics) && row.diagnostics.every(d => typeof d?.code === 'string'), 'Invalid CommonMark diagnostics')
    assert.ok(['names-loss','unverified-only','clean'].includes(row.reportClass), 'Invalid CommonMark report class')
    assert.equal(row.honesty, ['match','mismatch','declared'].includes(row.status) ? honesty(row.status !== 'mismatch', row.reportClass) : null, 'Invalid CommonMark honesty outcome')
    const id = declaredExamples.get(row.example)
    if (row.status === 'declared' || (row.status === 'mismatch' && id)) {
      assert.ok(id, 'Undeclared CommonMark example')
      assert.deepEqual(row.declaration, row.status === 'declared' ? {id} : {id,insufficient:true}, 'Invalid CommonMark declaration annotation')
    } else assert.ok(!Object.hasOwn(row, 'declaration'), 'Unexpected CommonMark declaration annotation')
  }
  assert.ok(Array.isArray(commonmark.declarations), 'Missing CommonMark declarations')
  assert.deepEqual(commonmark.declarations, differences.map(d => {
    const selected = engine => commonmark.rows.filter(r => r.engine === engine && d.examples.includes(r.example))
    return { ...d, declared:Object.fromEntries(commonmark.selectedEngines.map(engine => [engine,selected(engine).filter(r => r.status === 'declared').length])), stale:Object.fromEntries(commonmark.selectedEngines.map(engine => [engine,selected(engine).filter(r => r.status === 'match').map(r => r.example)])), insufficient:Object.fromEntries(commonmark.selectedEngines.map(engine => [engine,selected(engine).filter(r => r.declaration?.insufficient).map(r => r.example)])) }
  }), 'Inconsistent CommonMark declaration summaries')
  for (const engine of commonmark.selectedEngines) {
    const rows = commonmark.rows.filter(r => r.engine === engine), totals = commonmark.totals[engine]
    assert.equal(typeof commonmark.engines?.[engine]?.name, 'string', `Missing CommonMark engine metadata: ${engine}`)
    assert.equal(rows.length, spec.length, `CommonMark ${engine}: incomplete rows`)
    assert.equal(new Set(rows.map(r => r.example)).size, spec.length, `CommonMark ${engine}: duplicate example`)
    for (const [status,key] of engineStatuses) assert.equal(totals[key], rows.filter(r => r.status === status).length, `CommonMark ${engine}: inconsistent ${key} count`)
    assert.ok(rows.filter(r => r.status === 'mismatch').every(r => ['names-loss','unverified-only','clean'].includes(r.reportClass)), 'Invalid CommonMark mismatch report class')
    for (const cls of ['names-loss','unverified-only','clean']) assert.equal(totals.mismatchByReport?.[cls], rows.filter(r => r.status === 'mismatch' && r.reportClass === cls).length, `CommonMark ${engine}: inconsistent ${cls} count`)
    for (const outcome of honestyOutcomes) assert.equal(totals.honesty?.[outcome], rows.filter(r => r.honesty === outcome).length, `CommonMark ${engine}: inconsistent ${outcome} honesty count`)
    assert.equal(Object.values(totals.honesty).reduce((sum,n) => sum+n, 0), totals.match + totals.mismatch + totals.declared, `CommonMark ${engine}: inconsistent honesty total`)
  }
  assert.ok(Array.isArray(commonmark.reportDisagreements), 'Missing CommonMark report disagreements')
  assert.ok(Array.isArray(commonmark.sections), 'Missing CommonMark section results')
  assert.deepEqual(commonmark.sections.map(s => s.section), [...new Set(spec.map(e => e.section))], 'Invalid CommonMark section order')
  for (const s of commonmark.sections) {
    assert.equal(s.examples, spec.filter(e => e.section === s.section).length)
    assert.deepEqual(Object.keys(s.baselines ?? {}).sort(), [...baselines].sort(), 'Invalid CommonMark section baselines')
    for (const name of baselines) for (const [status,key] of statuses) assert.equal(s.baselines[name]?.[key], commonmark.baselines[name].rows.filter(r => r.section === s.section && r.status === status).length, `CommonMark ${name}/${s.section}: inconsistent ${key} count`)
    for (const engine of commonmark.selectedEngines) for (const [status,key] of engineStatuses) assert.equal(s.results?.[engine]?.[key], commonmark.rows.filter(r => r.engine === engine && r.section === s.section && r.status === status).length, `CommonMark ${engine}/${s.section}: inconsistent ${key} count`)
  }
}
const tools = JSON.parse(readFileSync('site/tools.json'))
assert.ok([...report.selected, ...report.notMeasured].every(t => tools.some(tool => tool.id === t)))
mkdirSync('dist', { recursive: true })
cpSync('site', 'dist', { recursive: true })
assert.ok(readFileSync('site/index.html','utf8').includes('src="app.js"'),'Application script reference missing')
assert.ok(readFileSync('site/index.html','utf8').includes('href="style.css"'),'Stylesheet reference missing')
const html=readFileSync('site/index.html','utf8').replace('src="app.js"',`src="app.js?v=${hash('site/app.js').slice(0,12)}"`).replace('href="style.css"',`href="style.css?v=${hash('site/style.css').slice(0,12)}"`)
writeFileSync('dist/index.html',html)
writeFileSync('dist/report.json', JSON.stringify(report, null, 2) + '\n')
if (commonmark) writeFileSync('dist/commonmark.json', JSON.stringify(commonmark, null, 2) + '\n')
else rmSync('dist/commonmark.json', { force:true })
writeFileSync('dist/manifest.json', JSON.stringify({ generatedAt: report.generatedAt, runUrl: process.env.GITHUB_RUN_ID ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null, tools }, null, 2) + '\n')
cpSync('resources/engines.json','dist/engines.json')
cpSync('resources/ast-schema.json', 'dist/ast-schema.json')
cpSync('tests/external-compat/cases.json', 'dist/cases.json')
cpSync('tests/external-compat/losses.json', 'dist/losses.json')
console.log(`Built site from ${report.rows.length} measured cases (${report.failed} failures).`)
console.log(commonmark ? `Included CommonMark report from ${commonmarkPath} (${commonmark.rows.length} examples across engines).` : `CommonMark report absent at ${commonmarkPath}; built without it.`)
