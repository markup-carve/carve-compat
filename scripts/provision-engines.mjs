import { execFileSync } from 'node:child_process'
import { readFileSync, mkdirSync, existsSync, copyFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
const config = JSON.parse(readFileSync('resources/engines.json'))
const run = (command, args, cwd = process.cwd()) => execFileSync(command, args, { cwd, stdio:'inherit', timeout:600000 })
mkdirSync('.cache/engines', { recursive:true })
for (const engine of ['php','rust']) {
  const root = resolve(`.cache/engines/${engine}`), pin = config[engine]
  if (!existsSync(root)) run('git', ['clone','--no-checkout',pin.repository,root])
  const status = execFileSync('git', ['status','--porcelain','--untracked-files=no','--ignore-submodules=all'], { cwd:root, encoding:'utf8' })
  if (status.trim()) throw new Error(`Refusing to overwrite modified ${engine} engine sources`)
  run('git', ['fetch','--depth=1','origin',pin.revision], root)
  run('git', ['checkout','--detach',pin.revision], root)
  if (engine === 'rust') {
    const target = resolve('.cache/cargo-target')
    execFileSync('cargo', ['build','--release','--locked','--bin','carve'], { cwd:root, stdio:'inherit', timeout:600000, env:{...process.env,CARGO_TARGET_DIR:target} })
    mkdirSync(`${root}/bin`, {recursive:true}); copyFileSync(`${target}/release/carve`, `${root}/bin/carve`)
    writeFileSync(`${root}/bin/build.json`, JSON.stringify({ revision:pin.revision, binarySha256:createHash('sha256').update(readFileSync(`${root}/bin/carve`)).digest('hex') })+'\n')
  }
}
