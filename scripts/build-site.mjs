import { readFileSync, mkdirSync, cpSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { validateHtmlSuite } from './compat/validate-html-suite.mjs'
import { validateDjotTests, loadDjotDeclarations, djotCommit, djotSha256 } from './compat/djot-tests.mjs'
import { validateDeclarations } from './compat/commonmark-spec.mjs'
let reportPath = 'reports/latest.json', commonmarkPath = 'reports/commonmark.json', djotPath = 'reports/djot.json', positional = false
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('--commonmark=') && arg.slice('--commonmark='.length)) commonmarkPath = arg.slice('--commonmark='.length)
  else if (arg.startsWith('--djot=') && arg.slice('--djot='.length)) djotPath = arg.slice('--djot='.length)
  else if (!arg.startsWith('-') && !positional) { reportPath = arg; positional = true }
  else throw new Error(`Unknown argument: ${arg}`)
}
const report = JSON.parse(readFileSync(reportPath))
assert.equal(report.schemaVersion, 1)
assert.ok(report.generatedAt && report.engine && report.schema, 'Generate a fresh provenance-bearing report before building the site')
assert.equal(report.rows.length, report.passed + report.failed)
assert.equal(report.rows.filter(r => r.status === 'passed').length, report.passed)
assert.equal(report.rows.filter(r => r.status === 'failed').length, report.failed)
assert.ok(report.rows.every(r => report.selected.includes(r.tool)))
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex')
assert.equal(report.schema.sha256, hash('resources/ast-schema.json'), 'Schema changed after this report was measured')
for (const file of ['cases.json', 'losses.json']) assert.equal(report.fixtureHashes?.[file], hash(`tests/external-compat/${file}`), `${file} changed after this report was measured`)
if(report.engineConfigSha256)assert.equal(report.engineConfigSha256,hash('resources/engines.json'),'Engine pins changed after this report was measured')
if (Object.hasOwn(report, 'importerAssessmentSha256')) assert.equal(report.importerAssessmentSha256, hash('resources/importer-assessment.json'), 'Importer assessment changed after this report was measured')
let commonmark
if (existsSync(commonmarkPath)) {
  commonmark = JSON.parse(readFileSync(commonmarkPath))
  assert.equal(commonmark.schemaVersion, 1)
  assert.equal(commonmark.kind, 'commonmark-spec')
  assert.equal(commonmark.spec?.sha256, hash('tests/commonmark-spec/spec.json'), 'CommonMark spec changed after this report was measured')
  assert.equal(commonmark.engineConfigSha256, hash('resources/engines.json'), 'Engine pins changed after the CommonMark measurement')
  assert.equal(commonmark.declaredSha256, hash('tests/commonmark-spec/declared.json'), 'Declarations changed after the CommonMark measurement')
  const spec = JSON.parse(readFileSync('tests/commonmark-spec/spec.json'))
  const differences = validateDeclarations(readFileSync('tests/commonmark-spec/declared.json'), spec)
  assert.equal(commonmark.spec.examples, spec.length, 'Incomplete CommonMark spec measurement')
  validateHtmlSuite(commonmark, {label:'CommonMark',examples:spec,differences,sourceKey:'markdown'})
}
let djot
if (existsSync(djotPath)) {
  djot = JSON.parse(readFileSync(djotPath))
  const {examples,excluded} = validateDjotTests('tests/djot-tests')
  const {differences,declaredSha256} = loadDjotDeclarations(examples, 'tests/djot-tests')
  assert.equal(djot.schemaVersion, 1)
  assert.equal(djot.kind, 'djot-tests')
  assert.deepEqual(djot.suite, {name:'djot.js',commit:djotCommit,sha256:djotSha256,examples:examples.length,excluded}, 'Djot suite changed after this report was measured')
  assert.equal(djot.engineConfigSha256, hash('resources/engines.json'), 'Engine pins changed after the Djot measurement')
  assert.equal(djot.declaredSha256, declaredSha256, 'Declarations changed after the Djot measurement')
  validateHtmlSuite(djot, {label:'Djot',examples,differences,sourceKey:'source'})
}
const tools = JSON.parse(readFileSync('site/tools.json'))
assert.ok([...report.selected, ...report.notMeasured].every(t => tools.some(tool => tool.id === t)))
mkdirSync('dist', { recursive: true })
cpSync('site', 'dist', { recursive: true })
assert.ok(readFileSync('site/index.html','utf8').includes('src="app.js"'),'Application script reference missing')
assert.ok(readFileSync('site/index.html','utf8').includes('href="style.css"'),'Stylesheet reference missing')
const html=readFileSync('site/index.html','utf8').replace('src="app.js"',`src="app.js?v=${hash('site/app.js').slice(0,12)}"`).replace('href="style.css"',`href="style.css?v=${hash('site/style.css').slice(0,12)}"`)
writeFileSync('dist/index.html',html)
writeFileSync('dist/report.json', JSON.stringify(report, null, 2) + '\n')
if (commonmark) writeFileSync('dist/commonmark.json', JSON.stringify(commonmark, null, 2) + '\n')
else rmSync('dist/commonmark.json', { force:true })
if (djot) writeFileSync('dist/djot.json', JSON.stringify(djot, null, 2) + '\n')
else rmSync('dist/djot.json', { force:true })
writeFileSync('dist/manifest.json', JSON.stringify({ generatedAt: report.generatedAt, runUrl: process.env.GITHUB_RUN_ID ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null, tools }, null, 2) + '\n')
cpSync('resources/engines.json','dist/engines.json')
cpSync('resources/ast-schema.json', 'dist/ast-schema.json')
cpSync('tests/external-compat/cases.json', 'dist/cases.json')
cpSync('tests/external-compat/losses.json', 'dist/losses.json')
console.log(`Built site from ${report.rows.length} measured cases (${report.failed} failures).`)
console.log(commonmark ? `Included CommonMark report from ${commonmarkPath} (${commonmark.rows.length} examples across engines).` : `CommonMark report absent at ${commonmarkPath}; built without it.`)
console.log(djot ? `Included Djot report from ${djotPath} (${djot.rows.length} examples across engines).` : `Djot report absent at ${djotPath}; built without it.`)
