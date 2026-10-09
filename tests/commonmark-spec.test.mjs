import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { validateSpec, compareHtml, reportClass, runCommonmarkSpec, renderedWhitespace } from '../scripts/compat/commonmark-spec.mjs'

test('the vendored CommonMark spec is complete and unchanged', () => {
  const examples = validateSpec()
  assert.equal(examples.length, 652)
  const duplicate = structuredClone(examples); duplicate[1].example = duplicate[0].example
  assert.throws(() => validateSpec(JSON.stringify(duplicate)), /Duplicate/)
  assert.throws(() => validateSpec(JSON.stringify(examples.slice(1))), /652 examples/)
  const changed = structuredClone(examples); changed[0].markdown += 'changed'
  assert.throws(() => validateSpec(JSON.stringify(changed)), /checksum/)
  assert.equal(validateSpec(readFileSync('tests/commonmark-spec/spec.json')).length, 652)
})

test('HTML comparison ignores renderer indentation, collapsed whitespace and generated heading structure', () => {
  const flush = '<ul>\n<li>foo\n<ul>\n<li>bar</li>\n</ul>\n</li>\n</ul>\n'
  const indented = '<ul>\n  <li>foo\n    <ul>\n      <li>bar</li>\n    </ul>\n  </li>\n</ul>\n'
  assert.equal(compareHtml(flush, indented).status, 'match')
  assert.equal(compareHtml('<h1>foo</h1>\n<p>bar</p>\n', '<section id="foo"><h1 id="foo">foo</h1>\n<p>bar</p></section>').status, 'match')
  assert.equal(compareHtml('<p>  foo\t\nbar </p>', '<p>foo bar</p>').status, 'match')
  assert.deepEqual(renderedWhitespace({type:'paragraph',children:[{type:'text',value:' '},{type:'text',value:'foo'},{type:'text',value:'\t'}]}).children, [{type:'text',value:'foo'}])
})

test('HTML comparison retains expected-side boundaries, link structure and code whitespace', () => {
  assert.equal(compareHtml('<div>foo</div>', '<p>foo</p>').status, 'not-comparable')
  assert.equal(compareHtml('<p><a href="">foo</a></p>', '<p>foo</p>').status, 'mismatch')
  assert.equal(compareHtml('<h1 id="authored">foo</h1>', '<h1 id="generated">foo</h1>').status, 'mismatch')
  assert.equal(compareHtml('<pre><code>foo  bar\n</code></pre>', '<pre><code>foo bar\n</code></pre>').status, 'mismatch')
  assert.equal(compareHtml('<pre><code>x\n  </code></pre>', '<pre><code>x\n</code></pre>').status, 'mismatch')
  assert.equal(compareHtml('<p><code>foo  bar</code></p>', '<p><code>foo bar</code></p>').status, 'mismatch')
})

test('migration diagnostics distinguish named losses, unverified reports and clean reports', () => {
  assert.equal(reportClass([]), 'clean')
  assert.equal(reportClass([{code:'spelling',fidelity:'normalized'}]), 'clean')
  assert.equal(reportClass([{code:'fidelity-unverified',fidelity:'degraded'}]), 'unverified-only')
  assert.equal(reportClass([{code:'fidelity-unverified',fidelity:'preserved'}]), 'unverified-only')
  for (const fidelity of ['degraded','dropped']) assert.equal(reportClass([{code:'fidelity-unverified',fidelity:'degraded'},{code:'unsupported-node',fidelity}]), 'names-loss')
})

test('JavaScript measures all CommonMark examples and accounts for every result', () => {
  const report = runCommonmarkSpec(['javascript']), totals = report.totals.javascript
  assert.equal(report.rows.length, 652)
  assert.ok(report.rows.every(r => ['match','mismatch','not-comparable','failed'].includes(r.status)))
  assert.equal(totals.match + totals.mismatch + totals.notComparable + totals.failed, 652)
  assert.equal(Object.values(totals.mismatchByReport).reduce((a,b) => a+b, 0), totals.mismatch)
  assert.equal(Object.values(totals.honesty).reduce((a,b) => a+b, 0), totals.match + totals.mismatch)
  assert.ok(report.rows.every(r => ['match','mismatch'].includes(r.status) ? typeof r.honesty === 'string' : r.honesty === null))
  assert.deepEqual(report.reportDisagreements, [])
  assert.equal(report.sections.reduce((sum,s) => sum+s.examples, 0), 652)
  for (const [status,key] of [['match','match'],['mismatch','mismatch'],['not-comparable','notComparable'],['failed','failed']]) {
    assert.equal(totals[key], report.rows.filter(r => r.status === status).length)
    assert.equal(report.sections.reduce((sum,s) => sum+s.results.javascript[key], 0), totals[key])
    for (const s of report.sections) assert.equal(s.results.javascript[key], report.rows.filter(r => r.section === s.section && r.status === status).length)
  }
  assert.ok(totals.match > 500)
  assert.deepEqual(report.notMeasuredEngines, ['php','rust'])
})

test('three-engine reports include the example 40 diagnostic disagreement', t => {
  if (!existsSync('.cache/engines/php') || !existsSync('.cache/engines/rust/bin/carve')) {
    t.skip('Native engines absent; JavaScript-only report shape checked separately')
    return
  }
  const report = runCommonmarkSpec(['javascript','php','rust'])
  for (const [engine, totals] of Object.entries(report.totals)) {
    assert.equal(Object.values(totals.honesty).reduce((a,b) => a+b, 0), totals.match + totals.mismatch)
    for (const [outcome, count] of Object.entries(totals.honesty)) assert.equal(count, report.rows.filter(r => r.engine === engine && r.honesty === outcome).length)
  }
  const row = report.reportDisagreements.find(r => r.example === 40)
  assert.ok(row)
  assert.equal(row.section, 'Entity and numeric character references')
  assert.deepEqual(row.classes, { javascript:'names-loss', php:'unverified-only', rust:'unverified-only' })
  assert.ok(row.codes.javascript.includes('structure-unspellable'))
  assert.deepEqual(row.codes.php, ['fidelity-unverified'])
  assert.deepEqual(row.codes.rust, ['fidelity-unverified'])
})
