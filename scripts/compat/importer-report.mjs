import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { migrateMarkdown, migrateDjot, migrateHtml } from '@markup-carve/carve'
import { engineNames, engineMetadata } from './engines.mjs'

export const importerFormats = ['markdown', 'djot', 'html']
export const honestyOutcomes = ['reported', 'unassessed', 'silent-loss', 'false-loss', 'ok']
export const assessmentPath = new URL('../../resources/importer-assessment.json', import.meta.url)

export function reportClass(diagnostics) {
  if (diagnostics.some(d => ['degraded', 'dropped'].includes(d.fidelity) && d.code !== 'fidelity-unverified')) return 'names-loss'
  return diagnostics.some(d => d.code === 'fidelity-unverified') ? 'unverified-only' : 'clean'
}

export function honesty(structureKept, cls) {
  if (structureKept) return cls === 'names-loss' ? 'false-loss' : 'ok'
  return { 'names-loss': 'reported', 'unverified-only': 'unassessed', clean: 'silent-loss' }[cls]
}

export function validateAssessment(data = JSON.parse(readFileSync(assessmentPath))) {
  assert.ok(data && typeof data === 'object' && !Array.isArray(data), 'Invalid importer assessment config')
  assert.equal(data.schemaVersion, 1, 'Invalid importer assessment schemaVersion')
  assert.deepEqual(Object.keys(data).sort(), ['assessed', 'schemaVersion'], 'Invalid importer assessment fields')
  assert.ok(data.assessed && typeof data.assessed === 'object' && !Array.isArray(data.assessed), 'Missing assessed engine map')
  for (const engine of Object.keys(data.assessed)) assert.ok(engineNames.includes(engine), `Unknown assessment engine: ${engine}`)
  for (const engine of engineNames) {
    const formats = data.assessed[engine]
    assert.ok(Array.isArray(formats), `Missing assessment formats for ${engine}`)
    for (const format of formats) assert.ok(importerFormats.includes(format), `Unknown assessment format: ${format}`)
    assert.equal(new Set(formats).size, formats.length, `Duplicate assessment format for ${engine}`)
  }
  return data
}

function validateImport(result) {
  assert.ok(result && typeof result === 'object', 'Invalid migration driver result')
  if (Object.hasOwn(result, 'error')) assert.equal(typeof result.error, 'string', 'Invalid migration error')
  else {
    assert.equal(typeof result.value, 'string', 'Missing migrated Carve source')
    assert.ok(Array.isArray(result.report?.diagnostics), 'Missing migration diagnostics')
  }
  return result
}

export function runImportBatch(engine, entries) {
  assert.ok(engineNames.includes(engine), `Unknown importer engine: ${engine}`)
  const sources = entries.map(entry => typeof entry === 'string' ? { format: 'markdown', source: entry } : entry)
  for (const entry of sources) {
    assert.ok(importerFormats.includes(entry?.format), `Unknown importer format: ${entry?.format}`)
    assert.equal(typeof entry.source, 'string', 'Invalid importer source')
  }
  if (engine === 'php') {
    engineMetadata(engine)
    const results = JSON.parse(execFileSync(process.env.CARVE_PHP ?? 'php', [fileURLToPath(new URL('./php-migrate-driver.php', import.meta.url))], { input: JSON.stringify(entries), encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024 }))
    assert.ok(Array.isArray(results) && results.length === entries.length, 'Invalid PHP migration batch')
    return results.map(validateImport)
  }
  const importers = { markdown: migrateMarkdown, djot: migrateDjot, html: migrateHtml }
  const metadata = engineMetadata(engine)
  return sources.map(({ format, source }) => {
    if (engine === 'javascript') {
      let result
      try { result = importers[format](source) } catch (error) { result = { error: error.message } }
      return validateImport(result)
    }
    const native = spawnSync(metadata.binary, ['migrate', '--from', format, '--report', '-'], { input: source, encoding: 'utf8', timeout: 15000, maxBuffer: 64 * 1024 * 1024 })
    if (native.error) throw native.error
    assert.equal(native.signal, null, `Rust migration driver crashed: ${native.signal}`)
    return validateImport(native.status === 0 ? { value: native.stdout, report: JSON.parse(native.stderr) } : { error: native.stderr.trim() || `Rust migration exited ${native.status}` })
  })
}

export const runImporter = (engine, format, source) => runImportBatch(engine, [{ format, source }])[0]
