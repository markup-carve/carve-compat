import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { reportClass, honesty, validateAssessment, runImportBatch, runImporter } from '../scripts/compat/importer-report.mjs'
import { importerDecision, checkCase, corpus } from '../scripts/compat/check.mjs'

test('report classes distinguish named loss from unverified and normalization', () => {
  assert.equal(reportClass([]), 'clean')
  assert.equal(reportClass([{ code:'spelling', fidelity:'normalized' }]), 'clean')
  assert.equal(reportClass([{ code:'fidelity-unverified', fidelity:'preserved' }]), 'unverified-only')
  for (const fidelity of ['degraded','dropped']) {
    assert.equal(reportClass([{ code:'fidelity-unverified', fidelity }]), 'unverified-only')
    assert.equal(reportClass([{ code:'fidelity-unverified', fidelity }, { code:'structure-unspellable', fidelity }]), 'names-loss')
  }
})

test('honesty accounts for all structure and report class combinations', () => {
  for (const [kept, cls, outcome] of [
    [false,'names-loss','reported'], [false,'unverified-only','unassessed'], [false,'clean','silent-loss'],
    [true,'names-loss','false-loss'], [true,'unverified-only','ok'], [true,'clean','ok'],
  ]) assert.equal(honesty(kept, cls), outcome)
})

test('assessment requires known engines, known formats, and no duplicates', () => {
  const valid = () => ({ schemaVersion:1, assessed:{ javascript:[], php:[], rust:[] } })
  assert.deepEqual(validateAssessment(), valid())
  assert.deepEqual(validateAssessment(valid()), valid())
  for (const [mutate, message] of [
    [c => { c.assessed.python = [] }, /Unknown assessment engine/],
    [c => { c.assessed.php = ['rst'] }, /Unknown assessment format/],
    [c => { c.assessed.rust = ['djot','djot'] }, /Duplicate assessment format/],
    [c => { delete c.assessed.php }, /Missing assessment formats/],
    [c => { c.schemaVersion = 2 }, /schemaVersion/],
    [c => { c.assessed = [] }, /engine map/],
    [c => { c.unexpected = true }, /fields/],
  ]) { const config = valid(); mutate(config); assert.throws(() => validateAssessment(config), message) }
  const declared = valid(); declared.assessed.php = ['markdown','djot','html']
  assert.deepEqual(validateAssessment(declared), declared)
})

test('honesty gates fail false and silent losses and only declared unassessed formats', () => {
  const config = validateAssessment()
  const decide = (engine, format, outcome) => importerDecision(engine, 'mdast', 'fixture', format, { honesty:outcome, codes:['diagnostic'] }, config)
  for (const engine of ['javascript','php','rust']) {
    for (const format of ['markdown','djot','html']) {
      for (const outcome of ['silent-loss','false-loss']) {
        const result = decide(engine, format, outcome)
        assert.equal(result.status, 'failed')
        assert.equal(result.error, `${engine}/mdast/fixture: importer ${outcome} (codes: diagnostic)`)
      }
      for (const outcome of ['reported','ok','unassessed']) assert.equal(decide(engine, format, outcome).status, 'passed')
      config.assessed[engine].push(format)
      assert.equal(decide(engine, format, 'unassessed').status, 'failed')
      assert.match(decide(engine, format, 'unassessed').error, /unassessed importer/)
    }
  }
})

test('supported fixture failures retain the importer record and strict comparison', async () => {
  const fixture = corpus.cases.find(c => c.id === 'inline-structure')
  const runner = diagnostics => () => ({ value:fixture.carve, report:{diagnostics} })
  await assert.rejects(checkCase('mdast', fixture, { runner:runner([{code:'invented-loss',fidelity:'dropped'}]) }), error => {
    assert.match(error.message, /javascript\/mdast\/inline-structure: importer false-loss.*invented-loss/)
    assert.deepEqual(error.compatibilityEvidence.importer, { reportClass:'names-loss', honesty:'false-loss', codes:['invented-loss'] })
    return true
  })
  await assert.rejects(checkCase('mdast', fixture, { runner:() => ({ value:'Lost structure.', report:{diagnostics:[]} }) }), error => {
    assert.match(error.message, /importer silent-loss/)
    assert.equal(error.compatibilityEvidence.importer.honesty, 'silent-loss')
    return true
  })
  await assert.rejects(checkCase('mdast', fixture, { runner:() => ({ value:'Lost structure.', report:{diagnostics:[{code:'fidelity-unverified',fidelity:'degraded'}]} }) }), error => {
    assert.match(error.message, /built-in importer rendering/)
    assert.equal(error.compatibilityEvidence.importer.honesty, 'unassessed')
    return true
  })
})

test('JavaScript migrates all importer formats with fidelity reports', () => {
  for (const format of ['markdown','djot','html']) {
    const result = runImporter('javascript', format, format === 'html' ? '<p>One</p>' : 'One\n')
    assert.equal(typeof result.value, 'string')
    assert.ok(Array.isArray(result.report.diagnostics))
  }
})

test('PHP migration batch accepts legacy strings and format entries', t => {
  if (!existsSync('.cache/engines/php')) { t.skip('PHP engine absent at .cache/engines/php'); return }
  const results = runImportBatch('php', ['**Markdown**\n', {format:'djot',source:'*Djot*\n'}, {format:'html',source:'<p>HTML</p>'}, '**Fresh**\n'])
  assert.equal(results.length, 4)
  for (const result of results) {
    assert.equal(typeof result.value, 'string', result.error)
    assert.ok(Array.isArray(result.report.diagnostics))
  }
  assert.match(results[0].value, /Markdown/)
  assert.match(results[1].value, /Djot/)
  assert.match(results[2].value, /HTML/)
  assert.ok(!results[3].value.includes('Markdown'))
})
