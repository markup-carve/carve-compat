import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, cpSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseTests, validateDjotTests, djotTestsPath, loadDjotDeclarations, runDjotTests, testfiles } from '../scripts/compat/djot-tests.mjs'
import { compareHtml, applyDeclaration, dropMathRole } from '../scripts/compat/commonmark-spec.mjs'
import { validateHtmlSuite } from '../scripts/compat/validate-html-suite.mjs'

const counts = {
  'attributes.test':[37,35], 'block_quote.test':[15,15], 'code_blocks.test':[7,7],
  'definition_lists.test':[4,4], 'symb.test':[2,0], 'emphasis.test':[35,35],
  'escapes.test':[6,6], 'fenced_divs.test':[8,8], 'footnotes.test':[4,4],
  'headings.test':[17,17], 'insert_delete_mark.test':[4,4], 'links_and_images.test':[32,32],
  'lists.test':[31,31], 'math.test':[8,8], 'para.test':[1,1], 'raw.test':[4,4],
  'regression.test':[6,5], 'smart.test':[18,18], 'spans.test':[6,6], 'sourcepos.test':[1,0],
  'super_subscript.test':[4,4], 'tables.test':[9,9], 'task_lists.test':[3,3],
  'thematic_breaks.test':[4,4], 'verbatim.test':[8,8],
}

test('Djot parser preserves upstream fences, line numbers, options and separators', () => {
  const fixture = ['Introduction','```` ap','```','literal','. ','.','AST','```','````','Between','```','source','!','filter body','.','<p>filtered</p>','```','After'].join('\n')
  assert.deepEqual(parseTests(fixture,'fixture.test'), [
    {file:'fixture.test',linenum:2,pretext:'Introduction',options:'ap',filters:[],filtered:false,input:'```\nliteral\n. \n',output:'AST\n```\n'},
    {file:'fixture.test',linenum:11,pretext:'Between',options:'',filters:[],filtered:true,input:'source\n',output:'filter body\n.\n<p>filtered</p>\n'},
  ])
  assert.equal(parseTests(['```','source','.','<p>source</p>','``` trailing'].join('\n'))[0].output, '<p>source</p>\n')
})

test('vendored Djot suite uses the upstream file list and pinned counts', () => {
  const {tests,examples,excluded} = validateDjotTests()
  assert.deepEqual(testfiles, Object.keys(counts))
  assert.equal(tests.length, 274)
  assert.equal(examples.length, 268)
  assert.deepEqual(excluded, {options:6,filters:0})
  for (const [file,[total,measured]] of Object.entries(counts)) {
    assert.equal(tests.filter(t => t.file === file).length, total, file)
    assert.equal(examples.filter(e => e.section + '.test' === file).length, measured, file)
  }
  assert.equal(new Set(examples.map(e => e.example)).size, 268)
  const first = examples[0], parsed = tests[0]
  assert.equal(first.example, `attributes.test:${parsed.linenum}`)
  assert.equal(first.source, parsed.input)
  assert.equal(first.html, parsed.output)
  assert.match(first.link, new RegExp(`/test/attributes.test#L${parsed.linenum}$`))
  const filters = parseTests(readFileSync(join(djotTestsPath,'filters.test'),'utf8'))
  assert.equal(filters.length, 3)
  assert.ok(filters.every(t => t.filtered))
})

test('Djot checksum rejects changed input, license and file lists', () => {
  const dir = mkdtempSync(join(tmpdir(),'carve-djot-checksum-'))
  try {
    cpSync(djotTestsPath,dir,{recursive:true})
    assert.equal(validateDjotTests(dir).examples.length, 268)
    for (const file of ['para.test','LICENSE','filters.test']) {
      const path = join(dir,file), source = readFileSync(path)
      writeFileSync(path, Buffer.concat([source,Buffer.from('\nchanged')]))
      assert.throws(() => validateDjotTests(dir), /checksum/)
      writeFileSync(path,source)
    }
    writeFileSync(join(dir,'extra.test'),'')
    assert.throws(() => validateDjotTests(dir), /file list/)
    rmSync(join(dir,'extra.test'))
    rmSync(join(dir,'para.test'))
    assert.throws(() => validateDjotTests(dir), /file list/)
  } finally { rmSync(dir,{recursive:true,force:true}) }
})

test('expected generated mode ignores Djot section wrappers and heading IDs on both sides', () => {
  const expected = '<section id="generated"><h1>Title</h1><p>Text</p></section>'
  const actual = '<section id="different"><h1 id="different">Title</h1><p>Text</p></section>'
  assert.equal(compareHtml(expected,actual).status,'not-comparable')
  assert.equal(compareHtml(expected,actual,{expectedGenerated:true}).status,'match')
  assert.equal(compareHtml('<h1 id="authored">Title</h1>','<h1 id="other">Title</h1>',{expectedGenerated:true}).status,'match')
  assert.equal(compareHtml('<h1 id="authored">Title</h1>','<h1 id="other">Title</h1>').status,'mismatch')
  assert.equal(compareHtml('<pre><code> a\n</code></pre>','<pre><code>a\n</code></pre>',{expectedGenerated:true}).status,'mismatch')
})

test('Djot declarations can be absent or refer to string example IDs', () => {
  const dir = mkdtempSync(join(tmpdir(),'carve-djot-declarations-'))
  try {
    const {examples} = validateDjotTests()
    assert.deepEqual(loadDjotDeclarations(examples,dir), {differences:[],declaredSha256:null})
    const difference = {id:'image',normalization:'unwrap-lone-image-paragraph',reason:'Image paragraphs.',reference:'https://example.com/images',examples:[examples[0].example]}
    writeFileSync(join(dir,'declared.json'),JSON.stringify({schemaVersion:1,differences:[difference]}))
    const result = loadDjotDeclarations(examples,dir)
    assert.deepEqual(result.differences,[difference]); assert.match(result.declaredSha256,/^[a-f0-9]{64}$/)
    writeFileSync(join(dir,'declared.json'),JSON.stringify({schemaVersion:1,differences:[{...difference,examples:[1]}]}))
    assert.throws(() => loadDjotDeclarations(examples,dir), /Invalid declaration example/)
  } finally { rmSync(dir,{recursive:true,force:true}) }
})

test('JavaScript Djot lane measures every HTML example and accounts for every outcome', () => {
  const report = runDjotTests(['javascript']), {examples} = validateDjotTests()
  assert.equal(report.kind,'djot-tests')
  assert.equal(report.suite.examples,268)
  assert.deepEqual(report.suite.excluded,{options:6,filters:0})
  assert.equal(report.rows.length,268)
  assert.deepEqual(report.rows.map(r => r.example),examples.map(e => e.example))
  assert.deepEqual(report.declarations.map(d => d.id),['math-role','lone-image-block'])
  assert.match(report.declaredSha256,/^[a-f0-9]{64}$/)
  for (const d of report.declarations) { assert.deepEqual(d.stale.javascript,[]); assert.deepEqual(d.insufficient.javascript,[]) }
  assert.equal(report.totals.javascript.declared,11)
  assert.ok(!Object.hasOwn(report,'baselines'))
  assert.deepEqual(report.notMeasuredEngines,['php','rust'])
  validateHtmlSuite(report,{label:'Djot',examples,differences:loadDjotDeclarations(examples).differences,sourceKey:'source'})
  const emphasis = report.rows.find(r => r.example === 'emphasis.test:1')
  assert.equal(emphasis.source, '*foo bar*\n')
  assert.equal(emphasis.status, 'match')
  assert.match(emphasis.carveHtml, /<strong>foo bar<\/strong>/)
  assert.equal(Object.values(report.totals.javascript.honesty).reduce((sum,n)=>sum+n,0),report.totals.javascript.match + report.totals.javascript.mismatch + report.totals.javascript.declared)
  for (const selection of [[],['javascript','javascript'],['unknown']]) assert.throws(() => runDjotTests(selection))
})

test('the Djot comparison keeps authored divs', () => {
  const generated = { expectedGenerated:true }
  assert.equal(compareHtml('<div id="bar" class="foo"><p>Hi</p></div>', '<p>Hi</p>', generated).status, 'mismatch')
  assert.equal(compareHtml('<div class="foo"><p>Hi</p></div>', '<div class="foo"><p>Hi</p><div></div></div>', generated).status, 'mismatch')
  assert.equal(compareHtml('<div class="foo"><p>Hi</p></div>', '<div class="foo">\n  <p>Hi</p>\n</div>', generated).status, 'match')
  assert.equal(compareHtml('<section id="a"><h1>A</h1></section>', '<h1 id="A">A</h1>', generated).status, 'match')
})

test('the math-role declaration drops only role=math on math spans, on both sides', () => {
  const expected = '<p><span class="math inline">\\(x\\)</span></p>'
  const actual = '<p><span class="math inline" role="math">\\(x\\)</span></p>'
  const difference = { id:'math-role', normalization:'drop-math-role' }
  assert.equal(applyDeclaration(compareHtml(expected,actual,{expectedGenerated:true}),difference).status,'declared')
  assert.equal(applyDeclaration(compareHtml('<p><span class="note">x</span></p>','<p><span class="note" role="math">x</span></p>',{expectedGenerated:true}),difference).status,'mismatch')
  assert.equal(applyDeclaration(compareHtml(expected,'<p><span class="math inline" role="math">\\(y\\)</span></p>',{expectedGenerated:true}),difference).status,'mismatch')
  assert.deepEqual(dropMathRole({type:'span',attrs:{classes:['math','inline'],keyValues:{role:'math',k:'v'}}}),{type:'span',attrs:{classes:['math','inline'],keyValues:{k:'v'}}})
})
