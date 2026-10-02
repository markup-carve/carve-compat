import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse as parseDjot, renderDjot } from '@djot/djot'
import { corpus, lossCorpus, checkCase, isTableMetadataSpelling, checkIndependent, checkLossCase, validateCorpus, validateLossCorpus, validateAst, runCompatibility } from '../scripts/compat/check.mjs'
import { toolNames, nativeTools, readForeign, toMdast, toHast, toDjot } from '../scripts/compat/tools.mjs'
import { context, semantics, htmlSemantics, fromDjot, fromMd4c, fromHast, parseHtml } from '../scripts/compat/trees.mjs'

import {toPandoc,fromPandoc} from '../scripts/compat/pandoc.mjs'

const javascriptTools = toolNames.filter(t => !nativeTools.includes(t))

test('every declared compatibility fixture has a source and every tool has coverage', () => {
  validateCorpus()
  validateLossCorpus()
  for (const tool of toolNames) {
    assert.ok(lossCorpus.cases.some(c => c.tools.includes(tool)), `${tool}: no loss case`)
  }
  assert.equal(new Set(lossCorpus.cases.map(c => c.id)).size, lossCorpus.cases.length)
  for (const fixture of lossCorpus.cases) {
    assert.ok(['import', 'export'].includes(fixture.direction))
    assert.ok(fixture.tools.length)
    for (const tool of fixture.tools) assert.ok(toolNames.includes(tool))
    if(!fixture.ast)assert.equal(typeof fixture[fixture.direction === 'import' ? 'source' : 'carve'], 'string')
  }
  assert.throws(() => validateCorpus({ schemaVersion: 1, cases: [] }), /empty/)
  const broken = structuredClone(corpus)
  delete broken.cases[0].markdown
  assert.throws(() => validateCorpus(broken), /missing mdast source/)
  const invalidEngine = structuredClone(corpus)
  const astFixture = invalidEngine.cases.find(c => c.ast)
  astFixture.sourceChangesByEngine = { typo: [] }
  assert.throws(() => validateCorpus(invalidEngine), /invalid source change engine/)
  astFixture.sourceChangesByEngine = { php: {} }
  assert.throws(() => validateCorpus(invalidEngine), /invalid php source change expectation/)
  const brokenLoss = structuredClone(lossCorpus)
  brokenLoss.cases[0].tools.push('typo')
  assert.throws(() => validateLossCorpus(brokenLoss), /unknown loss tool typo/)
})

test('the Djot hard-break writer workaround still corresponds to an upstream failure', () => {
  assert.throws(() => renderDjot(parseDjot('one\\\ntwo\n')), /No renderer defined for node type hard_break/, 'Remove the workaround when the pinned writer supports hard_break')
})

for (const tool of javascriptTools) {
  for (const fixture of corpus.cases.filter(c => (c.tools ?? toolNames).includes(tool))) {
    test(`${tool}/${fixture.id}: declared schema, mapping, rendering and conversion checks`, async () => {
      const result = await checkCase(tool, fixture)
      assert.equal(result.status, 'passed')
      assert.equal(result.checks.length, 7)
      assert.ok(result.version)
    })
  }
  for (const fixture of lossCorpus.cases.filter(c => c.tools.includes(tool))) {
    test(`${tool}/${fixture.id}: reports the loss and keeps readable content`, async () => {
      const result = await checkLossCase(tool, fixture)
      assert.equal(result.status, 'passed')
      assert.equal(result.checks.length, 3)
    })
  }
}

test('equal visible text cannot hide changed inline structure or destinations', async () => {
  const fixture = corpus.cases.find(c => c.id === 'inline-structure')
  await assert.rejects(checkCase('mdast', { ...fixture, markdown: fixture.markdown.replace('**bold**', '*bold*') }), /foreign AST mapping/)
  await assert.rejects(checkCase('mdast', { ...fixture, markdown: fixture.markdown.replace('https://example.org', 'https://other.example') }), /foreign AST mapping/)
})

test('the semantic projection preserves attributes, list tightness, destinations and code whitespace', () => {
  for (const [first, second] of [
    [{ type: 'paragraph', attrs: { id: 'a' } }, { type: 'paragraph', attrs: { id: 'b' } }],
    [{ type: 'list', tight: true }, { type: 'list', tight: false }],
    [{ type: 'link', href: '/a' }, { type: 'link', href: '/b' }],
    [{ type: 'code_block', content: 'x\n' }, { type: 'code_block', content: 'x \n' }],
  ]) assert.notDeepEqual(semantics(first), semantics(second))
})

test('authored attributes survive even when their values collide with generated HTML classes and IDs', () => {
  const options = { generated: true, authoredIds: new Set(['authored']), authoredClasses: new Set(['simple']) }
  const kept = fromHast(parseHtml('<h2 id="authored" class="simple">Heading</h2>'), undefined, options)
  const missing = fromHast(parseHtml('<h2>Heading</h2>'), undefined, options)
  assert.notDeepEqual(semantics(kept), semantics(missing))
  assert.deepEqual(kept.children[0].attrs, { id: 'authored', classes: ['simple'] })
})

test('mapped AST validation rejects foreign properties and invalid block placement', async () => {
  const result = await readForeign('mdast', 'A paragraph.\n')
  validateAst(result.ast)
  assert.throws(() => validateAst({ ...result.ast, foreignField: true }), /additionalProperties/)
  assert.throws(() => validateAst({ ...result.ast, children: [{ type: 'text', value: 'misplaced' }] }))
})

test('the MD4C adapter refuses incomplete or mismatched event streams', () => {
  assert.throws(() => fromMd4c([]), /Incomplete/)
  assert.throws(() => fromMd4c([{ event: 'enter_block', kind: 0 }]), /Incomplete/)
  assert.throws(() => fromMd4c([{ event: 'enter_block', kind: 0 }, { event: 'leave_span', kind: 0 }]), /Unbalanced/)
})

test('tool selection names every unmeasured target and rejects invalid selections', async () => {
  const result = await runCompatibility(['commonmark'])
  assert.equal(result.failed, 0)
  assert.deepEqual(result.notMeasured, toolNames.filter(t => t !== 'commonmark'))
  assert.ok(result.rows.every(r => r.tool === 'commonmark'))
  await assert.rejects(runCompatibility([]), /No compatibility tools/)
  await assert.rejects(runCompatibility(['unknown']), /Unknown tool/)
  await assert.rejects(runCompatibility(['hast', 'hast']), /Duplicate/)
})

test('a missing native parser fails the CLI and remains a named failure in its report', () => {
  const dir = mkdtempSync(join(tmpdir(), 'carve-external-failure-'))
  try {
    const report = join(dir, 'report.json')
    const result = spawnSync(process.execPath, ['scripts/external-compat.mjs', '--tools=cmark', '--engines=javascript', `--report=${report}`], {
      cwd: new URL('..', import.meta.url), encoding: 'utf8', env: { ...process.env, CARVE_CMARK: join(dir, 'absent-cmark') },
    })
    assert.equal(result.status, 1, result.stderr)
    const data = JSON.parse(readFileSync(report))
    assert.ok(data.failed > 0)
    assert.equal(data.passed, 0)
    assert.ok(data.rows.every(r => r.status === 'failed' && r.tool === 'cmark'))
    assert.match(result.stderr, /ENOENT/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('failed assertions keep partial AST evidence and loss diagnostics', async () => {
  const fixture = corpus.cases.find(c => c.id === 'inline-structure')
  await assert.rejects(checkCase('mdast', { ...fixture, markdown: 'Different text.\n' }), error => {
    assert.ok(error.actual && error.expected)
    assert.ok(error.compatibilityEvidence.evidence.ast)
    assert.ok(error.compatibilityEvidence.version)
    assert.ok(error.compatibilityEvidence.diagnostics.length)
    return true
  })
  const loss = lossCorpus.cases.find(c => c.tools.includes('mdast'))
  await assert.rejects(checkLossCase('mdast', { ...loss, expected: { ...loss.expected, path: '/deliberately-wrong-path' } }), error => {
    assert.equal(error.compatibilityEvidence.evidence.expected.path, '/deliberately-wrong-path')
    assert.ok(error.compatibilityEvidence.diagnostics.length)
    assert.ok(error.compatibilityEvidence.version)
    return true
  })
})


test('the separate DocBook check catches an inline mismatch with unchanged visible text', async () => {
  const result = await readForeign('asciidoctor','A *bold* word.\n')
  checkIndependent(result)
  const changed=structuredClone(result)
  changed.independentAst.children[0].children.find(n=>n.type==='strong').type='emphasis'
  assert.throws(()=>checkIndependent(changed),/Independent DocBook structure differs/)
})

test('a missing Carve engine produces failed comparisons instead of silent skips', async () => {
  const result=await runCompatibility(['commonmark'],['javascript'])
  assert.deepEqual(result.selectedEngines,['javascript'])
  assert.deepEqual(result.notMeasuredEngines,['php','rust'])
  await assert.rejects(runCompatibility(['commonmark'],['php']),/JavaScript reference/)
  await assert.rejects(runCompatibility(['commonmark'],['javascript','unknown']),/Unknown engine/)
  const dir=mkdtempSync(join(tmpdir(),'carve-engine-missing-'))
  try {
    const report=join(dir,'report.json')
    const child=spawnSync(process.execPath,['scripts/external-compat.mjs','--tools=commonmark','--engines=javascript,php',`--report=${report}`],{encoding:'utf8',env:{...process.env,CARVE_PHP_ROOT:join(dir,'missing')}})
    assert.equal(child.status,1)
    const data=JSON.parse(readFileSync(report))
    assert.ok(data.engines.php.error)
    assert.ok(data.rows.filter(r=>r.engine==='php').every(r=>r.status==='failed'))
    assert.ok(data.rows.filter(r=>r.engine==='javascript').every(r=>r.status==='passed'))
  } finally {rmSync(dir,{recursive:true,force:true})}
})


test('rich exporters report unsupported fields on internal table and definition nodes',()=>{
  const ast={type:'document',srcByteLength:0,children:[{type:'table',rows:[{type:'table_row',attrs:{id:'row'},cells:[{type:'table_cell',header:true,align:'right',colspan:2,attrs:{classes:['cell']},children:[{type:'text',value:'x'}]}]}]}]}
  validateAst(ast)
  for(const [tool,writer]of [['mdast',toMdast],['djot',toDjot]]){
    const ctx=context(tool);writer(ast,ctx)
    if(tool==='mdast')assert.ok(ctx.diagnostics.some(d=>d.path==='/children/0/rows/0/cells/0/align' && d.fidelity==='dropped'),tool)
    assert.ok(ctx.diagnostics.some(d=>d.path==='/children/0/rows/0/cells/0/colspan' && d.fidelity==='dropped'),tool)
  }
  const root={type:'document',srcByteLength:0,children:[{type:'definition_list',items:[{type:'definition_term',attrs:{id:'term'},children:[{type:'text',value:'Term'}]},{type:'definition_description',children:[{type:'paragraph',children:[{type:'text',value:'Definition'}]}]}]}]}
  validateAst(root)
  for(const tool of ['pandoc','djot']){const ctx=context(tool);if(tool==='pandoc')toPandoc(root,[1,23],ctx);else toDjot(root,ctx);assert.ok(ctx.diagnostics.some(d=>d.path==='/children/0/items/0/attrs' && d.fidelity==='dropped'),tool)}
})

test('authored HTML endnote attributes are never treated as generated navigation',()=>{
  const ctx=context('hast')
  fromHast(parseHtml('<p><sup class="keep"><a id="r1" role="doc-noteref" href="#n1">1</a></sup></p><section role="doc-endnotes" id="notes"><ol><li id="n1">Note</li></ol></section>'),ctx)
  assert.ok(ctx.diagnostics.some(d=>d.fidelity==='degraded'))
  assert.equal(ctx.diagnostics.some(d=>d.code==='generated-footnote-navigation'),false)
})


test('export diagnostics retain document indices when footnotes precede body blocks',()=>{
  const root={type:'document',srcByteLength:0,children:[{type:'footnote',label:'1',children:[{type:'paragraph',children:[{type:'underline',children:[{type:'text',value:'note'}]}]}]},{type:'paragraph',children:[{type:'underline',children:[{type:'text',value:'body'}]}]}]}
  validateAst(root)
  const ctx=context('djot');toDjot(root,ctx)
  assert.ok(ctx.diagnostics.some(d=>d.path==='/children/0/children/0/children/0' && d.code==='unsupported-node'))
  assert.ok(ctx.diagnostics.some(d=>d.path==='/children/1/children/0' && d.code==='unsupported-node'))
})


test('Pandoc reports attributes on referenced note definitions at their original AST path',()=>{
  const root={type:'document',srcByteLength:0,children:[{type:'footnote',label:'1',attrs:{id:'note'},children:[{type:'paragraph',children:[{type:'text',value:'Body'}]}]},{type:'paragraph',children:[{type:'footnote_ref',label:'1'}]}]}
  validateAst(root)
  const ctx=context('pandoc');toPandoc(root,[1,23],ctx)
  assert.ok(ctx.diagnostics.some(d=>d.path==='/children/0/attrs' && d.fidelity==='dropped'))
})


test('Pandoc retains orphan note cycles and diagnoses reachable recursive references',()=>{
  const note={type:'footnote',label:'a',children:[{type:'paragraph',children:[{type:'text',value:'See '},{type:'footnote_ref',label:'a'}]}]}
  for(const reachable of [false,true]){
    const root={type:'document',srcByteLength:0,children:[note,...(reachable?[{type:'paragraph',children:[{type:'footnote_ref',label:'a'}]}]:[])]}
    validateAst(root)
    const ctx=context('pandoc'),out=toPandoc(root,[1,23],ctx)
    assert.ok(out.blocks.length)
    assert.ok(JSON.stringify(out).includes('See '))
    assert.ok(ctx.diagnostics.some(d=>d.code==='unsupported-node' && d.fidelity==='degraded'))
  }
})

test('equal Pandoc note bodies remain distinct while reporting ambiguous identity', () => {
  const body = [{ t: 'Para', c: [{ t: 'Str', c: 'Same' }] }]
  const ctx = context('pandoc')
  const ast = fromPandoc({ 'pandoc-api-version': [1, 23], blocks: [{ t: 'Para', c: [{ t: 'Note', c: body }, { t: 'Space' }, { t: 'Note', c: structuredClone(body) }] }] }, ctx)
  validateAst(ast)
  assert.deepEqual(ast.children.filter(n => n.type === 'footnote').map(n => n.label), ['1', '2'])
  assert.deepEqual(ast.children[0].children.filter(n => n.type === 'footnote_ref').map(n => n.label), ['1', '2'])
  assert.ok(ctx.diagnostics.some(d => d.path === '/blocks/0/c/2' && d.fidelity === 'degraded'))
})

test('a nested checkbox does not turn its parent into a task item', () => {
  const ctx = context('hast')
  const ast = fromHast(parseHtml('<ul><li>Parent <em>text</em> <strong>bold</strong><ul><li><input type="checkbox" checked> Child</li></ul></li></ul>'), ctx)
  validateAst(ast)
  const parent = ast.children[0].items[0]
  assert.equal(parent.checked, undefined)
  assert.equal(parent.children[0].children[1].type, 'emphasis')
  assert.equal(parent.children[0].children[2].value, ' ')
  assert.equal(parent.children[0].children[3].type, 'strong')
  assert.equal(parent.children[1].items[0].checked, true)
  assert.equal(ctx.diagnostics.some(d => ['dropped', 'degraded'].includes(d.fidelity)), false)
})


test('HTML bullet-list type attributes stay authored attributes without olType', () => {
  const ast = fromHast(parseHtml('<ul type="i"><li>x</li></ul>'))
  validateAst(ast)
  assert.equal(ast.children[0].ordered, false)
  assert.equal(ast.children[0].olType, undefined)
  assert.deepEqual(ast.children[0].attrs.keyValues, { type: 'i' })
})

test('rendered table-section attributes remain authored row-group attributes', () => {
  const ctx = context('hast')
  const ast=fromHast(parseHtml('<table><thead id="authored"><tr><th>x</th></tr></thead></table>'), ctx, { generated: true, authoredIds: new Set(['authored']) })
  assert.equal(ast.children[0].rowGroups.headAttrs.id,'authored')
  assert.equal(ctx.diagnostics.some(d => d.fidelity === 'dropped'),false)
})


test('schema-valid unordered lists with a numbering style receive an export loss', () => {
  const root = { type: 'document', srcByteLength: 0, children: [{ type: 'list', ordered: false, olType: 'i', tight: true, items: [{ type: 'list_item', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'x' }] }] }] }] }
  validateAst(root)
  for (const tool of ['djot', 'pandoc']) {
    const ctx = context(tool)
    if (tool === 'djot') toDjot(root, ctx)
    else toPandoc(root, [1, 23], ctx)
    assert.ok(ctx.diagnostics.some(d => d.path === '/children/0/olType' && d.fidelity === 'dropped'), tool)
  }
})

test('rich interchange checks reject changed authored fields and missing source diagnostics', async () => {
  const fixture = corpus.cases.find(c => c.id === 'rich-table-combinations')
  const changed = structuredClone(fixture)
  changed.ast.children[0].rows[1].cells[0].attrs.id = 'other'
  await assert.rejects(checkCase('hast', changed), /authored interchange expectation/)
  await assert.rejects(checkCase('hast', { ...fixture, sourceDiagnostics: [] }), /source conversion boundary/)
  await assert.rejects(checkCase('hast', { ...fixture, sourceChanges: [] }), /declared source conversion changes/)
})

test('generated row-header scope normalization keeps authored scope assertions', () => {
  const html = parseHtml('<table><tbody><tr><th scope="row">x</th><td>y</td></tr></tbody></table>')
  const generated = fromHast(html, undefined, { generated: true })
  const authored = fromHast(html, undefined, { generated: true, authoredKeyValues: new Set(['scope=row']) })
  assert.equal(generated.children[0].rows[0].cells[0].attrs, undefined)
  assert.equal(authored.children[0].rows[0].cells[0].attrs.keyValues.scope, 'row')
})

test('Pandoc reports vertical alignment that its table model cannot represent', () => {
  const root = { type: 'document', srcByteLength: 0, children: [{ type: 'table', columns: [{ valign: 'top' }], rows: [{ type: 'table_row', cells: [{ type: 'table_cell', header: false, valign: 'bottom', children: [{ type: 'text', value: 'x' }] }] }] }] }
  validateAst(root)
  const ctx = context('pandoc')
  toPandoc(root, [1, 23], ctx)
  for (const path of ['/children/0/columns/0/valign', '/children/0/rows/0/cells/0/valign']) assert.ok(ctx.diagnostics.some(d => d.path === path && d.fidelity === 'dropped'))
})

test('rich table HTML precision normalization stays visible while AST widths stay exact', () => {
  const fixture = corpus.cases.find(c => c.id === 'pandoc-block-table-cell')
  const root = fixture.ast, changed = structuredClone(root)
  changed.children[0].columns[0].width += 0.000001
  assert.notDeepEqual(semantics(root), semantics(changed))
  const ctx=context('pandoc')
  assert.deepEqual(htmlSemantics(root,'pandoc',ctx),htmlSemantics(changed,'pandoc',ctx))
  assert.ok(ctx.diagnostics.some(d=>d.code==='html-width-precision' && d.fidelity==='normalized'))
})

test('HTML rowspan zero and excessive spans normalize to the row-group boundary', () => {
  for (const value of ['0', '3']) {
    const ctx=context('hast')
    const ast=fromHast(parseHtml(`<table><tr><td rowspan="${value}">a</td><td>b</td></tr><tr><td>c</td></tr></table>`),ctx)
    validateAst(ast)
    assert.equal(ast.children[0].rows[0].cells[0].rowspan,2)
    assert.equal(ast.children[0].rows[1].cells[0].span,'rowspan')
    assert.ok(ctx.diagnostics.some(d=>d.code==='html-rowspan-clamped' && d.fidelity==='normalized'))
  }
})

test('row headers are counted after expanding spans when an explicit group is needed', () => {
  const ast=fromHast(parseHtml('<table><tbody id="group"><tr><th rowspan="2">g</th><th>a</th><td>x</td></tr><tr><th>b</th><td>y</td></tr></tbody></table>'))
  validateAst(ast)
  assert.equal(ast.children[0].rowGroups.bodies[0].rowHeadColumns,2)
  const ctx=context('pandoc');toPandoc(ast,[1,23],ctx)
  assert.equal(ctx.diagnostics.some(d=>d.fidelity==='dropped'),false)
  const plain=fromHast(parseHtml('<table><tr><th>A</th><th>B</th></tr><tr><th>r</th><td>x</td></tr></table>'))
  assert.equal(plain.children[0].rowGroups,undefined)
})

test('HTML cell style attributes do not overwrite semantic alignment', () => {
  const root={type:'document',srcByteLength:0,children:[{type:'table',rows:[{type:'table_row',cells:[{type:'table_cell',header:false,align:'right',attrs:{keyValues:{style:'color: red'}},children:[{type:'text',value:'x'}]}]}]}]}
  const ctx=context('hast'),out=toHast(root,ctx)
  const cell=out.children[0].children[0].children[0].children[0]
  assert.match(cell.properties.style,/color: red/)
  assert.match(cell.properties.style,/text-align: right/)
  const reread=fromHast(out)
  assert.equal(reread.children[0].rows[0].cells[0].align,'right')
})

test('Djot diagnoses per-cell alignment that cannot be encoded by its header separator', () => {
  for(const headers of [false,true]){
    const cells=[{type:'table_cell',header:headers,children:[{type:'text',value:'head'}]},{type:'table_cell',header:false,align:'right',children:[{type:'text',value:'body'}]}]
    const root={type:'document',srcByteLength:0,children:[{type:'table',rows:cells.map(cell=>({type:'table_row',cells:[cell]}))}]}
    const ctx=context('djot');toDjot(root,ctx)
    assert.ok(ctx.diagnostics.some(d=>d.path==='/children/0/rows/1/cells/0/align' && d.fidelity==='dropped'))
  }
})

test('Djot caption attributes outside the Carve table-caption slot are diagnosed', () => {
  const ctx=context('djot')
  const foreign=parseDjot('| x |\n\n^ Caption\n')
  foreign.children[0].children[0].attributes={id:'caption'}
  const ast=fromDjot(foreign,ctx)
  validateAst(ast)
  assert.ok(ctx.diagnostics.some(d=>d.path==='/children/0/caption/attributes' && d.fidelity==='dropped'))
  assert.equal(ast.children[0].caption[0].value,'Caption')
})

test('Pandoc section key/value attributes follow generated HTML normalization', () => {
  const ctx=context('pandoc')
  const ast=fromHast(parseHtml('<table><tbody data-foo="bar"><tr><td>x</td></tr></tbody></table>'),ctx,{generated:true,renderer:'pandoc',authoredKeyValues:new Set(['foo=bar'])})
  validateAst(ast)
  assert.deepEqual(ast.children[0].rowGroups.bodies[0].attrs.keyValues,{foo:'bar'})
  assert.ok(ctx.diagnostics.some(d=>d.code==='generated-html-attribute'))
})

test('single-paragraph HTML captions normalize without losing attributes', () => {
  const ctx=context('hast')
  const ast=fromHast(parseHtml('<table><caption><p id="caption">Cap</p></caption><tr><td>x</td></tr></table>'),ctx)
  validateAst(ast)
  assert.equal(ast.children[0].caption[0].type,'span')
  assert.equal(ast.children[0].caption[0].attrs.id,'caption')
  assert.equal(ctx.diagnostics.some(d=>['dropped','degraded'].includes(d.fidelity)),false)
})

test('legacy HTML column layout attributes are preserved rather than reported as dropped', () => {
  const ctx=context('hast')
  const ast=fromHast(parseHtml('<table><colgroup align="center" valign="top"><col></colgroup><tr><td>x</td></tr></table>'),ctx)
  validateAst(ast)
  assert.deepEqual(ast.children[0].columns,[{align:'center',valign:'top'}])
  assert.equal(ctx.diagnostics.some(d=>d.fidelity==='dropped'),false)
})


test('metadata source spellings remain visible without claiming a missing loss diagnostic', async () => {
  const fixtures = corpus.cases.filter(c => ['footer-caption-widths-and-rowspan','footer-caption-widths-without-head','footer-caption-widths-and-colspan'].includes(c.id))
  assert.equal(fixtures.length, 3)
  for (const fixture of fixtures) {
    const result = await checkCase('hast', fixture)
    const changes = result.diagnostics.filter(d => d.code === 'source-conversion-change')
    assert.ok(changes.length)
    assert.ok(changes.every(d => d.fidelity === 'normalized'))
    assert.ok(!result.diagnostics.some(d => d.code === 'missing-source-conversion-diagnostic'))
  }
})

test('metadata normalization excludes arbitrary attributes, replacements, and changed metadata', () => {
  const before = { children: [{ type: 'table', columns: [{ width: 0.4 }] }] }
  const after = { children: [{ type: 'table', columns: [{ width: 0.4 }], attrs: { keyValues: { widths: '40' } } }] }
  const change = { path: '/children/0/attrs', after: after.children[0].attrs }
  assert.equal(isTableMetadataSpelling(before, after, change), true)
  assert.equal(isTableMetadataSpelling(before, after, { ...change, before: {} }), false)
  assert.equal(isTableMetadataSpelling(before, after, { ...change, after: { keyValues: { foo: 'bar' } } }), false)
  assert.equal(isTableMetadataSpelling(before, { children: [{ ...after.children[0], columns: [{ width: 0.5 }] }] }, change), false)
})

test('row-group spellings require a preserved partition', () => {
  const groups = { headRows: 0, bodies: [{ headRows: 0, bodyRows: 1 }], footRows: 1 }
  const before = { children: [{ type: 'table', rowGroups: groups }] }
  const after = { children: [{ type: 'table', rowGroups: groups, attrs: { keyValues: { 'footer-rows': '1' } } }] }
  const change = { path: '/children/0/attrs', after: after.children[0].attrs }
  assert.equal(isTableMetadataSpelling(before, after, change), true)
  assert.equal(isTableMetadataSpelling(before, { children: [{ ...after.children[0], rowGroups: { ...groups, footRows: 0 } }] }, change), false)
})

test('Pandoc HTML truncates fractional percentages instead of rounding them', () => {
  const ast = { children: [{ type: 'table', rows: [], columns: [{ width: 0.013 }, { width: 0.987 }] }] }
  const expected = { children: [{ type: 'table', rows: [], columns: [{ width: 0.01 }, { width: 0.98 }] }] }
  assert.deepEqual(htmlSemantics(ast, 'pandoc', context('pandoc')), expected)
  assert.deepEqual(htmlSemantics(expected, 'pandoc', context('pandoc')), expected)
  assert.deepEqual(ast.children[0].columns, [{ width: 0.013 }, { width: 0.987 }])
})

test('body metadata is normalized only when its partition survives', () => {
  const groups = { headRows: 0, footRows: 0, bodies: [{ headRows: 1, bodyRows: 1, rowHeadColumns: 1 }, { headRows: 0, bodyRows: 0 }] }
  const before = { children: [{ type: 'table', rowGroups: groups }] }
  const after = { children: [{ type: 'table', rowGroups: groups, attrs: { keyValues: { 'body-rows': '1,0', 'body-header-rows': '1,0', 'body-header-cols': '1,' } } }] }
  const change = { path: '/children/0/attrs', after: after.children[0].attrs }
  assert.equal(isTableMetadataSpelling(before, after, change), true)
  assert.equal(isTableMetadataSpelling(before, { children: [{ ...after.children[0], rowGroups: { ...groups, bodies: [{ headRows: 0, bodyRows: 2 }] } }] }, change), false)
  const keyChange = { path: '/children/0/attrs/keyValues/body-rows', after: '1,0' }
  assert.equal(isTableMetadataSpelling(before, after, keyChange), true)
})

test('HAST percentages retain exact AST fractions', async () => {
  const { readForeign } = await import('../scripts/compat/tools.mjs')
  const html = '<table><colgroup><col style="width: 33.3%"><col style="width: 66.7%"></colgroup><tbody><tr><td>a</td><td>b</td></tr></tbody></table>'
  const result = await readForeign('hast', html)
  assert.deepEqual(result.ast.children[0].columns, [{ width: 0.333 }, { width: 0.667 }])
})
