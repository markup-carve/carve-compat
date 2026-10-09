import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { engineNames } from './engines.mjs'
import { runHtmlSuite } from './html-suite.mjs'
import { compareHtml, applyDeclaration, validateDeclarations } from './commonmark-spec.mjs'

export const djotCommit = '596e7fcf487f35c739de6a9c33e9a944c1927e56'
export const djotSha256 = 'f02f3ba7c6c49063418481b774c49aef3f96088735e122882cf21f162707bb9e'
export const testfiles = [
  'attributes.test', 'block_quote.test', 'code_blocks.test', 'definition_lists.test',
  'symb.test', 'emphasis.test', 'escapes.test', 'fenced_divs.test', 'footnotes.test',
  'headings.test', 'insert_delete_mark.test', 'links_and_images.test', 'lists.test',
  'math.test', 'para.test', 'raw.test', 'regression.test', 'smart.test', 'spans.test',
  'sourcepos.test', 'super_subscript.test', 'tables.test', 'task_lists.test',
  'thematic_breaks.test', 'verbatim.test',
]
export const djotTestsPath = fileURLToPath(new URL('../../tests/djot-tests/', import.meta.url))

export function parseTests(source, file = '') {
  const lines = source.split('\n')
  let idx = 0
  const getLine = () => idx < lines.length ? lines[idx++] : null
  const tests = []
  let line
  while (true) {
    let inp = '', out = ''
    const pretext = []
    line = getLine()
    while (line !== null && !line.match(/^```/)) {
      pretext.push(line)
      line = getLine()
    }
    const testlinenum = idx
    if (line === null) break
    const m = line.match(/^(`+)\s*(.*)/)
    if (!m) throw new Error('Test start line did not have expected form.')
    const ticks = new RegExp('^' + m[1]), options = m[2]
    line = getLine()
    while (line !== null && !line.match(/^[.!]$/)) {
      inp += line + '\n'
      line = getLine()
    }
    // Upstream leaves filter parsing as a TODO; retain its output verbatim.
    const filtered = line === '!'
    line = getLine()
    while (line !== null && !line.match(ticks)) {
      out += line + '\n'
      line = getLine()
    }
    tests.push({file,linenum:testlinenum,pretext:pretext.join('\n'),options,filters:[],filtered,input:inp,output:out})
  }
  return tests
}

export function validateDjotTests(directory = djotTestsPath) {
  const files = readdirSync(directory).filter(name => name.endsWith('.test') || name === 'LICENSE').sort()
  assert.deepEqual(files, [...testfiles, 'filters.test', 'LICENSE'].sort(), 'Djot suite file list differs from upstream')
  const checksum = createHash('sha256')
  for (const name of files) checksum.update(name + '\0').update(readFileSync(join(directory,name)))
  assert.equal(checksum.digest('hex'), djotSha256, 'Djot suite checksum differs from the verbatim upstream files')
  const tests = testfiles.flatMap(file => parseTests(readFileSync(join(directory,file),'utf8'), file))
  const excluded = { options:tests.filter(t => t.options !== '').length, filters:tests.filter(t => t.filtered || t.filters.length > 0).length }
  const examples = tests.filter(t => t.options === '' && !t.filtered && t.filters.length === 0).map(t => ({
    example:`${t.file}:${t.linenum}`, section:t.file.slice(0,-5), source:t.input, html:t.output,
    link:`https://github.com/jgm/djot.js/blob/${djotCommit}/test/${t.file}#L${t.linenum}`,
  }))
  return {tests,examples,excluded}
}

export function loadDjotDeclarations(examples, directory = djotTestsPath) {
  const path = join(directory,'declared.json')
  if (!existsSync(path)) return {differences:[],declaredSha256:null}
  const source = readFileSync(path)
  return {differences:validateDeclarations(source, examples),declaredSha256:createHash('sha256').update(source).digest('hex')}
}

export function runDjotTests(selectedEngines = engineNames) {
  const startedAt = new Date(), started = performance.now()
  const {examples,excluded} = validateDjotTests(), {differences,declaredSha256} = loadDjotDeclarations(examples)
  const measured = runHtmlSuite(selectedEngines, { examples, format:'djot', sourceKey:'source', differences, compare:({expectedHtml,carveHtml,difference}) => applyDeclaration(compareHtml(expectedHtml,carveHtml,{expectedGenerated:true}),difference) })
  return { schemaVersion:1, kind:'djot-tests', suite:{name:'djot.js',commit:djotCommit,sha256:djotSha256,examples:examples.length,excluded}, ...measured, startedAt:startedAt.toISOString(), generatedAt:new Date().toISOString(), durationMs:Math.round(performance.now() - started), declaredSha256 }
}
