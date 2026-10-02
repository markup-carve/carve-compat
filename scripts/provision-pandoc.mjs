import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
const { pandoc } = JSON.parse(readFileSync('resources/engines.json'))
if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('The pinned Pandoc provisioner requires Linux x64; set CARVE_PANDOC to a matching local installation on other platforms.')
const response = await fetch(pandoc.archive)
if (!response.ok) throw new Error(`Pandoc download: HTTP ${response.status}`)
const bytes = Buffer.from(await response.arrayBuffer())
if (createHash('sha256').update(bytes).digest('hex') !== pandoc.sha256) throw new Error('Pandoc archive checksum mismatch')
mkdirSync('.cache/pandoc', {recursive:true})
writeFileSync('.cache/pandoc/archive.tar.gz',bytes)
execFileSync('tar',['-xzf','.cache/pandoc/archive.tar.gz','--strip-components=1','-C','.cache/pandoc'])
const version = execFileSync('.cache/pandoc/bin/pandoc',['--version'],{encoding:'utf8'}).split('\n')[0]
if (version !== `pandoc ${pandoc.version}`) throw new Error('Extracted Pandoc version differs from its pin')
console.log(version)
