import assert from 'node:assert/strict'
import { isDeepStrictEqual } from 'node:util'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { parse, resolve, renderHtml } from '@markup-carve/carve'
import { context, semantics, parseHtml, fromHast, coalesce } from './trees.mjs'
import { engineNames, engineMetadata } from './engines.mjs'
import { reportClass, honesty, honestyOutcomes, runImportBatch } from './importer-report.mjs'
export { reportClass } from './importer-report.mjs'

export const specSha256 = 'd431b29d97b6f73e69d547109cf5081578fac931e72afe95639ebe766c1b2a20'
const specPath = new URL('../../tests/commonmark-spec/spec.json', import.meta.url)
const hash = value => createHash('sha256').update(value).digest('hex')
const loss = d => ['degraded','dropped'].includes(d.fidelity)
const counts = () => ({ match:0, mismatch:0, notComparable:0, failed:0 })
const countKey = status => status === 'not-comparable' ? 'notComparable' : status

export function validateSpec(source = readFileSync(specPath)) {
  const examples = JSON.parse(source.toString())
  assert.ok(Array.isArray(examples), 'CommonMark spec must be an array')
  assert.equal(examples.length, 652, 'CommonMark spec must contain 652 examples')
  assert.equal(new Set(examples.map(e => e.example)).size, 652, 'Duplicate CommonMark example')
  for (const e of examples) {
    for (const key of ['markdown','html','section']) assert.equal(typeof e[key], 'string', `Example ${e.example}: invalid ${key}`)
    assert.ok(Number.isInteger(e.example) && e.example >= 1 && e.example <= 652, 'Invalid CommonMark example number')
    assert.ok(Number.isInteger(e.start_line) && Number.isInteger(e.end_line) && e.start_line <= e.end_line, `Example ${e.example}: invalid source lines`)
  }
  assert.equal(hash(source), specSha256, 'CommonMark spec checksum differs from the verbatim upstream file')
  return examples
}

export const layout = html => html.split(/(<pre[\s>][\s\S]*?<\/pre>)/i).map((part,i) => i % 2 ? part : part.replace(/\n[ \t]+</g, '\n<')).join('').trimEnd()

export function renderedWhitespace(tree) {
  if (Array.isArray(tree)) return coalesce(tree.map(renderedWhitespace))
  if (!tree || typeof tree !== 'object') return tree
  if (['code','code_block'].includes(tree.type)) return structuredClone(tree)
  if (tree.type === 'text') return { ...tree, value:tree.value.replace(/[ \t\n\r\f]+/g, ' ') }
  const out = Object.fromEntries(Object.entries(tree).map(([key,value]) => [key,renderedWhitespace(value)]))
  if (['paragraph','heading','table_cell','definition_term'].includes(tree.type) && out.children) {
    if (out.children[0]?.type === 'text') out.children[0].value = out.children[0].value.replace(/^ +/, '')
    if (out.children.at(-1)?.type === 'text') out.children.at(-1).value = out.children.at(-1).value.replace(/ +$/, '')
    out.children = coalesce(out.children)
  }
  return out
}

export function compareHtml(expectedHtml, carveHtml) {
  const expectedContext = context('commonmark-spec')
  const expected = renderedWhitespace(semantics(fromHast(parseHtml(layout(expectedHtml)), expectedContext, {})))
  const actual = renderedWhitespace(semantics(fromHast(parseHtml(layout(carveHtml)), context('carve'), { generated:true })))
  return { status:expectedContext.diagnostics.some(loss) ? 'not-comparable' : isDeepStrictEqual(expected, actual) ? 'match' : 'mismatch', expected, actual }
}

export function runCommonmarkSpec(selectedEngines = engineNames) {
  const startedAt = new Date(), started = performance.now(), examples = validateSpec()
  assert.ok(selectedEngines.length > 0, 'No engines selected')
  assert.equal(new Set(selectedEngines).size, selectedEngines.length, 'Duplicate selected engine')
  for (const engine of selectedEngines) assert.ok(engineNames.includes(engine), `Unknown engine: ${engine}`)
  const metadata = Object.fromEntries(selectedEngines.map(engine => [engine,engineMetadata(engine)]))
  const engines = Object.fromEntries(Object.entries(metadata).map(([engine,{root,binary,...meta}]) => [engine,meta]))
  const reference = engineMetadata('javascript'), pkg = JSON.parse(readFileSync(new URL('../../node_modules/@markup-carve/carve/package.json', import.meta.url)))
  const totals = Object.fromEntries(selectedEngines.map(engine => [engine,{ ...counts(), honesty:Object.fromEntries(honestyOutcomes.map(outcome => [outcome,0])), mismatchByReport:{ 'names-loss':0, 'unverified-only':0, clean:0 } }]))
  const sections = [...new Set(examples.map(e => e.section))].map(section => ({ section, examples:examples.filter(e => e.section === section).length, results:Object.fromEntries(selectedEngines.map(engine => [engine,counts()])) }))
  const rows = []
  for (const engine of selectedEngines) {
    const batch = runImportBatch(engine, examples.map(e => e.markdown))
    for (const [i,e] of examples.entries()) {
      const result = batch[i]
      const diagnostics = result.report?.diagnostics ?? []
      const row = { engine, example:e.example, section:e.section, status:'failed', markdown:e.markdown, expectedHtml:e.html, carve:result.value ?? '', carveHtml:'', diagnostics, reportClass:reportClass(diagnostics) }
      if (Object.hasOwn(result, 'error')) row.error = result.error
      else {
        try {
          row.carveHtml = renderHtml(resolve(parse(result.value)))
          row.status = compareHtml(e.html, row.carveHtml).status
        } catch (error) { row.error = `Rendering the imported Carve failed: ${error.message}` }
      }
      row.honesty = ['match','mismatch'].includes(row.status) ? honesty(row.status === 'match', row.reportClass) : null
      if (row.honesty !== null) totals[engine].honesty[row.honesty]++
      rows.push(row)
      totals[engine][countKey(row.status)]++
      if (row.status === 'mismatch') totals[engine].mismatchByReport[row.reportClass]++
      sections.find(s => s.section === e.section).results[engine][countKey(row.status)]++
    }
  }
  const reportDisagreements = examples.flatMap(e => {
    const results = rows.filter(row => row.example === e.example)
    if (new Set(results.map(row => row.reportClass)).size < 2) return []
    return [{ example:e.example, section:e.section, classes:Object.fromEntries(results.map(row => [row.engine,row.reportClass])), codes:Object.fromEntries(results.map(row => [row.engine,row.diagnostics.map(d => d.code)])) }]
  })
  let suiteRevision
  try { suiteRevision = execFileSync('git', ['rev-parse','HEAD'], { encoding:'utf8' }).trim() } catch { suiteRevision = 'unavailable' }
  return { schemaVersion:1, kind:'commonmark-spec', spec:{ version:'0.31.2', source:'https://spec.commonmark.org/0.31.2/spec.json', sha256:specSha256, examples:examples.length }, renderer:{ name:pkg.name, version:reference.version, dependency:reference.dependency }, engines, selectedEngines, notMeasuredEngines:engineNames.filter(e => !selectedEngines.includes(e)), engineConfigSha256:hash(readFileSync(new URL('../../resources/engines.json', import.meta.url))), startedAt:startedAt.toISOString(), generatedAt:new Date().toISOString(), durationMs:Math.round(performance.now() - started), suiteRevision, totals, sections, rows, reportDisagreements }
}
