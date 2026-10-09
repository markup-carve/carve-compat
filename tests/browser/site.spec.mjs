import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
const measured = JSON.parse(readFileSync('dist/report.json'))
const report = { ...measured, selected: ['mdast'], notMeasured: ['hast', 'commonmark', 'cmark', 'djot', 'docutils', 'asciidoctor', 'md4c'], passed: 2, failed: 0, rows: [
  { tool: 'mdast', case: 'inline-structure', kind: 'supported', status: 'passed', version: 'browser-fixture', checks: ['ast-schema'], importer:{reportClass:'unverified-only',honesty:'ok',codes:['fidelity-unverified']}, diagnostics: [], evidence: { sourceFormat: 'markdown', source: '**word**', carve: '*word*', ast: { type: 'document', children: [] }, exportedSource: '**word**' } },
  { tool: 'mdast', case: 'unsupported-field', kind: 'loss', status: 'passed', version: 'browser-fixture', checks: ['loss-diagnostic'], diagnostics: [{ path: '/attrs', code: 'unsupported-field', fidelity: 'dropped', message: 'Browser fixture diagnostic.' }], evidence: { sourceFormat: 'carve', source: 'word', ast: { type: 'document', children: [] }, expected: { path: '/attrs', code: 'unsupported-field', fidelity: 'dropped' }, retained: 'word' } },
] }
const commonmark = {
  schemaVersion:1, kind:'commonmark-spec', spec:{version:'0.31.2',examples:652}, selectedEngines:['javascript','php'], engines:{javascript:{name:'Carve JavaScript'},php:{name:'Carve PHP'}},
  reportDisagreements:[{example:485,section:'Links',classes:{javascript:'clean',php:'names-loss'},codes:{javascript:[],php:['link-loss']}}],
  totals:{javascript:{honesty:{reported:0,unassessed:0,'silent-loss':1,'false-loss':0,ok:0},match:0,mismatch:1,declared:0,notComparable:0,failed:1,mismatchByReport:{'names-loss':0,'unverified-only':0,clean:1}},php:{honesty:{reported:1,unassessed:0,'silent-loss':0,'false-loss':0,ok:0},match:0,mismatch:1,declared:0,notComparable:0,failed:0,mismatchByReport:{'names-loss':1,'unverified-only':0,clean:0}}},
  baselines:{'pandoc-djot':{converter:{name:'pandoc',version:'3.11',command:'-f commonmark -t djot --wrap=preserve'},renderer:{name:'@djot/djot',version:'0.3.2'},totals:{match:1,mismatch:1,notComparable:0,failed:0},rows:[{example:485,section:'Links',status:'match',output:'[foo]()',html:'<p><a href="">foo</a></p>'},{example:486,section:'Links',status:'mismatch',output:'baseline-only evidence',html:'<p>baseline-only evidence</p>'}]}},
  sections:[{section:'Links',examples:2,results:{javascript:{match:0,mismatch:1,declared:0,notComparable:0,failed:1},php:{match:0,mismatch:1,declared:0,notComparable:0,failed:0}},baselines:{'pandoc-djot':{match:1,mismatch:1,notComparable:0,failed:0}}}],
  rows:[
    {engine:'javascript',example:485,section:'Links',status:'mismatch',markdown:'[foo]()',expectedHtml:'<p><a href="">foo</a></p>',carve:'foo',carveHtml:'<p>foo</p>',diagnostics:[],reportClass:'clean'},
    {engine:'javascript',example:486,section:'Links',status:'failed',markdown:'broken input',expectedHtml:'<p>broken input</p>',carve:'',carveHtml:'',diagnostics:[],reportClass:'clean',error:'Importer failed'},
    {engine:'php',example:485,section:'Links',status:'mismatch',markdown:'[foo]()',expectedHtml:'<p><a href="">foo</a></p>',carve:'foo',carveHtml:'<p>foo</p>',diagnostics:[{code:'link-loss',fidelity:'dropped'}],reportClass:'names-loss'},
  ],
}
test('CommonMark measurement shows totals, section counts, failures and engine filtering', async ({ page }) => {
  await page.route('**/commonmark.json', route => route.fulfill({json:commonmark}))
  await page.goto('/')
  await expect(page.locator('#commonmark-title')).toHaveText('CommonMark spec examples')
  await expect(page.getByRole('link', {name:'Download CommonMark report'})).toHaveAttribute('href', 'commonmark.json')
  await expect(page.getByRole('link', {name:'Download CommonMark report'})).toHaveAttribute('download', '')
  await expect(page.locator('#commonmark-totals tbody tr')).toHaveCount(3)
  const baselineRow = page.locator('#commonmark-totals tbody tr').last()
  await expect(baselineRow.locator('th')).toHaveText('pandoc to Djot (baseline)')
  await expect(baselineRow.locator('td')).toHaveText(['1','1','n/a','0','0',...Array(8).fill('n/a')])
  await expect(page.locator('#commonmark-baseline-note')).toContainText('reference point, not a target for Carve')
  await expect(page.locator('#commonmark-sections thead th').last()).toHaveText('pandoc to Djot (baseline)')
  await expect(page.locator('#commonmark-sections tbody td').last()).toHaveText('1/2')
  await expect(page.locator('#commonmark-engine-filter option')).toHaveCount(3)
  await expect(page.locator('#commonmark-examples')).not.toContainText('baseline-only evidence')
  await expect(page.locator('#commonmark-totals thead')).toContainText('Clean report = silent')
  for (const outcome of ['reported','unassessed','silent-loss','false-loss','ok']) await expect(page.locator('#commonmark-totals thead')).toContainText(outcome)
  await expect(page.locator('#commonmark-totals tbody tr').first().locator('td').nth(10)).toHaveText('1')
  await expect(page.locator('#commonmark-disagreements a')).toHaveAttribute('href', 'https://spec.commonmark.org/0.31.2/#example-485')
  await expect(page.locator('#commonmark-disagreements')).toContainText('Links')
  await expect(page.locator('#commonmark-disagreements')).toContainText('Carve JavaScript: clean')
  await expect(page.locator('#commonmark-disagreements')).toContainText('Carve PHP: names-loss (codes: link-loss)')
  await expect(page.locator('#commonmark-silent')).toContainText('Carve JavaScript 1')
  await expect(page.locator('#commonmark-sections tbody')).toContainText('0/1')
  await expect(page.locator('#commonmark-examples>li')).toHaveCount(3)
  await page.locator('#commonmark-examples>li').nth(1).locator('summary').first().click()
  await expect(page.locator('#commonmark-examples>li').nth(1)).toContainText('Importer failed')
  await page.selectOption('#commonmark-engine-filter', 'php')
  await expect(page.locator('#commonmark-examples>li')).toHaveCount(1)
  await page.locator('#commonmark-examples>li>details>summary').click()
  await expect(page.locator('#commonmark-examples a')).toHaveAttribute('href', 'https://spec.commonmark.org/0.31.2/#example-485')
  await expect(page.locator('#commonmark-examples')).toContainText('link-loss')
  await expect(page.locator('#commonmark-examples pre')).toHaveCount(4)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('CommonMark Markdown and HTML evidence stays text', async ({ page }) => {
  const payload = '<img src=x onerror="window.commonmarkInjected=true"><script>window.commonmarkInjected=true</script>'
  const changed = structuredClone(commonmark)
  changed.rows[0].markdown = payload; changed.rows[0].expectedHtml = payload
  changed.rows[0].carve = payload; changed.rows[0].carveHtml = payload
  changed.reportDisagreements[0].section = payload
  changed.reportDisagreements[0].classes.javascript = payload
  changed.reportDisagreements[0].codes.php = [payload]
  changed.baselines['pandoc-djot'].totals.match = payload
  changed.baselines['pandoc-djot'].rows[1].output = payload
  changed.baselines['pandoc-djot'].rows[1].html = payload
  changed.sections[0].baselines['pandoc-djot'].match = payload
  await page.route('**/commonmark.json', route => route.fulfill({json:changed}))
  await page.goto('/'); await page.selectOption('#commonmark-engine-filter', 'javascript')
  await page.locator('#commonmark-examples>li>details>summary').first().click()
  for (const pre of await page.locator('#commonmark-examples>li').first().locator('pre').all()) await expect(pre).toHaveText(payload)
  await expect(page.locator('#commonmark-disagreements')).toContainText(payload)
  await expect(page.locator('#commonmark-totals tbody tr').last()).toContainText(payload)
  await expect(page.locator('#commonmark-sections tbody td').last()).toContainText(payload)
  await expect(page.locator('#commonmark img, #commonmark script')).toHaveCount(0)
  expect(await page.evaluate(() => window.commonmarkInjected)).toBeUndefined()
})

test('CommonMark declarations show counts and warnings while excluding declared rows from mismatches', async ({ page }) => {
  const changed = structuredClone(commonmark)
  changed.totals.javascript.declared = 1
  changed.sections[0].results.javascript.declared = 1
  changed.rows.push({engine:'javascript',example:520,section:'Links',status:'declared',markdown:'![alt](a.png)',expectedHtml:'<p><img src="a.png" alt="alt"></p>',carveHtml:'<img src="a.png" alt="alt">',diagnostics:[],reportClass:'clean',declaration:{id:'lone-image-block'}})
  const payload = '<img src=x onerror="window.commonmarkInjected=true"><script>window.commonmarkInjected=true</script>'
  changed.declarations = [{id:'lone-image-block',reason:payload,reference:'https://example.com/rendering',examples:[520,572,573],declared:{javascript:1,php:0},stale:{javascript:[572],php:[]},insufficient:{javascript:[],php:[573]}}]
  await page.route('**/commonmark.json', route => route.fulfill({json:changed}))
  await page.goto('/')
  await expect(page.locator('#commonmark-totals thead th').nth(3)).toHaveText('Declared')
  await expect(page.locator('#commonmark-totals tbody tr').first().locator('td').nth(2)).toHaveText('1')
  await expect(page.locator('#commonmark-totals tbody tr').last().locator('td').nth(2)).toHaveText('n/a')
  await expect(page.locator('#commonmark-sections tbody td').first()).toHaveText('0/2')
  await expect(page.locator('#commonmark-declarations')).toContainText(payload)
  await expect(page.locator('#commonmark-declarations')).toContainText('Carve JavaScript: 1 declared examples')
  await expect(page.locator('#commonmark-declarations')).toContainText('Carve PHP: 0 declared examples')
  await expect(page.locator('#commonmark-declarations')).toContainText('Carve JavaScript stale: examples 572')
  await expect(page.locator('#commonmark-declarations')).toContainText('Carve PHP insufficient: examples 573')
  await expect(page.locator('#commonmark-declarations a')).toHaveAttribute('href', 'https://example.com/rendering')
  await expect(page.locator('#commonmark-examples>li')).toHaveCount(3)
  await expect(page.locator('#commonmark-examples')).not.toContainText('Example 520')
  await expect(page.locator('#commonmark img, #commonmark script')).toHaveCount(0)
  expect(await page.evaluate(() => window.commonmarkInjected)).toBeUndefined()
})

test('CommonMark reports without baselines retain the engine tables', async ({ page }) => {
  const changed = structuredClone(commonmark)
  delete changed.baselines
  for (const section of changed.sections) delete section.baselines
  await page.route('**/commonmark.json', route => route.fulfill({json:changed}))
  await page.goto('/')
  await expect(page.locator('#commonmark-totals tbody tr')).toHaveCount(2)
  await expect(page.locator('#commonmark-sections thead th')).toHaveCount(3)
  await expect(page.locator('#commonmark-baseline-note')).toBeHidden()
})

test('missing CommonMark evidence is marked as not measured', async ({ page }) => {
  await page.route('**/commonmark.json', route => route.fulfill({status:404,body:'Not found'}))
  await page.goto('/')
  await expect(page.locator('#commonmark-note')).toHaveText('Not measured in this report.')
  await expect(page.locator('#commonmark-results')).toBeHidden()
  await expect(page.locator('#load-error')).toBeHidden()
})
test('dashboard renders measured totals, versions, evidence and filters', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await page.route('**/report.json', route => route.fulfill({ json: report }))
  await page.goto('/')
  await expect(page.locator('#stat-tools')).toHaveText(String(report.selected.length))
  await expect(page.locator('#stat-failed')).toHaveText(String(report.failed))
  await expect(page.locator('.tool-card')).toHaveCount(9)
  await expect(page.locator('#engine-version')).toContainText(report.engine.version)
  await page.selectOption('#tool-filter', 'mdast')
  await page.fill('#search', 'inline-structure')
  await expect(page.locator('#matrix tbody tr')).toHaveCount(1)
  await page.locator('#matrix tbody button').click()
  await expect(page.locator('#detail')).toBeVisible()
  await expect(page.locator('#detail-title')).toHaveText('inline-structure')
  await expect(page.locator('#detail-panes')).toContainText('Authored Carve expectation')
  await expect(page.locator('#detail-panes')).toContainText('Mapped Carve AST')
  await expect(page.locator('#detail-panes')).toContainText('Report class: unverified-only')
  await expect(page.locator('#detail-panes')).toContainText('Honesty: ok')
  await expect(page.locator('#detail-panes')).toContainText('Diagnostic codes: fidelity-unverified')
  const url = page.url(); await page.keyboard.press('Escape'); await expect(page.locator('#detail')).toBeHidden()
  await page.goto(url); await expect(page.locator('#detail-title')).toHaveText('inline-structure')
  await page.click('#reset'); await page.selectOption('#kind-filter', 'loss')
  await expect(page.locator('#matrix tbody button').first()).toContainText('L')
  await page.locator('#matrix tbody button').first().click()
  await expect(page.locator('#detail-summary')).toContainText('expected limitation')
  await expect(page.locator('#detail-panes')).toContainText('Required loss diagnostic')
  await expect(page.locator('#detail-panes .badge').first()).toBeVisible()
  await page.click('#reset'); await page.fill('#search', 'no-fixture-has-this-name')
  await expect(page.locator('#empty-results')).toBeVisible()
  expect(errors).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
test('failure evidence and source text are shown without executing HTML', async ({ page }) => {
  const changed = structuredClone(report), row = changed.rows.find(r => r.kind === 'supported')
  row.status = 'failed'; row.error = 'Deliberate browser-test failure'; row.evidence.source = '<img src=x onerror="window.fixtureExecuted=true">'
  row.importer = {reportClass:'names-loss',honesty:'false-loss',codes:['<img src=x onerror=window.fixtureExecuted=true>']}
  changed.passed--; changed.failed++
  await page.route('**/report.json', route => route.fulfill({ json:changed }))
  await page.goto('/')
  await expect(page.locator('#stat-failed')).toHaveText(String(changed.failed))
  await page.selectOption('#status-filter', 'failed')
  await page.locator('#matrix tbody button').first().click()
  await expect(page.locator('#detail-summary')).toHaveText(row.error)
  await expect(page.locator('#detail-panes pre').first()).toContainText('<img src=x')
  await expect(page.locator('#detail-panes')).toContainText(row.importer.codes[0])
  await expect(page.locator('#detail img')).toHaveCount(0)
  expect(await page.evaluate(() => window.fixtureExecuted)).toBeUndefined()
})
test('an unavailable report is explicit', async ({ page }) => {
  await page.route('**/report.json', route => route.fulfill({ status:503, body:'unavailable' }))
  await page.goto('/')
  await expect(page.locator('#load-error')).toBeVisible()
  await expect(page.locator('#run-status')).toHaveText('Report unavailable')
})

test('the published report renders without assuming comparisons passed', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#stat-tools')).toHaveText(String(measured.selected.length))
  await expect(page.locator('#stat-failed')).toHaveText(String(measured.failed))
  await expect(page.locator('#load-error')).toBeHidden()
  await expect(page.locator('#case-count')).toContainText(`${measured.rows.filter(r=>(r.engine??'javascript')==='javascript').length} measured target/case pairs`)
})
test('failed losses retain required evidence without a mapped AST', async ({ page }) => {
  const changed = structuredClone(report), row = changed.rows[1]
  row.status = 'failed'; row.error = 'Missing expected loss'; delete row.evidence.ast
  row.errorDetails = { operator: '==', actual: false, expected: true }
  changed.passed--; changed.failed++
  await page.route('**/report.json', route => route.fulfill({ json: changed }))
  await page.goto('/'); await page.selectOption('#kind-filter', 'loss'); await page.locator('#matrix tbody button').click()
  await expect(page.locator('#detail-summary')).toHaveText(row.error)
  await expect(page.locator('#detail-panes')).toContainText('Required loss diagnostic')
  await expect(page.locator('#detail-panes')).toContainText('Failure comparison')
  await expect(page.locator('#detail-panes')).toContainText('Browser fixture diagnostic.')
})
test('target handoff clears permalinks and unmeasured targets stay explicit', async ({ page }) => {
  const changed = { ...report, generatedAt: '2020-01-01T00:00:00Z' }
  await page.route('**/report.json', route => route.fulfill({ json: changed }))
  await page.goto('/?case=unknown&tool=unknown&kind=unknown')
  await expect(page.locator('#detail')).toBeHidden()
  await expect(page.locator('#run-status')).toContainText('report older than 48 hours')
  await expect(page.locator('.tool-card').filter({ hasText: 'hast' }).getByRole('button')).toBeDisabled()
  await expect(page.locator('.tool-card').filter({ hasText: 'hast' })).toContainText('Not measured')
  await page.locator('#matrix tbody button').first().click()
  await page.locator('.tool-card').filter({ hasText: 'mdast' }).getByRole('button').click()
  await expect(page.locator('#tool-filter')).toHaveValue('mdast')
  await expect(page.locator('#tool-filter')).toBeFocused()
  expect(new URL(page.url()).searchParams.has('case')).toBe(false)
})
test('an invalid manifest is explicit', async ({ page }) => {
  await page.route('**/manifest.json', route => route.fulfill({ json: { tools: null } }))
  await page.goto('/'); await expect(page.locator('#load-error')).toBeVisible()
})

test('engine selection and permalinks preserve separate engine evidence', async ({ page }) => {
  const changed=structuredClone(report)
  changed.selectedEngines=['javascript','php']
  changed.engines={javascript:{name:'Carve JavaScript',version:'fixture'},php:{name:'Carve PHP',version:'fixture'}}
  const row={...structuredClone(changed.rows[0]),engine:'php',status:'failed',error:'Authored ID lost',evidence:{...changed.rows[0].evidence,engineAst:{type:'document',children:[]},engineCarve:'[word]{.token}',independentAst:{type:'document',children:[]},independentSource:'<article/>'}}
  changed.rows.push(row);changed.failed++
  await page.route('**/report.json',route=>route.fulfill({json:changed}))
  await page.goto('/');await page.selectOption('#engine-filter','php')
  await expect(page.locator('#matrix tbody button')).toHaveCount(1)
  await page.locator('#matrix tbody button').click()
  await expect(page.locator('#detail-meta')).toContainText('php')
  await expect(page.locator('#detail-panes')).toContainText('Engine canonical Carve')
  await expect(page.locator('#detail-panes')).toContainText('Separate DocBook source')
  const url=page.url();await page.goto(url)
  await expect(page.locator('#engine-filter')).toHaveValue('php')
  await expect(page.locator('#detail-summary')).toHaveText('Authored ID lost')
  await page.click('#reset');await expect(page.locator('#engine-filter')).toHaveValue('javascript')
})

test('cached report and application assets refresh when the website loads', async ({ page }) => {
  const { createServer } = await import('node:http')
  const old = { ...report, passed: 1, failed: 1, rows: report.rows.map((row, i) => ({ ...row, status: i ? 'failed' : 'passed' })) }
  let current = old, reads = 0, scriptReads = 0
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname
    if (path === '/report.json') { reads++; response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=600' }); response.end(JSON.stringify(current)); return }
    if(path==='/app.js'){scriptReads++;const app=readFileSync('dist/app.js','utf8');response.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'max-age=600'});response.end(request.url.includes('?')?app:app.replace("fetch(path, {cache:'no-store'})",'fetch(path)'));return}
    if (path === '/warm') { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<html><body>Warm cache</body></html>'); return }
    const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'], '/icon.svg': ['icon.svg', 'image/svg+xml'], '/manifest.json': ['manifest.json', 'application/json'] }
    const file = files[path]
    if (!file) { response.writeHead(404); response.end(); return }
    response.writeHead(200, { 'Content-Type': file[1] }); response.end(readFileSync(`dist/${file[0]}`))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const base = `http://127.0.0.1:${server.address().port}`
    await page.goto(`${base}/warm`)
    await page.evaluate(async () => { await (await fetch('/report.json')).json(); await (await fetch('/report.json')).json(); await (await fetch('/app.js')).text() })
    expect(reads).toBe(1)
    expect(scriptReads).toBe(1)
    current = report
    await page.goto(base)
    await expect(page.locator('#run-status')).toContainText('2 passed · 0 failed')
    expect(reads).toBe(2)
    expect(scriptReads).toBe(2)
    await expect(page.locator('#load-error')).toBeHidden()
  } finally { await new Promise(resolve => { server.close(resolve); server.closeAllConnections() }) }
})

test('AST interchange cases show their source-conversion boundaries', async ({ page }) => {
  await page.goto('/')
  await page.locator('#engine-filter').selectOption('javascript')
  const button=page.locator('button[data-case="rich-table-combinations"][data-tool="hast"]')
  await expect(button).toHaveText('I')
  await button.click()
  await expect(page.locator('#detail-summary')).toContainText('AST fields')
  await expect(page.locator('#detail-summary')).toContainText('does not claim a lossless source round trip')
  await page.getByText('Engine source before/after changes',{exact:true}).click()
  await expect(page.locator('#detail-panes')).toContainText('/children/0/rowGroups')
  await expect(page.locator('#detail-panes')).toContainText('Reference Carve source conversion and diagnostics')
})

test('failed AST interchange rows retain their error message', async ({ page }) => {
  const failed={...report,passed:0,failed:1,rows:[{...report.rows[0],case:'interchange-failure',status:'failed',error:'Source conversion boundary failed',evidence:{scope:'AST interchange',sourceChanges:[]}}]}
  await page.route('**/report.json',route=>route.fulfill({json:failed}))
  await page.goto('/')
  await page.locator('#matrix tbody button').click()
  await expect(page.locator('#detail-summary')).toHaveText('Source conversion boundary failed')
  await expect(page.locator('#detail-summary')).not.toContainText('preserved')
})

test('native AST evidence shows engine source changes without a lossless round-trip label', async ({ page }) => {
  test.skip(!report.selectedEngines.includes('php'), 'PHP was not measured')
  await page.goto('/')
  await page.locator('#engine-filter').selectOption('php')
  await page.locator('button[data-case="multiple-bodies-caption-widths-and-spans"][data-tool="hast"]').click()
  await expect(page.locator('#detail-checks')).toContainText('Declared source conversion changes')
  await expect(page.locator('#detail-checks')).not.toContainText('Carve source round trip')
  await page.getByText('Engine source before/after changes', { exact: true }).click()
  await expect(page.locator('#detail-panes')).toContainText('/children/0/rows/5/cells/0/header')
  const changes = page.locator('details').filter({ has: page.getByText('Engine source before/after changes', { exact: true }) })
  await expect(changes).not.toContainText('/children/0/rows/0/cells/1/header')
})
