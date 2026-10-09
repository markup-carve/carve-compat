import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, cpSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

test('the site refuses stale-format reports and inconsistent result counts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'carve-compat-site-'))
  try {
    const path = join(dir, 'report.json')
    for (const report of [
      { schemaVersion:1, rows:[], passed:0, failed:0 },
      { schemaVersion:1, generatedAt:'2026-01-01T00:00:00Z', engine:{}, schema:{}, rows:[], passed:1, failed:0 },
    ]) {
      writeFileSync(path, JSON.stringify(report))
      const result = spawnSync(process.execPath, ['scripts/build-site.mjs', path], { encoding:'utf8' })
      assert.equal(result.status, 1)
    }
  } finally { rmSync(dir, { recursive:true, force:true }) }
})

test('the site includes an optional CommonMark report and rejects stale or inconsistent evidence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'carve-compat-commonmark-site-'))
  const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex')
  try {
    for (const path of ['site','resources','tests/external-compat','tests/commonmark-spec']) cpSync(path, join(dir,path), { recursive:true })
    mkdirSync(join(dir,'reports'))
    const report = { schemaVersion:1, generatedAt:'2026-01-01T00:00:00Z', engine:{}, schema:{sha256:hash('resources/ast-schema.json')}, fixtureHashes:Object.fromEntries(['cases.json','losses.json'].map(file => [file,hash(`tests/external-compat/${file}`)])), selected:[], notMeasured:[], rows:[], passed:0, failed:0 }
    writeFileSync(join(dir,'reports/latest.json'), JSON.stringify(report))
    const spec = JSON.parse(readFileSync('tests/commonmark-spec/spec.json'))
    const counts = {match:652,mismatch:0,notComparable:0,failed:0}
    const commonmark = { schemaVersion:1, kind:'commonmark-spec', spec:{sha256:hash('tests/commonmark-spec/spec.json'),examples:652}, engineConfigSha256:hash('resources/engines.json'), selectedEngines:['javascript'], engines:{javascript:{name:'Carve JavaScript'}}, reportDisagreements:[], totals:{javascript:{...counts,honesty:{reported:0,unassessed:0,'silent-loss':0,'false-loss':0,ok:652},mismatchByReport:{'names-loss':0,'unverified-only':0,clean:0}}}, rows:spec.map(e => ({engine:'javascript',example:e.example,section:e.section,status:'match',markdown:e.markdown,expectedHtml:e.html,carve:'',carveHtml:'',diagnostics:[],reportClass:'clean',honesty:'ok'})), sections:[...new Set(spec.map(e => e.section))].map(section => {const examples = spec.filter(e => e.section === section).length;return {section,examples,results:{javascript:{...counts,match:examples}}}}) }
    const custom = join(dir,'optional.json'), output = join(dir,'dist/commonmark.json')
    const build = (...args) => spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/build-site.mjs', import.meta.url)),...args], { cwd:dir, encoding:'utf8' })
    const absent = build(); assert.equal(absent.status, 0, absent.stderr); assert.match(absent.stdout, /built without it/); assert.equal(existsSync(output), false)
    writeFileSync(custom, JSON.stringify(commonmark))
    const included = build('reports/latest.json', '--commonmark=optional.json')
    assert.equal(included.status, 0, included.stderr); assert.match(included.stdout, /Included CommonMark/)
    assert.deepEqual(JSON.parse(readFileSync(output)), commonmark)
    for (const broken of [
      {...commonmark,schemaVersion:2}, {...commonmark,kind:'other'}, {...commonmark,spec:{sha256:'stale'}}, {...commonmark,engineConfigSha256:'stale'},
      {...commonmark,totals:{javascript:{...commonmark.totals.javascript,match:653}}},
      {...commonmark,totals:{javascript:{...commonmark.totals.javascript,mismatchByReport:{'names-loss':0,'unverified-only':0,clean:1}}}},
      {...commonmark,rows:commonmark.rows.slice(1),totals:{javascript:{...commonmark.totals.javascript,match:651}}},
      {...commonmark,rows:[commonmark.rows[0],...commonmark.rows.slice(0,-1)]},
      {...commonmark,rows:[{...commonmark.rows[0],markdown:'wrong source'},...commonmark.rows.slice(1)]},
      {...commonmark,rows:[{...commonmark.rows[0],expectedHtml:'wrong expectation'},...commonmark.rows.slice(1)]},
      {...commonmark,engines:{}}, {...commonmark,sections:[]},
      {...commonmark,reportDisagreements:{}},
      {...commonmark,totals:{javascript:{...commonmark.totals.javascript,honesty:{reported:0,unassessed:0,'silent-loss':0,'false-loss':0,ok:651}}}},
      {...commonmark,rows:[{...commonmark.rows[0],honesty:'false-loss'},...commonmark.rows.slice(1)]},
    ]) {
      writeFileSync(custom, JSON.stringify(broken))
      assert.equal(build('--commonmark=optional.json').status, 1)
    }
    const statuses = [['match','match'],['mismatch','mismatch'],['not-comparable','notComparable'],['failed','failed']]
    const count = rows => Object.fromEntries(statuses.map(([status,key]) => [key,rows.filter(r => r.status === status).length]))
    const rows = spec.map(e => ({example:e.example,section:e.section,status:statuses[e.example % 4][0],output:'Djot source',html:'<p>Rendered Djot</p>'}))
    const baseline = {converter:{name:'pandoc',version:'3.11',command:'-f commonmark -t djot --wrap=preserve'},renderer:{name:'@djot/djot',version:'0.3.2'},totals:count(rows),rows}
    const withBaseline = {...commonmark,baselines:{'pandoc-djot':baseline},sections:commonmark.sections.map(s => ({...s,baselines:{'pandoc-djot':count(rows.filter(r => r.section === s.section))}}))}
    writeFileSync(custom, JSON.stringify(withBaseline))
    const includedBaseline = build('--commonmark=optional.json')
    assert.equal(includedBaseline.status, 0, includedBaseline.stderr)
    assert.deepEqual(JSON.parse(readFileSync(output)), withBaseline)
    const baselineReport = patch => ({...withBaseline,baselines:{'pandoc-djot':{...baseline,...patch}}})
    const wrongSection = structuredClone(withBaseline); wrongSection.sections[0].baselines['pandoc-djot'].match++
    const missingSection = structuredClone(withBaseline); delete missingSection.sections[0].baselines
    for (const [broken,message] of [
      [baselineReport({totals:{...baseline.totals,match:653}}), /pandoc-djot: inconsistent match count/],
      [baselineReport({rows:rows.slice(1)}), /pandoc-djot: incomplete rows/],
      [baselineReport({rows:[rows[0],...rows.slice(0,-1)]}), /pandoc-djot: duplicate example/],
      [baselineReport({rows:[{...rows[0],status:'other'},...rows.slice(1)]}), /Invalid CommonMark baseline status/],
      [baselineReport({rows:[{...rows[0],section:'other'},...rows.slice(1)]}), /Invalid CommonMark baseline example or section/],
      [baselineReport({rows:[{...rows[0],html:null},...rows.slice(1)]}), /baseline row missing html/],
      [baselineReport({rows:[{...rows[0],honesty:'ok'},...rows.slice(1)]}), /baseline has no fidelity report/],
      [wrongSection, /pandoc-djot\/Tabs: inconsistent match count/],
      [missingSection, /Invalid CommonMark section baselines/],
    ]) {
      writeFileSync(custom, JSON.stringify(broken))
      const result = build('--commonmark=optional.json')
      assert.equal(result.status, 1)
      assert.match(result.stderr, message)
    }
    const withoutBaseline = {...commonmark,baselines:{},sections:commonmark.sections.map(s => ({...s,baselines:{}}))}
    writeFileSync(custom, JSON.stringify(withoutBaseline))
    assert.equal(build('--commonmark=optional.json').status, 0)
    assert.deepEqual(JSON.parse(readFileSync(output)).baselines, {})
    writeFileSync(join(dir,'reports/latest.json'), JSON.stringify({...report,importerAssessmentSha256:'stale'}))
    assert.equal(build().status, 1, 'Stale importer assessment must fail')
    writeFileSync(join(dir,'reports/latest.json'), JSON.stringify({...report,importerAssessmentSha256:hash('resources/importer-assessment.json')}))
    assert.equal(build().status, 0); assert.equal(existsSync(output), false, 'Absent report must remove a stale site artifact')
  } finally { rmSync(dir, { recursive:true, force:true }) }
})
