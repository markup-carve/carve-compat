import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
const measured = JSON.parse(readFileSync('dist/report.json'))
const report = { ...measured, selected: ['mdast'], notMeasured: ['hast', 'commonmark', 'cmark', 'djot', 'docutils', 'asciidoctor', 'md4c'], passed: 2, failed: 0, rows: [
  { tool: 'mdast', case: 'inline-structure', kind: 'supported', status: 'passed', version: 'browser-fixture', checks: ['ast-schema'], diagnostics: [], evidence: { sourceFormat: 'markdown', source: '**word**', carve: '*word*', ast: { type: 'document', children: [] }, exportedSource: '**word**' } },
  { tool: 'mdast', case: 'unsupported-field', kind: 'loss', status: 'passed', version: 'browser-fixture', checks: ['loss-diagnostic'], diagnostics: [{ path: '/attrs', code: 'unsupported-field', fidelity: 'dropped', message: 'Browser fixture diagnostic.' }], evidence: { sourceFormat: 'carve', source: 'word', ast: { type: 'document', children: [] }, expected: { path: '/attrs', code: 'unsupported-field', fidelity: 'dropped' }, retained: 'word' } },
] }
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
  changed.passed--; changed.failed++
  await page.route('**/report.json', route => route.fulfill({ json:changed }))
  await page.goto('/')
  await expect(page.locator('#stat-failed')).toHaveText(String(changed.failed))
  await page.selectOption('#status-filter', 'failed')
  await page.locator('#matrix tbody button').first().click()
  await expect(page.locator('#detail-summary')).toHaveText(row.error)
  await expect(page.locator('#detail-panes pre').first()).toContainText('<img src=x')
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
