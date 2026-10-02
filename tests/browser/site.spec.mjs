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
  await expect(page.locator('.tool-card')).toHaveCount(8)
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
  await expect(page.locator('#case-count')).toContainText(`${measured.rows.length} measured target/case pairs`)
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
