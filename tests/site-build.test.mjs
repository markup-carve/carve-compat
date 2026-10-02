import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

test('the site refuses stale-format reports and inconsistent result counts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'carve-compat-site-'))
  try {
    const path = join(dir, 'report.json')
    for (const report of [
      { schemaVersion:1, rows:[], passed:0, failed:0 },
      { schemaVersion:1, generatedAt:'2026-01-01T00:00:00Z', engine:{}, schema:{}, rows:[], passed:1, failed:0 },
    ]) {
      writeFileSync(path, JSON.stringify(report))
      const result = spawnSync(process.execPath, ['scripts/build-site.mjs', path], { encoding:'utf8' })
      assert.equal(result.status, 1)
    }
  } finally { rmSync(dir, { recursive:true, force:true }) }
})
