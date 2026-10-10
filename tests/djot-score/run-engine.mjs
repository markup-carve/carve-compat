// Usage: node run-engine.mjs <js|php|rust> <worktree-or-binary> <set> <out.json>
// Imports every case of one set with the given engine checkout and writes [{id, carve, diagnostics}].
import { writeFileSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { readCases, root } from './lib.mjs'

const [engine, engineRoot, set, out] = process.argv.slice(2)
const cases = readCases(set)
let results
if (engine === 'js') {
  const c = await import(pathToFileURL(resolve(engineRoot, 'dist/index.js')).href)
  results = cases.map(x => {
    try { const r = c.migrateDjot(x.djot); return { id: x.id, carve: r.value, diagnostics: r.report.diagnostics } } catch (e) { return { id: x.id, error: e.message } }
  })
} else if (engine === 'php') {
  const driver = fileURLToPath(new URL('./scripts/compat/php-migrate-driver.php', root))
  const batch = JSON.parse(execFileSync('php', [driver], {
    input: JSON.stringify(cases.map(x => ({ format: 'djot', source: x.djot }))),
    env: { ...process.env, CARVE_PHP_ROOT: engineRoot }, encoding: 'utf8', maxBuffer: 1 << 26,
  }))
  results = cases.map((x, i) => batch[i].error ? { id: x.id, error: batch[i].error } : { id: x.id, carve: batch[i].value, diagnostics: batch[i].report.diagnostics })
} else {
  results = cases.map(x => {
    const r = spawnSync(engineRoot, ['migrate', '--from', 'djot', '--report', '-'], { input: x.djot, encoding: 'utf8' })
    return r.status === 0 ? { id: x.id, carve: r.stdout, diagnostics: JSON.parse(r.stderr).diagnostics } : { id: x.id, error: r.stderr }
  })
}
writeFileSync(out, JSON.stringify(results))
console.log(`${engine} ${set}: ${results.length} rows, ${results.filter(r => r.error).length} errors`)
