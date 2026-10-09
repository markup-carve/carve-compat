import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import childProcess, { spawnSync } from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { HTMLRenderer, parse as parseDjot, renderHTML } from '@djot/djot'
import { validateSpec, compareHtml, reportClass, runCommonmarkSpec, runPandocDjotBaseline, renderedWhitespace, validateDeclarations, unwrapLoneImageParagraph, applyDeclaration } from '../scripts/compat/commonmark-spec.mjs'

const pins = JSON.parse(readFileSync('resources/engines.json'))
const statuses = [['match','match'],['mismatch','mismatch'],['not-comparable','notComparable'],['failed','failed']]
function withPandocMock(t, spawn, run) {
  const mock = t.mock.method(childProcess, 'spawnSync', spawn)
  syncBuiltinESMExports()
  try { return run() } finally { mock.mock.restore(); syncBuiltinESMExports() }
}

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

test('declarations validate their schema, metadata, normalizations and example ownership', () => {
  const valid = JSON.parse(readFileSync('tests/commonmark-spec/declared.json'))
  assert.deepEqual(validateDeclarations(JSON.stringify(valid)), valid.differences)
  assert.deepEqual(validateDeclarations(JSON.stringify({schemaVersion:1,differences:[]})), [])
  const patch = fields => ({...valid,differences:[{...valid.differences[0],...fields}]})
  for (const invalid of [
    null, [], {}, {...valid,schemaVersion:2}, {...valid,differences:null}, {...valid,differences:{}},
    {...valid,differences:[null]}, {...valid,differences:[[]]},
    patch({id:''}), patch({id:' '}), patch({id:1}),
    {...valid,differences:[valid.differences[0],{...valid.differences[0],examples:[1]}]},
    patch({normalization:'unknown'}), patch({normalization:'toString'}), patch({normalization:null}),
    patch({reason:''}), patch({reason:' '}), patch({reason:1}),
    patch({reference:'http://example.com'}), patch({reference:'invalid'}), patch({reference:1}),
    patch({examples:[]}), patch({examples:null}), patch({examples:[520,520]}),
    patch({examples:[0]}), patch({examples:[653]}), patch({examples:[520.5]}), patch({examples:['520']}),
    {...valid,differences:[valid.differences[0],{...valid.differences[0],id:'another'}]},
  ]) assert.throws(() => validateDeclarations(JSON.stringify(invalid)), undefined, JSON.stringify(invalid))
  assert.throws(() => validateDeclarations('{'), SyntaxError)
})

test('lone image normalization unwraps only single image paragraphs after whitespace projection', () => {
  const image = {type:'image',destination:'a.png',children:[{type:'text',value:'alt'}]}
  const paragraph = children => ({type:'paragraph',children})
  const tree = {type:'document',children:[paragraph([image]), {type:'blockquote',children:[paragraph([image])]}]}
  assert.deepEqual(unwrapLoneImageParagraph(tree), {type:'document',children:[image,{type:'blockquote',children:[image]}]})
  assert.equal(tree.children[0].type, 'paragraph')
  for (const children of [[],[image,image],[image,{type:'text',value:'caption'}],[{type:'link',children:[image]}]]) {
    assert.deepEqual(unwrapLoneImageParagraph(paragraph(children)), paragraph(children))
  }
  const d = validateDeclarations()[0]
  assert.equal(applyDeclaration(compareHtml('<p> \n<img src="a.png" alt="alt"> \n</p>', '<img src="a.png" alt="alt">'), d).status, 'declared')
  for (const html of ['<p><img src="a.png"> text</p>','<p><img src="a.png"><img src="b.png"></p>']) {
    assert.equal(applyDeclaration(compareHtml(html, html.replace(/<\/?p>/g, '')), d).status, 'mismatch')
  }
})

test('declarations require normalized equality and preserve non-mismatching statuses', () => {
  const d = validateDeclarations()[0], expected = '<p><img src="a.png" alt="alt"></p>'
  const declared = applyDeclaration(compareHtml(expected, '<img src="a.png" alt="alt">'), d)
  assert.equal(declared.status, 'declared')
  assert.deepEqual(declared.declaration, {id:d.id})
  const insufficient = applyDeclaration(compareHtml(expected, '<img src="wrong.png" alt="alt">'), d)
  assert.equal(insufficient.status, 'mismatch')
  assert.deepEqual(insufficient.declaration, {id:d.id,insufficient:true})
  const stale = compareHtml(expected, expected)
  assert.equal(applyDeclaration(stale, d), stale)
  const unsupported = compareHtml('<div>raw</div>', '<p>raw</p>')
  assert.equal(applyDeclaration(unsupported, d), unsupported)
  const undeclared = compareHtml(expected, '<img src="a.png" alt="alt">')
  assert.equal(applyDeclaration(undeclared), undeclared)
})

test('reports count declared rows as kept structure and identify stale and insufficient examples', t => {
  const d = validateDeclarations()[0], read = fs.readFileSync
  const mock = t.mock.method(fs, 'readFileSync', (path, ...args) => String(path).endsWith('/tests/commonmark-spec/declared.json') ? Buffer.from(JSON.stringify({schemaVersion:1,differences:[{...d,examples:[1,34,520]}]})) : read(path, ...args))
  syncBuiltinESMExports()
  try {
    const report = runCommonmarkSpec(['javascript'])
    assert.deepEqual(report.declarations[0].declared, {javascript:1})
    assert.deepEqual(report.declarations[0].stale, {javascript:[1]})
    assert.deepEqual(report.declarations[0].insufficient, {javascript:[34]})
    const declared = report.rows.find(r => r.example === 520)
    assert.equal(declared.status, 'declared')
    assert.ok(['ok','false-loss'].includes(declared.honesty))
    assert.equal(report.rows.find(r => r.example === 572).status, 'mismatch')
    assert.equal(report.rows.find(r => r.example === 34).status, 'mismatch')
    assert.deepEqual(report.rows.find(r => r.example === 34).declaration, {id:d.id,insufficient:true})
    assert.equal(report.rows.find(r => r.example === 1).status, 'match')
  } finally { mock.mock.restore(); syncBuiltinESMExports() }
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
  assert.deepEqual([totals.match,totals.mismatch,totals.declared,totals.notComparable,totals.failed], [566,25,18,43,0])
  assert.equal(report.declaredSha256, createHash('sha256').update(readFileSync('tests/commonmark-spec/declared.json')).digest('hex'))
  assert.deepEqual(report.declarations[0].declared, {javascript:18})
  assert.deepEqual(report.declarations[0].stale, {javascript:[]})
  assert.deepEqual(report.declarations[0].insufficient, {javascript:[]})
  assert.deepEqual(report.baselines, {})
  assert.ok(report.sections.every(s => Object.keys(s.baselines).length === 0))
  assert.equal(report.rows.length, 652)
  assert.ok(report.rows.every(r => ['match','mismatch','declared','not-comparable','failed'].includes(r.status)))
  assert.equal(totals.match + totals.mismatch + totals.declared + totals.notComparable + totals.failed, 652)
  assert.equal(Object.values(totals.mismatchByReport).reduce((a,b) => a+b, 0), totals.mismatch)
  assert.equal(Object.values(totals.honesty).reduce((a,b) => a+b, 0), totals.match + totals.mismatch + totals.declared)
  assert.ok(report.rows.every(r => ['match','mismatch','declared'].includes(r.status) ? typeof r.honesty === 'string' : r.honesty === null))
  assert.deepEqual(report.reportDisagreements, [])
  assert.equal(report.sections.reduce((sum,s) => sum+s.examples, 0), 652)
  for (const [status,key] of [['declared','declared'],['match','match'],['mismatch','mismatch'],['not-comparable','notComparable'],['failed','failed']]) {
    assert.equal(totals[key], report.rows.filter(r => r.status === status).length)
    assert.equal(report.sections.reduce((sum,s) => sum+s.results.javascript[key], 0), totals[key])
    for (const s of report.sections) assert.equal(s.results.javascript[key], report.rows.filter(r => r.section === s.section && r.status === status).length)
  }
  assert.ok(totals.match > 500)
  assert.deepEqual(report.notMeasuredEngines, ['php','rust'])
})

test('selected baseline reports account for every example without fidelity fields', t => {
  const examples = validateSpec(), binary = process.env.CARVE_PANDOC ?? '.cache/pandoc/bin/pandoc'
  let index = 0, versionChecks = 0
  const report = withPandocMock(t, (command, args, options) => {
    assert.equal(command, binary)
    if (args[0] === '--version') {
      versionChecks++
      assert.equal(index, 0)
      return {status:0,stdout:`pandoc ${pins.pandoc.version}\nFeatures: test\n`,stderr:''}
    }
    assert.equal(versionChecks, 1)
    assert.deepEqual(args, ['-f','commonmark','-t','djot','--wrap=preserve'])
    assert.equal(options.input, examples[index].markdown)
    if (index++ === 0) return {status:1,stdout:'partial output',stderr:'Conversion failed'}
    return {status:0,stdout:'hello\n',stderr:''}
  }, () => runCommonmarkSpec(['javascript'], {baselines:['pandoc-djot']}))
  const baseline = report.baselines['pandoc-djot']
  assert.deepEqual(Object.keys(report.baselines), ['pandoc-djot'])
  assert.deepEqual(baseline.converter, {name:'pandoc',version:pins.pandoc.version,command:'-f commonmark -t djot --wrap=preserve'})
  assert.deepEqual(baseline.renderer, {name:'@djot/djot',version:JSON.parse(readFileSync('node_modules/@djot/djot/package.json')).version})
  assert.equal(baseline.rows.length, 652)
  assert.ok(!Object.hasOwn(baseline.totals, 'declared'))
  assert.ok(baseline.rows.every(row => row.status !== 'declared'))
  assert.equal(index, 652)
  assert.deepEqual(baseline.rows[0], {example:1,section:'Tabs',status:'failed',output:'partial output',html:'',error:'Conversion failed'})
  for (const [i,row] of baseline.rows.entries()) {
    assert.equal(row.example, examples[i].example)
    assert.equal(row.section, examples[i].section)
    assert.ok(!Object.hasOwn(row, 'honesty') && !Object.hasOwn(row, 'reportClass') && !Object.hasOwn(row, 'declaration'))
    if (i > 0) {
      assert.equal(row.output, 'hello\n')
      assert.equal(row.html, '<p>hello</p>\n')
      assert.equal(row.status, compareHtml(examples[i].html, row.html).status)
    }
  }
  for (const [status,key] of statuses) {
    assert.equal(baseline.totals[key], baseline.rows.filter(r => r.status === status).length)
    assert.equal(report.sections.reduce((sum,s) => sum+s.baselines['pandoc-djot'][key], 0), baseline.totals[key])
    for (const s of report.sections) assert.equal(s.baselines['pandoc-djot'][key], baseline.rows.filter(r => r.section === s.section && r.status === status).length)
  }
})

test('baseline preflight rejects missing, failing and incorrectly pinned pandoc', t => {
  for (const response of [
    {error:new Error('spawn ENOENT'),status:null,stdout:'',stderr:''},
    {status:1,stdout:'',stderr:'version failed'},
    {status:0,stdout:'pandoc 0.0\n',stderr:''},
    {status:0,stdout:`pandoc ${pins.pandoc.version} extra\n`,stderr:''},
  ]) withPandocMock(t, () => response, () => assert.throws(() => runPandocDjotBaseline([]), /infrastructure error/))
  assert.throws(() => runCommonmarkSpec(['javascript'], {baselines:['unknown']}), /Unknown baseline/)
  assert.throws(() => runCommonmarkSpec(['javascript'], {baselines:['pandoc-djot','pandoc-djot']}), /Duplicate selected baseline/)
})

test('baseline spawn and rendering errors become failed rows', t => {
  const examples = validateSpec().slice(0, 1)
  const spawn = response => (_, args) => args[0] === '--version' ? {status:0,stdout:`pandoc ${pins.pandoc.version}\n`} : response
  withPandocMock(t, spawn({status:null,stdout:'',stderr:'',error:new Error('spawn failed')}), () => {
    const result = runPandocDjotBaseline(examples)
    assert.equal(result.rows[0].error, 'spawn failed')
    assert.equal(result.totals.failed, 1)
  })
  const renderer = t.mock.method(HTMLRenderer.prototype, 'render', () => { throw new Error('render failed') })
  try {
    withPandocMock(t, spawn({status:0,stdout:'hello\n'}), () => {
      const result = runPandocDjotBaseline(examples)
      assert.equal(result.rows[0].output, 'hello\n')
      assert.match(result.rows[0].error, /render failed/)
      assert.equal(result.totals.failed, 1)
    })
  } finally { renderer.mock.restore() }
})

test('pinned pandoc converts spec examples for independent djot.js rendering', t => {
  const binary = process.env.CARVE_PANDOC ?? '.cache/pandoc/bin/pandoc'
  const probe = spawnSync(binary, ['--version'], {encoding:'utf8',timeout:15000})
  if (probe.error?.code === 'ENOENT') { t.skip(`Pinned pandoc binary absent at ${binary}; baseline integration requires pandoc ${pins.pandoc.version}`); return }
  const spec = validateSpec(), examples = [spec[0],...['Soft line breaks','Raw HTML','ATX headings'].map(section => spec.find(e => e.section === section)),spec.find(e => e.example === 520)]
  const baseline = runPandocDjotBaseline(examples)
  assert.equal(baseline.totals.failed, 0)
  assert.equal(baseline.rows.length, examples.length)
  for (const [i,row] of baseline.rows.entries()) {
    assert.equal(row.html, renderHTML(parseDjot(row.output)))
    assert.equal(row.status, compareHtml(examples[i].html, row.html).status)
  }
  assert.equal(baseline.rows[1].output, examples[1].markdown)
  assert.ok(baseline.rows[2].output.includes('=html'))
  assert.equal(baseline.rows[2].html, examples[2].html)
  assert.equal(baseline.rows[3].status, 'match')
  assert.equal(baseline.rows[4].status, 'match')
  assert.match(baseline.rows[4].html, /<p><img /)
})

test('CLI baseline defaults require pandoc and --baselines=none needs no binary', () => {
  const env = {...process.env,CARVE_PANDOC:'/nonexistent/carve-compat-test-pandoc'}
  const run = (...args) => spawnSync(process.execPath, ['scripts/commonmark-spec.mjs','--engines=javascript',...args], {encoding:'utf8',env})
  const selected = run()
  assert.equal(selected.status, 1)
  assert.match(selected.stderr, /Pandoc baseline infrastructure error/)
  const disabled = run('--baselines=none')
  assert.equal(disabled.status, 0, disabled.stderr)
  assert.match(disabled.stdout, /javascript: \d+ match/)
  assert.match(disabled.stdout, /18 declared/)
  assert.doesNotMatch(disabled.stdout, /Warning:/)
  assert.doesNotMatch(disabled.stdout, /pandoc-djot/)
  assert.equal(run('--baselines=unknown').status, 1)
})

test('CLI warns on stdout about stale and insufficient declarations and still exits successfully', () => {
  const dir = mkdtempSync(join(tmpdir(), 'carve-compat-declaration-cli-'))
  try {
    const d = {...validateDeclarations()[0],examples:[1,34,520]}, preload = join(dir,'declarations.mjs')
    writeFileSync(preload, `import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
const read = fs.readFileSync
fs.readFileSync = (path, ...args) => String(path).endsWith('/tests/commonmark-spec/declared.json') ? Buffer.from(${JSON.stringify(JSON.stringify({schemaVersion:1,differences:[d]}))}) : read(path, ...args)
syncBuiltinESMExports()
`)
    const result = spawnSync(process.execPath, ['--import',preload,'scripts/commonmark-spec.mjs','--engines=javascript','--baselines=none'], {encoding:'utf8'})
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Warning: lone-image-block stale for javascript: examples 1/)
    assert.match(result.stdout, /Warning: lone-image-block insufficient for javascript: examples 34/)
    assert.equal(result.stderr, '')
  } finally { rmSync(dir, {recursive:true,force:true}) }
})

test('three-engine reports include the example 40 diagnostic disagreement', t => {
  if (!existsSync('.cache/engines/php') || !existsSync('.cache/engines/rust/bin/carve')) {
    t.skip('Native engines absent; JavaScript-only report shape checked separately')
    return
  }
  const report = runCommonmarkSpec(['javascript','php','rust'])
  for (const [engine, totals] of Object.entries(report.totals)) {
    assert.equal(Object.values(totals.honesty).reduce((a,b) => a+b, 0), totals.match + totals.mismatch + totals.declared)
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
