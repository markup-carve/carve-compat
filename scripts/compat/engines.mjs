import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { fromAstJson, toAstJson, parse, renderCarve, renderHtml, resolve } from '@markup-carve/carve'
export const engineNames = ['javascript','php','rust']
const pins = JSON.parse(readFileSync(new URL('../../resources/engines.json',import.meta.url)))
const native = (command,args,input,cwd) => execFileSync(command,args,{input,encoding:'utf8',timeout:15000,maxBuffer:8*1024*1024,cwd})
const metadataCache = new Map()
export function engineMetadata(engine) {
  if (metadataCache.has(engine)) return metadataCache.get(engine)
  let meta
  if (engine === 'javascript') {
    const pkg = JSON.parse(readFileSync(new URL('../../node_modules/@markup-carve/carve/package.json',import.meta.url)))
    const dependency = JSON.parse(readFileSync(new URL('../../package.json',import.meta.url))).devDependencies['@markup-carve/carve']
    meta = { name:'Carve JavaScript', version:pkg.version, revision:dependency.split('#')[1], dependency }
  } else {
    const root = process.env[engine === 'php' ? 'CARVE_PHP_ROOT' : 'CARVE_RUST_ROOT'] ?? fileURLToPath(new URL(`../../.cache/engines/${engine}`,import.meta.url))
    const revision = native('git',['rev-parse','HEAD'],'',root).trim()
    if (native('git',['status','--porcelain','--untracked-files=no','--ignore-submodules=all'],'',root).trim()) throw new Error(`${engine} source has modified tracked files`)
    if (revision !== pins[engine].revision) throw new Error(`${engine} source revision differs from resources/engines.json`)
    if (engine === 'rust') {
      const binary = process.env.CARVE_RUST_BINARY ?? `${root}/bin/carve`, build = JSON.parse(readFileSync(`${root}/bin/build.json`))
      const sha = createHash('sha256').update(readFileSync(binary)).digest('hex')
      if (build.revision !== revision || build.binarySha256 !== sha) throw new Error('Rust binary does not match its pinned build manifest')
      meta = { name:'Carve Rust', revision, repository:pins.rust.repository, version:readFileSync(`${root}/Cargo.toml`,'utf8').match(/^version\s*=\s*"([^"]+)"/m)[1], binarySha256:sha, root, binary }
    } else meta = { name:'Carve PHP', revision, repository:pins.php.repository, version:`revision ${revision.slice(0,12)}`,runtime:native(process.env.CARVE_PHP ?? 'php',['--version'],'').split('\n')[0], root }
  }
  metadataCache.set(engine,meta); return meta
}
export function runEngine(engine, ast, source) {
  const metadata = engineMetadata(engine)
  if (engine === 'javascript') { const decoded = fromAstJson(ast), canonical = renderCarve(decoded); return { decodedAst:toAstJson(decoded), canonical, reparsedAst:toAstJson(parse(canonical)), parsedAst:toAstJson(parse(source)), html:renderHtml(resolve(decoded)) } }
  if (engine === 'php') return JSON.parse(native(process.env.CARVE_PHP ?? 'php',[fileURLToPath(new URL('./php-driver.php',import.meta.url))],JSON.stringify({ast,carve:source})))
  const run = (args,input) => native(metadata.binary,args,input)
  const json = JSON.stringify(ast), canonical = run(['--from-json','--carve'],json)
  return { decodedAst:JSON.parse(run(['--from-json','--json'],json)), canonical, reparsedAst:JSON.parse(run(['--json'],canonical)), parsedAst:JSON.parse(run(['--json'],source)), html:run(['--from-json','--html'],json) }
}
export function engineProjection(ast, expected, diagnostics, path = '') {
  if (Array.isArray(ast)) return ast.map((value,i) => engineProjection(value,expected?.[i],diagnostics,`${path}/${i}`))
  if (!ast || typeof ast !== 'object') return ast
  const out = {}
  for (const [key,value] of Object.entries(ast)) {
    if (['n','number'].includes(key) && ['footnote','footnote_ref'].includes(ast.type) && expected?.[key] === undefined) { diagnostics.push({path:`${path}/${key}`,code:'generated-engine-field',fidelity:'normalized',message:'Omitted a computed footnote number absent from the reference AST.'}); continue }
    if (key === 'attrs' && ast.type === 'heading' && value.id && !expected?.attrs?.id) {
      const attrs = {...value};delete attrs.id
      diagnostics.push({path:`${path}/attrs/id`,code:'generated-engine-field',fidelity:'normalized',message:'Omitted a generated heading identifier absent from the reference AST.'})
      if (Object.keys(attrs).length) out.attrs = attrs
      continue
    }
    out[key] = engineProjection(value,expected?.[key],diagnostics,`${path}/${key}`)
  }
  return out
}
const resultCache = new Map()
export function cachedEngine(engine, ast, source) {
  const key = JSON.stringify([engine,ast,source])
  if (!resultCache.has(key)) resultCache.set(key,runEngine(engine,ast,source))
  return structuredClone(resultCache.get(key))
}
