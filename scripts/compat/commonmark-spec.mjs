import assert from 'node:assert/strict'
import { isDeepStrictEqual } from 'node:util'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { parse as parseDjot, renderHTML } from '@djot/djot'
import { context, semantics, parseHtml, fromHast, coalesce } from './trees.mjs'
import { engineNames } from './engines.mjs'
import { runHtmlSuite } from './html-suite.mjs'
export { reportClass } from './importer-report.mjs'

export const specSha256 = 'd431b29d97b6f73e69d547109cf5081578fac931e72afe95639ebe766c1b2a20'
const specPath = new URL('../../tests/commonmark-spec/spec.json', import.meta.url)
const declaredPath = new URL('../../tests/commonmark-spec/declared.json', import.meta.url)
const hash = value => createHash('sha256').update(value).digest('hex')
const loss = d => ['degraded','dropped'].includes(d.fidelity)
const counts = () => ({ match:0, mismatch:0, notComparable:0, failed:0 })
const countKey = status => status === 'not-comparable' ? 'notComparable' : status
const pins = JSON.parse(readFileSync(new URL('../../resources/engines.json', import.meta.url)))
const pandocArgs = ['-f','commonmark','-t','djot','--wrap=preserve']

export function runPandocDjotBaseline(examples) {
  const binary = process.env.CARVE_PANDOC ?? '.cache/pandoc/bin/pandoc'
  const options = { encoding:'utf8', timeout:15000, maxBuffer:8*1024*1024 }
  const version = spawnSync(binary, ['--version'], options)
  if (version.error || version.status !== 0) throw new Error(`Pandoc baseline infrastructure error: ${version.error?.message ?? version.stderr}`)
  assert.equal(version.stdout.split(/\r?\n/)[0], `pandoc ${pins.pandoc.version}`, 'Pandoc baseline infrastructure error: version differs from resources/engines.json')
  const pkg = JSON.parse(readFileSync(new URL('../../node_modules/@djot/djot/package.json', import.meta.url)))
  const baseline = { converter:{ name:'pandoc', version:pins.pandoc.version, command:pandocArgs.join(' ') }, renderer:{ name:pkg.name, version:pkg.version }, totals:counts(), rows:[] }
  for (const e of examples) {
    const row = { example:e.example, section:e.section, status:'failed', output:'', html:'' }
    try {
      const converted = spawnSync(binary, pandocArgs, { ...options, input:e.markdown })
      row.output = converted.stdout ?? ''
      if (converted.error || converted.status !== 0) row.error = converted.stderr || converted.error?.message || `Pandoc exited with status ${converted.status}`
      else {
        row.html = renderHTML(parseDjot(row.output))
        row.status = compareHtml(e.html, row.html).status
      }
    } catch (error) { row.error = `Pandoc to Djot baseline failed: ${error.message}` }
    baseline.rows.push(row)
    baseline.totals[countKey(row.status)]++
  }
  return baseline
}

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

export function unwrapLoneImageParagraph(tree) {
  if (Array.isArray(tree)) return tree.map(unwrapLoneImageParagraph)
  if (!tree || typeof tree !== 'object') return tree
  const out = Object.fromEntries(Object.entries(tree).map(([key,value]) => [key,unwrapLoneImageParagraph(value)]))
  return out.type === 'paragraph' && out.children?.length === 1 && out.children[0].type === 'image' ? out.children[0] : out
}

export function dropMathRole(tree) {
  if (Array.isArray(tree)) return tree.map(dropMathRole)
  if (!tree || typeof tree !== 'object') return tree
  const out = Object.fromEntries(Object.entries(tree).map(([key,value]) => [key,dropMathRole(value)]))
  if (out.type !== 'span' || !out.attrs?.classes?.includes('math') || out.attrs.keyValues?.role !== 'math') return out
  const { role, ...keyValues } = out.attrs.keyValues, attrs = { ...out.attrs, keyValues }
  if (!Object.keys(keyValues).length) delete attrs.keyValues
  return { ...out, attrs }
}

const normalizations = Object.freeze({ 'unwrap-lone-image-paragraph':unwrapLoneImageParagraph, 'drop-math-role':dropMathRole })

export function validateDeclarations(source = readFileSync(declaredPath), examples = validateSpec()) {
  const file = JSON.parse(source.toString())
  assert.ok(file && typeof file === 'object' && !Array.isArray(file), 'Declarations must be an object')
  assert.equal(file.schemaVersion, 1, 'Invalid declarations schemaVersion')
  assert.ok(Array.isArray(file.differences), 'Declarations differences must be an array')
  const ids = new Set(), assigned = new Set(), known = new Set(examples.map(e => e.example))
  for (const d of file.differences) {
    assert.ok(d && typeof d === 'object' && !Array.isArray(d), 'Invalid declaration')
    assert.ok(typeof d.id === 'string' && d.id.trim(), 'Invalid declaration id')
    assert.ok(!ids.has(d.id), 'Duplicate declaration id'); ids.add(d.id)
    assert.ok(typeof d.normalization === 'string' && Object.hasOwn(normalizations, d.normalization), 'Unknown declaration normalization')
    assert.ok(typeof d.reason === 'string' && d.reason.trim(), 'Declaration reason must be non-empty')
    assert.ok(typeof d.reference === 'string' && URL.canParse(d.reference) && new URL(d.reference).protocol === 'https:', 'Declaration reference must be an https URL')
    assert.ok(Array.isArray(d.examples) && d.examples.length > 0, 'Declaration examples must be a non-empty array')
    for (const example of d.examples) {
      assert.ok(known.has(example), 'Invalid declaration example')
      assert.ok(!assigned.has(example), 'Duplicate declaration example'); assigned.add(example)
    }
  }
  return file.differences
}

export function applyDeclaration(comparison, difference) {
  if (!difference || comparison.status !== 'mismatch') return comparison
  const normalize = tree => renderedWhitespace(normalizations[difference.normalization](tree))
  const matches = isDeepStrictEqual(normalize(comparison.expected), normalize(comparison.actual))
  return { ...comparison, status:matches ? 'declared' : 'mismatch', declaration:matches ? { id:difference.id } : { id:difference.id, insufficient:true } }
}

export function compareHtml(expectedHtml, carveHtml, { expectedGenerated = false } = {}) {
  const expectedContext = context('commonmark-spec')
  const expected = renderedWhitespace(semantics(fromHast(parseHtml(layout(expectedHtml)), expectedContext, expectedGenerated ? { generated:true, renderer:'djot', keepDivs:true } : {})))
  const actual = renderedWhitespace(semantics(fromHast(parseHtml(layout(carveHtml)), context('carve'), { generated:true, renderer:'carve', ...(expectedGenerated ? { keepDivs:true } : {}) })))
  return { status:expectedContext.diagnostics.some(loss) ? 'not-comparable' : isDeepStrictEqual(expected, actual) ? 'match' : 'mismatch', expected, actual }
}

export function runCommonmarkSpec(selectedEngines = engineNames, { baselines:selectedBaselines = [] } = {}) {
  const startedAt = new Date(), started = performance.now(), examples = validateSpec()
  const declaredSource = readFileSync(declaredPath), differences = validateDeclarations(declaredSource, examples)
  assert.ok(Array.isArray(selectedBaselines), 'Baselines must be an array')
  assert.equal(new Set(selectedBaselines).size, selectedBaselines.length, 'Duplicate selected baseline')
  for (const baseline of selectedBaselines) assert.equal(baseline, 'pandoc-djot', `Unknown baseline: ${baseline}`)
  const baselines = Object.fromEntries(selectedBaselines.map(baseline => [baseline,runPandocDjotBaseline(examples)]))
  const measured = runHtmlSuite(selectedEngines, { examples, format:'markdown', sourceKey:'markdown', differences, baselines, compare:comparison => applyDeclaration(compareHtml(comparison.expectedHtml, comparison.carveHtml), comparison.difference) })
  return { schemaVersion:1, kind:'commonmark-spec', spec:{ version:'0.31.2', source:'https://spec.commonmark.org/0.31.2/spec.json', sha256:specSha256, examples:examples.length }, ...measured, startedAt:startedAt.toISOString(), generatedAt:new Date().toISOString(), durationMs:Math.round(performance.now() - started), declaredSha256:hash(declaredSource) }
}
