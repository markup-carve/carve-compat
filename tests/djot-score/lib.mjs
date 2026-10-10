// Shared plumbing for the Djot import scoring harness: case-set loading, the pinned
// reference renderer, and the HTML comparator carve-compat already uses elsewhere.
import { readFileSync } from 'node:fs'

export const root = new URL('../../', import.meta.url)
export const sets = ['djot-suite', 'gen', 'gen2', 'gen3', 'gen4', 'gen5']

export const readCases = set => JSON.parse(readFileSync(new URL(`./cases/${set}.json`, import.meta.url), 'utf8'))
export const readExpected = set => JSON.parse(readFileSync(new URL(`./expected/${set}.json`, import.meta.url), 'utf8'))
export const readRun = path => new Map(JSON.parse(readFileSync(path, 'utf8')).map(x => [x.id, x]))

export async function renderer () {
  const carve = await import(new URL('./node_modules/@markup-carve/carve/dist/index.js', root))
  const { compareHtml, applyDeclaration } = await import(new URL('./scripts/compat/commonmark-spec.mjs', root))
  const { reportClass } = await import(new URL('./scripts/compat/importer-report.mjs', root))
  const declared = JSON.parse(readFileSync(new URL('./tests/djot-tests/declared.json', root), 'utf8')).differences
  const byExample = new Map(declared.flatMap(d => d.examples.map(e => [e, d])))
  const status = (c, out) => {
    if (typeof out !== 'string') return 'missing'
    try {
      const html = carve.renderHtml(carve.resolve(carve.parse(out)))
      return applyDeclaration(compareHtml(c.expectedHtml, html, { expectedGenerated: true }), byExample.get(c.id)).status
    } catch { return 'failed' }
  }
  return { status, reportClass }
}
