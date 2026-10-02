import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import Ajv2020 from 'ajv/dist/2020.js'
import { fromAstJson, toAstJson, parse, renderCarve, renderHtml, resolve, markdownToCarve, djotToCarve, htmlToCarve } from '@markup-carve/carve'
import { context, semantics, plain, parseHtml, fromHast, authoredAttributes } from './trees.mjs'
import { engineNames, engineMetadata, cachedEngine, engineProjection } from './engines.mjs'
import { toolNames, readForeign, exportForeign } from './tools.mjs'

const schema = JSON.parse(readFileSync(new URL('../../resources/ast-schema.json', import.meta.url)))
const validate = new Ajv2020({ strict: false }).compile(schema)
export const corpus = JSON.parse(readFileSync(new URL('../../tests/external-compat/cases.json', import.meta.url)))
export const lossCorpus = JSON.parse(readFileSync(new URL('../../tests/external-compat/losses.json', import.meta.url)))
export const sourceFormats = { mdast: 'markdown', hast: 'html', commonmark: 'markdown', cmark: 'markdown', md4c: 'markdown', djot: 'djot', docutils: 'rst', asciidoctor: 'asciidoc', pandoc: 'pandocMarkdown' }

export function validateAst(ast) {
  assert.equal(validate(ast), true, JSON.stringify(validate.errors))
}

export function validateCorpus(data = corpus) {
  assert.equal(data.schemaVersion, 1)
  assert.ok(data.cases.length > 0, 'Compatibility corpus is empty')
  assert.equal(new Set(data.cases.map(c => c.id)).size, data.cases.length, 'Duplicate case identifier')
  for (const c of data.cases) {
    assert.match(c.id, /^[a-z0-9-]+$/)
    assert.equal(typeof c.carve, 'string', `${c.id}: missing Carve expectation`)
    assert.ok((c.tools ?? toolNames).length > 0, `${c.id}: no tools selected`)
    for (const tool of c.tools ?? toolNames) {
      assert.ok(toolNames.includes(tool), `${c.id}: unknown tool ${tool}`)
      assert.equal(typeof c[sourceFormats[tool]], 'string', `${c.id}: missing ${tool} source`)
    }
  }
  for (const tool of toolNames) assert.ok(data.cases.some(c => (c.tools ?? toolNames).includes(tool)), `${tool} has no cases`)
}

export function validateLossCorpus(data = lossCorpus) {
  assert.equal(data.schemaVersion, 1)
  assert.ok(data.cases.length > 0, 'Loss corpus is empty')
  assert.equal(new Set(data.cases.map(c => c.id)).size, data.cases.length, 'Duplicate loss case identifier')
  for (const c of data.cases) {
    assert.match(c.id, /^[a-z0-9-]+$/)
    assert.ok(['import', 'export'].includes(c.direction), `${c.id}: unknown loss direction`)
    assert.ok(c.tools.length > 0, `${c.id}: no loss tools selected`)
    for (const tool of c.tools) assert.ok(toolNames.includes(tool), `${c.id}: unknown loss tool ${tool}`)
    assert.equal(typeof c[c.direction === 'import' ? 'source' : 'carve'], 'string')
    assert.equal(typeof c.expected.code, 'string')
    assert.equal(typeof c.expected.path, 'string')
    assert.ok(['degraded', 'dropped'].includes(c.expected.fidelity))
    assert.ok(typeof c.retained === 'string' && c.retained.length > 0)
  }
  for (const tool of toolNames) assert.ok(data.cases.some(c => c.tools.includes(tool)), `${tool} has no loss cases`)
}

export function checkIndependent(result) {
  validateAst(result.independentAst)
  assert.deepEqual(semantics(result.independentAst),semantics(result.ast),'Independent DocBook structure differs from the HTML-derived Asciidoctor tree')
  assert.deepEqual(result.independentDiagnostics.filter(d=>['degraded','dropped'].includes(d.fidelity)),[],'Independent DocBook comparison lost structure')
}

export async function checkCase(tool, fixture) {
  const progress = { checks: [], diagnostics: [], evidence: { sourceFormat: sourceFormats[tool], source: fixture[sourceFormats[tool]], carve: fixture.carve } }
  try {
  const expected = semantics(toAstJson(parse(fixture.carve)))
  const result = await readForeign(tool, fixture[sourceFormats[tool]])
  Object.assign(progress, { version: result.version, diagnostics: result.diagnostics })
  Object.assign(progress.evidence, { ast: result.ast, foreignHtml: result.html })
  validateAst(result.ast)
  progress.checks.push('ast-schema')
  assert.deepEqual(semantics(result.ast), expected, `${tool}/${fixture.id}: foreign AST mapping`)
  assert.deepEqual(result.diagnostics.filter(d => ['degraded', 'dropped'].includes(d.fidelity)), [], `${tool}/${fixture.id}: unreported subset loss`)

  progress.checks.push('ast-mapping')
  if (result.independentAst) {
    progress.evidence.independentAst=result.independentAst
    progress.evidence.independentSource=result.independentSource
    progress.diagnostics.push(...result.independentDiagnostics)
    checkIndependent(result)
    progress.checks.push('independent-docbook')
  }
  const renderedContext = context(tool)
  const authored = authoredAttributes(result.ast)
  const rendered = fromHast(parseHtml(result.html), renderedContext, { generated: tool !== 'hast', renderer: tool, ...authored })
  progress.diagnostics = [...result.diagnostics, ...(result.independentDiagnostics??[]), ...renderedContext.diagnostics]
  const carveHtml = renderHtml(resolve(fromAstJson(result.ast)))
  const carveContext = context('carve')
  const carveRendered = fromHast(parseHtml(carveHtml), carveContext, { generated: true, ...authored })
  assert.deepEqual(semantics(rendered), semantics(carveRendered), `${tool}/${fixture.id}: independent HTML structure`)
  assert.deepEqual(renderedContext.diagnostics.filter(d => ['degraded', 'dropped'].includes(d.fidelity)), [], `${tool}/${fixture.id}: HTML comparison lost structure`)
  assert.deepEqual(carveContext.diagnostics.filter(d => ['degraded', 'dropped'].includes(d.fidelity)), [], `${tool}/${fixture.id}: Carve HTML comparison lost structure`)

  progress.checks.push('html-structure')
  const importers = { markdown: markdownToCarve, djot: djotToCarve, html: s => htmlToCarve(s).value }
  const importer = importers[sourceFormats[tool]]
  if (importer) {
    const imported = importer(fixture[sourceFormats[tool]])
    const importedContext = context('carve-importer')
    const importedHtml = fromHast(parseHtml(renderHtml(resolve(parse(imported)))), importedContext, { generated: true, ...authored })
    assert.deepEqual(semantics(importedHtml), semantics(rendered), `${tool}/${fixture.id}: built-in importer rendering`)
    progress.checks.push('built-in-importer-rendering')
    assert.deepEqual(importedContext.diagnostics.filter(d => ['degraded', 'dropped'].includes(d.fidelity)), [], `${tool}/${fixture.id}: importer HTML comparison lost structure`)
  }

  const canonical = renderCarve(fromAstJson(result.ast))
  const reparsed = toAstJson(parse(canonical))
  validateAst(reparsed)
  assert.deepEqual(semantics(reparsed), expected, `${tool}/${fixture.id}: Carve source round trip`)

  progress.checks.push('carve-source-roundtrip')
  const encoded = JSON.parse(JSON.stringify(result.ast))
  const decoded = toAstJson(fromAstJson(encoded))
  validateAst(decoded)
  assert.deepEqual(semantics(decoded), expected, `${tool}/${fixture.id}: JSON interchange round trip`)

  progress.checks.push('json-roundtrip')
  const exported = exportForeign(tool, result.ast)
  progress.evidence.exportedSource = exported.source
  progress.diagnostics = [...progress.diagnostics, ...exported.diagnostics]
  assert.deepEqual(exported.diagnostics.filter(d => ['degraded', 'dropped'].includes(d.fidelity)), [], `${tool}/${fixture.id}: supported export reported a loss`)
  const reread = await readForeign(tool, exported.source)
  progress.diagnostics.push(...reread.diagnostics)
  if (reread.independentAst) {progress.diagnostics.push(...reread.independentDiagnostics);checkIndependent(reread)}
  validateAst(reread.ast)
  assert.deepEqual(semantics(reread.ast), expected, `${tool}/${fixture.id}: foreign source round trip`)
  assert.deepEqual(reread.diagnostics.filter(d => ['degraded', 'dropped'].includes(d.fidelity)), [], `${tool}/${fixture.id}: foreign source round trip lost structure`)
  return { tool, case: fixture.id, status: 'passed', kind: 'supported', evidence: { sourceFormat: sourceFormats[tool], source: fixture[sourceFormats[tool]], carve: fixture.carve, ast: result.ast, foreignHtml: result.html, exportedSource: exported.source, ...(result.independentAst ? {independentAst:result.independentAst,independentSource:result.independentSource} : {}) }, checks: ['ast-schema', 'ast-mapping', 'html-structure', 'carve-source-roundtrip', 'json-roundtrip', 'foreign-source-roundtrip', ...(importer ? ['built-in-importer-rendering'] : []), ...(result.independentAst ? ['independent-docbook'] : [])], diagnostics: [...result.diagnostics, ...renderedContext.diagnostics, ...exported.diagnostics, ...reread.diagnostics, ...(result.independentDiagnostics??[]), ...(reread.independentDiagnostics??[])], version: result.version }
  } catch (error) { error.compatibilityEvidence = progress; throw error }
}

export async function checkLossCase(tool, fixture) {
  const expectedPath = fixture.expected.pathsByTool?.[tool] ?? fixture.expected.path
  const progress = { checks: [], diagnostics: [], evidence: { direction: fixture.direction, sourceFormat: fixture.direction === 'import' ? sourceFormats[tool] : 'carve', source: fixture.source ?? fixture.carve, expected: { ...fixture.expected, path: expectedPath }, retained: fixture.retained } }
  try {
  let result
  if (fixture.direction === 'import') result = await readForeign(tool, fixture.source)
  else {
    const exported = exportForeign(tool, toAstJson(parse(fixture.carve)))
    progress.diagnostics = exported.diagnostics
    progress.evidence.exportedSource = exported.source
    const reread = await readForeign(tool, exported.source)
    result = { ...reread, diagnostics: [...exported.diagnostics, ...reread.diagnostics] }
  }
  Object.assign(progress, { version: result.version, diagnostics: result.diagnostics })
  progress.evidence.ast = result.ast
  validateAst(result.ast)
  progress.checks.push('fallback-schema')
  assert.ok(result.diagnostics.some(d => d.code === fixture.expected.code && d.fidelity === fixture.expected.fidelity && d.path === expectedPath), `${tool}/${fixture.id}: expected loss at ${expectedPath} was not reported`)
  progress.checks.push('loss-diagnostic')
  assert.ok(plain(result.ast).includes(fixture.retained), `${tool}/${fixture.id}: fallback lost readable content`)
  for (const diagnostic of result.diagnostics) {
    assert.equal(typeof diagnostic.path, 'string')
    assert.ok(['preserved', 'normalized', 'degraded', 'dropped'].includes(diagnostic.fidelity))
  }
  return { tool, case: fixture.id, status: 'passed', kind: 'loss', evidence: { direction: fixture.direction, sourceFormat: fixture.direction === 'import' ? sourceFormats[tool] : 'carve', source: fixture.source ?? fixture.carve, ast: result.ast, expected: { ...fixture.expected, path: expectedPath }, retained: fixture.retained }, checks: ['loss-diagnostic', 'fallback-schema', 'fallback-content'], diagnostics: result.diagnostics, version: result.version }
  } catch (error) { error.compatibilityEvidence = progress; throw error }
}

export function checkEngineCase(engine, tool, fixture, baseline) {
  const progress = { checks: [], diagnostics: [...baseline.diagnostics], evidence: { ...baseline.evidence } }
  try {
    const expected = baseline.kind === 'supported' ? toAstJson(parse(fixture.carve)) : baseline.evidence.ast
    const source = baseline.kind === 'supported' ? fixture.carve : renderCarve(fromAstJson(baseline.evidence.ast))
    const result = cachedEngine(engine, baseline.evidence.ast, source)
    Object.assign(progress.evidence, { engineAst:result.decodedAst, engineCarve:result.canonical })
    for (const ast of baseline.kind==='supported'?[result.decodedAst,result.reparsedAst,result.parsedAst]:[result.decodedAst]) validateAst(ast)
    progress.checks.push('ast-schema')
    assert.deepEqual(semantics(engineProjection(result.decodedAst,baseline.evidence.ast,progress.diagnostics)),semantics(baseline.evidence.ast),`${engine}/${tool}/${fixture.id}: JSON interchange`)
    progress.checks.push('json-roundtrip')
    if(baseline.kind==='supported'){
    assert.deepEqual(semantics(engineProjection(result.reparsedAst,baseline.evidence.ast,progress.diagnostics)),semantics(baseline.evidence.ast),`${engine}/${tool}/${fixture.id}: Carve source round trip`)
    progress.checks.push('carve-source-roundtrip')
    assert.deepEqual(semantics(engineProjection(result.parsedAst,expected,progress.diagnostics)),semantics(expected),`${engine}/${tool}/${fixture.id}: authored Carve source parse`)
    progress.checks.push('ast-mapping')
    }
    const ctx = context(engine), authored = authoredAttributes(baseline.evidence.ast)
    const actualHtml = fromHast(parseHtml(result.html),ctx,{generated:true,...authored})
    const expectedHtml = fromHast(parseHtml(renderHtml(resolve(fromAstJson(baseline.evidence.ast)))),context('reference'),{generated:true,...authored})
    progress.diagnostics.push(...ctx.diagnostics)
    assert.deepEqual(semantics(actualHtml),semantics(expectedHtml),`${engine}/${tool}/${fixture.id}: rendered HTML structure`)
    assert.deepEqual(ctx.diagnostics.filter(d=>['degraded','dropped'].includes(d.fidelity)),[],`${engine}/${tool}/${fixture.id}: HTML comparison lost structure`)
    progress.checks.push('html-structure')
    return { ...baseline, engine, ...progress, version:baseline.version }
  } catch(error) { error.compatibilityEvidence = progress; throw error }
}

export async function runCompatibility(selected = toolNames, selectedEngines = ['javascript']) {
  const startedAt = new Date(), started = performance.now()
  validateCorpus()
  validateLossCorpus()
  assert.equal(new Set([...corpus.cases, ...lossCorpus.cases].map(c => c.id)).size, corpus.cases.length + lossCorpus.cases.length, 'Case identifiers must be unique across supported and loss corpora')
  assert.ok(selected.length > 0, 'No compatibility tools selected')
  assert.equal(new Set(selected).size, selected.length, 'Duplicate selected tool')
  for (const tool of selected) assert.ok(toolNames.includes(tool), `Unknown tool: ${tool}`)
  assert.ok(selectedEngines.includes('javascript'), 'Select the JavaScript reference engine with any native engines')
  assert.equal(new Set(selectedEngines).size,selectedEngines.length,'Duplicate selected engine')
  for (const engine of selectedEngines) assert.ok(engineNames.includes(engine),`Unknown engine: ${engine}`)
  const rows = []
  for (const tool of selected) {
    for (const fixture of corpus.cases.filter(c => (c.tools ?? toolNames).includes(tool))) {
      try { rows.push({ ...await checkCase(tool, fixture), engine:'javascript' }) }
      catch (error) { rows.push({ tool, engine:'javascript', case: fixture.id, status: 'failed', kind: fixture.direction ? 'loss' : 'supported', error: error.message, errorDetails: { operator: error.operator, actual: error.actual, expected: error.expected }, ...error.compatibilityEvidence, evidence: { sourceFormat: fixture.direction === 'export' ? 'carve' : sourceFormats[tool], source: fixture.source ?? fixture[sourceFormats[tool]] ?? fixture.carve, carve: fixture.carve, ...error.compatibilityEvidence?.evidence } }) }
    }
    for (const fixture of lossCorpus.cases.filter(c => c.tools.includes(tool))) {
      try { rows.push({ ...await checkLossCase(tool, fixture), engine:'javascript' }) }
      catch (error) { rows.push({ tool, engine:'javascript', case: fixture.id, status: 'failed', kind: fixture.direction ? 'loss' : 'supported', error: error.message, errorDetails: { operator: error.operator, actual: error.actual, expected: error.expected }, ...error.compatibilityEvidence, evidence: { sourceFormat: fixture.direction === 'export' ? 'carve' : sourceFormats[tool], source: fixture.source ?? fixture[sourceFormats[tool]] ?? fixture.carve, carve: fixture.carve, ...error.compatibilityEvidence?.evidence } }) }
    }
  }
  const referenceRows = [...rows]
  const engines = Object.fromEntries(selectedEngines.map(engine => { try { const {root,binary,...metadata} = engineMetadata(engine);return [engine,metadata] } catch(error) { return [engine,{name:engine,error:error.message}] } }))
  for (const engine of selectedEngines.filter(e=>e!=='javascript')) {
    for (const baseline of referenceRows) {
      const fixture = [...corpus.cases,...lossCorpus.cases].find(f=>f.id===baseline.case)
      if (baseline.status !== 'passed') { rows.push({...baseline,engine,failureOrigin:'reference-adapter',error:`Cross-engine check blocked by reference adapter: ${baseline.error}`,checks:[]});continue }
      try { rows.push(checkEngineCase(engine,baseline.tool,fixture,baseline)) }
      catch(error) { rows.push({...baseline,engine,status:'failed',error:error.message,errorDetails:{actual:error.actual,expected:error.expected,operator:error.operator},...error.compatibilityEvidence}) }
    }
  }
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url)))
  const engine = JSON.parse(readFileSync(new URL('../../node_modules/@markup-carve/carve/package.json', import.meta.url)))
  let revision
  try { revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() } catch { revision = 'unavailable' }
  return { schemaVersion: 1, selectedEngines, notMeasuredEngines:engineNames.filter(e=>!selectedEngines.includes(e)), engines, startedAt: startedAt.toISOString(), generatedAt: new Date().toISOString(), durationMs: Math.round(performance.now() - started), suiteRevision: revision, engine: { name: engine.name, version: engine.version, dependency: pkg.devDependencies['@markup-carve/carve'] }, schema: { ...JSON.parse(readFileSync(new URL('../../resources/provenance.json', import.meta.url))), sha256: createHash('sha256').update(readFileSync(new URL('../../resources/ast-schema.json', import.meta.url))).digest('hex') }, engineConfigSha256:createHash('sha256').update(readFileSync(new URL('../../resources/engines.json',import.meta.url))).digest('hex'), fixtureHashes: Object.fromEntries(['cases.json', 'losses.json'].map(file => [file, createHash('sha256').update(readFileSync(new URL(`../../tests/external-compat/${file}`, import.meta.url))).digest('hex')])), selected, notMeasured: toolNames.filter(t => !selected.includes(t)), passed: rows.filter(r => r.status === 'passed').length, failed: rows.filter(r => r.status === 'failed').length, rows }
}
