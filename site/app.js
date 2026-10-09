const $ = selector => document.querySelector(selector)
const node = (tag, text, className) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el }
const append = (parent, ...children) => { parent.append(...children); return parent }
const fetchJson = async path => { const response = await fetch(path, {cache:'no-store'}); if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`); return response.json() }
let report, tools, activeButton
const checkLabels = { 'reference-source-read':'Read reference source', 'native-source-read':'Reference reads engine source', 'independent-docbook':'Separate DocBook output', 'foreign-ast-roundtrip':'Foreign AST interchange', 'source-conversion-changes':'Declared source conversion changes', 'source-conversion-diagnostics':'Reference source conversion diagnostics', 'ast-schema': 'AST schema', 'ast-mapping': 'Semantic structure', 'html-structure': 'HTML structure', 'carve-source-roundtrip': 'Carve source round trip', 'json-roundtrip': 'JSON interchange', 'foreign-source-roundtrip': 'Foreign source round trip', 'built-in-importer-rendering': 'Public importer', 'loss-diagnostic': 'Exact loss diagnostic', 'fallback-schema': 'Fallback schema', 'fallback-content': 'Readable fallback' }
function ring(passed, total) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 48 48'); svg.classList.add('ring'); svg.setAttribute('aria-hidden', 'true')
  for (const [stroke, dash] of [['#e4e8e4', null], [total && passed === total ? '#46816f' : total ? '#b94861' : '#aab2af', 113.1 * (total ? passed / total : 0)]]) {
    const circle = document.createElementNS(svg.namespaceURI, 'circle')
    for (const [key, value] of Object.entries({ cx:24, cy:24, r:18, fill:'none', stroke, 'stroke-width':4, transform:'rotate(-90 24 24)' })) circle.setAttribute(key, value)
    if (dash !== null) circle.setAttribute('stroke-dasharray', `${dash} 113.1`)
    svg.append(circle)
  }
  return svg
}
function fillOverview(manifest) {
  const supported = report.rows.filter(r => r.kind === 'supported'), losses = report.rows.filter(r => r.kind === 'loss')
  $('#stat-tools').textContent = report.selected.length; $('#stat-positive').textContent = supported.length; $('#stat-loss').textContent = losses.length; $('#stat-failed').textContent = report.failed
  const status = $('#run-status'); status.textContent = `${report.passed} passed · ${report.failed} failed${report.notMeasured.length ? ` · ${report.notMeasured.length} unmeasured targets` : ''}`
  status.classList.add(report.failed ? 'status-bad' : 'status-good')
  const time = $('#measured-at'); time.dateTime = report.generatedAt; time.textContent = new Date(report.generatedAt).toLocaleString('en-GB', { timeZone:'UTC', dateStyle:'medium', timeStyle:'short' }) + ' UTC'
  if (Date.now() - new Date(report.generatedAt).getTime() > 48 * 3600000) status.textContent += ' · report older than 48 hours'
  const engine = $('#engine-version'); engine.textContent = `Carve ${report.engine.version}`
  const pin = report.engine.dependency.split('#')[1]; if (/^[a-f0-9]{40}$/.test(pin)) engine.href = `https://github.com/markup-carve/carve-js/commit/${pin}`
  if (manifest.runUrl) $('#run-link').href = manifest.runUrl
  for(const id of report.selectedEngines??['javascript']){const meta=report.engines?.[id]??report.engine;const rows=report.rows.filter(r=>(r.engine??'javascript')===id);const card=node('article',undefined,'engine-card');card.append(node('h3',meta.name??id),ring(rows.filter(r=>r.status==='passed').length,rows.length),node('p',`${rows.filter(r=>r.status==='passed').length} / ${rows.length} comparisons passed`),node('p',meta.version??meta.error??'Version unavailable','version'),...(meta.runtime?[node('p',meta.runtime,'version')]:[]) );$('#engine-cards').append(card);const option=node('option',meta.name??id);option.value=id;$('#engine-filter').append(option)}
  const pairs = [['Suite revision', report.suiteRevision], ['Reference engine pin', report.engine.dependency], ['Schema revision', report.schema.revision], ['Engine config SHA-256',report.engineConfigSha256??'Unavailable'], ['Importer assessment SHA-256',report.importerAssessmentSha256??'Unavailable'], ['Schema SHA-256', report.schema.sha256], ['cases.json SHA-256', report.fixtureHashes['cases.json']], ['losses.json SHA-256', report.fixtureHashes['losses.json']], ['Comparison duration', `${(report.durationMs / 1000).toFixed(1)} seconds`], ['Unmeasured targets', report.notMeasured.join(', ') || 'None']]
  for(const [id,meta]of Object.entries(report.engines??{}))pairs.push([`${id} revision`,meta.revision??meta.error??'Unavailable'])
  for (const [key, value] of pairs) append($('#provenance'), node('dt', key), node('dd', value))
  for (const tool of tools) {
    const rows = report.rows.filter(r => r.tool === tool.id), passed = rows.filter(r => r.status === 'passed').length
    const card = node('article', undefined, 'tool-card'), top = node('div', undefined, 'tool-top'), h = node('h3'), link = node('a', tool.name)
    link.href = tool.url; append(top, append(h, link), ring(passed, rows.length)); card.append(top, node('p', tool.format, 'format'), node('span', rows.length ? `${passed} / ${rows.length} engine comparisons passed` : 'Not measured', 'count'))
    card.append(node('p', `${rows.filter(r => r.kind === 'supported').length} supported · ${rows.filter(r => r.kind === 'loss').length} loss comparisons`), node('p', tool.description))
    const versions = [...new Set(rows.map(r => r.version).filter(Boolean))]; card.append(node('p', versions.length ? versions.join(' · ') : 'Version unavailable', 'version'))
    const button = node('button', 'Inspect cases →'); button.type = 'button'; button.disabled = !rows.length; button.addEventListener('click', () => { closeDetail(); $('#tool-filter').value = tool.id; renderMatrix(); $('#explorer').scrollIntoView(); $('#tool-filter').focus() }); card.append(button); $('#tool-cards').append(card)
    const option = node('option', tool.name); option.value = tool.id; $('#tool-filter').append(option)
  }
}
function closeDetail() {
  $('#detail').hidden = true
  if (activeButton?.isConnected) { activeButton.setAttribute('aria-pressed', 'false'); activeButton.focus({preventScroll:true}) }
  activeButton = null
  const url = new URL(location.href); for (const key of ['case', 'tool', 'kind', 'engine']) url.searchParams.delete(key); history.replaceState(null, '', url)
}
function pane(title, value, open = false) {
  const el = node('details'); el.open = open; append(el, node('summary', title), append(node('pre'), node('code', typeof value === 'string' ? value : JSON.stringify(value, null, 2)))); return el
}
function showDetail(row, button, scroll = true) {
  activeButton?.setAttribute('aria-pressed', 'false'); activeButton = button; button?.setAttribute('aria-pressed', 'true')
  const tool = tools.find(t => t.id === row.tool); $('#detail-meta').textContent = `${row.engine??'javascript'} / ${tool.name} / ${row.kind === 'loss' ? 'EXPECTED LOSS' : 'SUPPORTED SUBSET'} / ${row.status.toUpperCase()}`
  const title = $('#detail-title'); title.textContent = row.case; title.tabIndex = -1
  $('#detail-summary').textContent = row.error ?? (row.kind === 'loss' ? (row.engine && row.engine!=='javascript'?'The JavaScript adapter verified this expected loss. This engine checked the resulting fallback AST through the checks listed below.':'This case passed because the expected limitation was reported at its declared path and readable fallback content survived.') : 'This fixture preserved the declared semantic fields through every listed check. Normalization diagnostics remain visible below.')
  $('#detail-checks').textContent = (row.checks ?? []).map(c => `✓ ${checkLabels[c] ?? c}`).join('  ·  ')
  const panes = $('#detail-panes'); panes.replaceChildren(); const e = row.evidence ?? {}
  if (e.source !== undefined) panes.append(pane(`Input source · ${e.sourceFormat}`, e.source, true))
  if (row.importer) panes.append(pane('Importer report', `Report class: ${row.importer.reportClass}\nHonesty: ${row.importer.honesty}\nDiagnostic codes: ${row.importer.codes.join(', ') || 'None'}`, true))
  if(e.scope && row.status==='passed')$('#detail-summary').textContent=`This fixture preserved its authored AST fields through the listed interchange checks. Scope: ${e.scope}. Each engine checks source changes against declared before/after values; this does not claim a lossless source round trip. Conversion-diagnostic checks use the JavaScript reference.`
  if(e.sourceChanges)panes.append(pane('Engine source before/after changes',e.sourceChanges))
  if(e.expectedAst)panes.append(pane('Authored AST expectation',e.expectedAst))
  if(e.carveConversion)panes.append(pane('Reference Carve source conversion and diagnostics',e.carveConversion))
  if (e.carve !== undefined) panes.append(pane('Authored Carve expectation', e.carve, true))
  if (e.ast) panes.append(pane('Mapped Carve AST', e.ast, !e.carve))
  if(e.engineAst)panes.append(pane('Engine decoded AST',e.engineAst))
  if(e.engineCarve!==undefined)panes.append(pane('Engine canonical Carve',e.engineCarve))
  if(e.independentAst)panes.append(pane('Separate DocBook AST',e.independentAst))
  if(e.independentSource!==undefined)panes.append(pane('Separate DocBook source',e.independentSource))
  if (e.exportedSource !== undefined) panes.append(pane('Exported foreign source', e.exportedSource))
  if (e.foreignHtml !== undefined) panes.append(pane('Foreign rendered HTML · source only', e.foreignHtml))
  if (e.expected) panes.append(pane('Required loss diagnostic', { ...e.expected, retainedContent: e.retained }, true))
  if (row.errorDetails && (row.errorDetails.actual !== undefined || row.errorDetails.expected !== undefined)) panes.append(pane('Failure comparison · actual and expected', row.errorDetails, true))
  const diagnostics = node('details'); diagnostics.open = row.kind === 'loss'; const unique = new Map()
  for (const d of row.diagnostics ?? []) { const key = JSON.stringify([d.path, d.code, d.fidelity, d.message]); const current = unique.get(key); if (current) current.count++; else unique.set(key, { ...d, count:1 }) }
  diagnostics.append(node('summary', `Diagnostics · ${unique.size} distinct`))
  const list = node('ul', undefined, 'diag-list')
  for (const d of unique.values()) { const item = node('li'); append(item, node('span', d.fidelity, `badge ${d.fidelity}`), node('code', d.code), node('code', `Path: ${d.path || '(root)'}${d.count > 1 ? ` · ${d.count} occurrences across checks` : ''}`), node('p', d.message)); list.append(item) }
  if (!unique.size) list.append(node('li', row.status === 'failed' ? 'No diagnostics were captured before this failure.' : 'No adapter diagnostics.'))
  diagnostics.append(list); panes.append(diagnostics); $('#detail').hidden = false
  const url = new URL(location.href); url.searchParams.set('case', row.case); url.searchParams.set('tool', row.tool); url.searchParams.set('kind', row.kind); url.searchParams.set('engine',row.engine??'javascript'); url.hash = 'explorer'; history.replaceState(null, '', url)
  if (scroll) { $('#detail').scrollIntoView({ block:'start' }); title.focus({ preventScroll:true }) }
}
function renderMatrix() {
  $('#detail').hidden = true; activeButton = null
  const search = $('#search').value.toLowerCase().trim(), selectedTool = $('#tool-filter').value, kind = $('#kind-filter').value, status = $('#status-filter').value
  const rows = report.rows.filter(r => (r.engine??'javascript')===$('#engine-filter').value && (!search || `${r.case} ${r.error ?? ''} ${(r.diagnostics ?? []).map(d => `${d.code} ${d.message}`).join(' ')}`.toLowerCase().includes(search)) && (!selectedTool || r.tool === selectedTool) && (!kind || r.kind === kind) && (!status || r.status === status))
  const visibleTools = tools.filter(t => !selectedTool || t.id === selectedTool)
  const head = $('#matrix thead'); head.replaceChildren(); const tr = node('tr'); const first = node('th', 'Fixture'); first.scope = 'col'; tr.append(first)
  for (const tool of visibleTools) { const th = node('th', tool.name); th.scope = 'col'; tr.append(th) } head.append(tr)
  const grouped = new Map(); for (const row of rows) { const key = `${row.kind}/${row.case}`; if (!grouped.has(key)) grouped.set(key, []); grouped.get(key).push(row) }
  const body = $('#matrix tbody'); body.replaceChildren()
  for (const group of grouped.values()) {
    const tr = node('tr'), th = node('th', group[0].case); th.scope = 'row'; tr.append(th)
    for (const tool of visibleTools) {
      const td = node('td'), row = group.find(r => r.tool === tool.id)
      if (!row) { const empty = node('span', '—', 'cell-empty'); empty.setAttribute('aria-label', 'Outside this filtered coverage'); td.append(empty) }
      else {
        const type = row.status === 'failed' ? 'fail' : row.kind === 'loss' ? 'loss' : row.evidence?.scope ? 'interchange' : 'pass', button = node('button', type === 'fail' ? '×' : type === 'loss' ? 'L' : type === 'interchange' ? 'I' : '✓', type)
        button.type = 'button'; button.dataset.case = row.case; button.dataset.tool = row.tool; button.dataset.kind = row.kind; button.setAttribute('aria-pressed', 'false'); button.setAttribute('aria-label', `${tool.name}: ${row.case}, ${row.status}${row.kind === 'loss' ? ', expected loss' : row.evidence?.scope ? ', AST interchange with separate source conversion checks' : ''}. View evidence`); button.addEventListener('click', () => showDetail(row, button)); td.append(button)
      }
      tr.append(td)
    }
    body.append(tr)
  }
  $('#case-count').textContent = `${grouped.size} fixtures · ${rows.length} measured target/case pairs`; $('#empty-results').hidden = rows.length !== 0
}
function suiteTable(selector, caption, headers, rows) {
  const table = $(selector), head = node('tr'), body = node('tbody')
  for (const label of headers) { const th = node('th', label); th.scope = 'col'; head.append(th) }
  for (const values of rows) {
    const tr = node('tr'), th = node('th', values[0]); th.scope = 'row'; tr.append(th)
    for (const value of values.slice(1)) tr.append(node('td', value))
    body.append(tr)
  }
  table.replaceChildren(node('caption', caption), append(node('thead'), head), body)
}
function fillHtmlSuite(data, {id,kind,label,sourceKey,sourceLabel,sectionLabel}) {
  const select = suffix => $(`#${id}-${suffix}`)
  const exampleLink = row => id === 'commonmark' ? `https://spec.commonmark.org/0.31.2/#example-${row.example}` : row.link
  const setLink = (link, row) => { const url = exampleLink(row); if (typeof url === 'string' && URL.canParse(url) && new URL(url).protocol === 'https:') link.href = url }
  if (data.schemaVersion !== 1 || data.kind !== kind || !Array.isArray(data.rows) || !Array.isArray(data.sections) || !Array.isArray(data.selectedEngines)) throw new Error(`Unsupported ${label} report`)
  const engines = data.selectedEngines, name = engine => data.engines[engine]?.name ?? engine
  const outcomes = ['reported','unassessed','silent-loss','false-loss','ok']
  const baselines = Object.entries(data.baselines ?? {}), baselineName = 'pandoc to Djot (baseline)'
  suiteTable(`#${id}-totals`, `Totals by ${sourceLabel} importer`, ['Engine','Match','Mismatch','Declared','Not comparable','Failed','Names the loss','Only fidelity-unverified','Clean report = silent',...outcomes], engines.map(engine => {
    const t = data.totals[engine]
    return [name(engine),t.match,t.mismatch,t.declared,t.notComparable,t.failed,t.mismatchByReport['names-loss'],t.mismatchByReport['unverified-only'],t.mismatchByReport.clean,...outcomes.map(outcome => t.honesty?.[outcome] ?? 'Not measured')]
  }).concat(baselines.map(([,{totals:t}]) => [baselineName,t.match,t.mismatch,'n/a',t.notComparable,t.failed,...Array(3 + outcomes.length).fill('n/a')])))
  const declarations = select('declarations'); declarations.replaceChildren()
  for (const d of data.declarations ?? []) {
    const item = node('li'), link = node('a', 'Reference')
    if (typeof d.reference === 'string' && URL.canParse(d.reference) && new URL(d.reference).protocol === 'https:') link.href = d.reference
    item.append(node('span', `${d.reason} `), link, node('span', ` · ${engines.map(engine => `${name(engine)}: ${d.declared[engine]} declared examples`).join(' · ')}`))
    for (const kind of ['stale','insufficient']) for (const engine of engines) {
      if (d[kind][engine]?.length) item.append(node('span', ` · ${name(engine)} ${kind}: examples ${d[kind][engine].join(', ')}`))
    }
    declarations.append(item)
  }
  if (!declarations.children.length) declarations.append(node('li', 'No declared rendering differences.'))
  const baselineNote = select('baseline-note')
  if (baselineNote) baselineNote.hidden = baselines.length === 0
  const disagreements = select('disagreements'); disagreements.replaceChildren()
  for (const row of data.reportDisagreements ?? []) {
    const item = node('li'), link = node('a', `Example ${row.example}`)
    setLink(link, row)
    item.append(link, node('span', ` · ${row.section} · ${engines.map(engine => `${name(engine)}: ${row.classes[engine]} (codes: ${row.codes[engine].join(', ') || 'None'})`).join(' · ')}`))
    disagreements.append(item)
  }
  if (!disagreements.children.length) disagreements.append(node('li', 'No report class disagreements among the selected engines.'))
  select('silent').textContent = `Silent losses with clean reports: ${engines.map(engine => `${name(engine)} ${data.totals[engine].mismatchByReport.clean}`).join(' · ')}`
  suiteTable(`#${id}-sections`, `Matches / comparable examples by ${sectionLabel}`, [id === 'djot' ? 'File' : 'Section',...engines.map(name),...baselines.map(() => baselineName)], data.sections.map(s => [s.section,...engines.map(engine => { const t = s.results[engine]; return `${t.match}/${t.match + t.mismatch + t.declared}` }),...baselines.map(([baseline]) => { const t = s.baselines[baseline]; return `${t.match}/${t.match + t.mismatch}` })]))
  const filter = select('engine-filter')
  for (const engine of engines) { const option = node('option', name(engine)); option.value = engine; filter.append(option) }
  const renderExamples = () => {
    const list = select('examples'); list.replaceChildren()
    const rows = data.rows.filter(r => ['mismatch','failed'].includes(r.status) && (!filter.value || r.engine === filter.value))
    select('count').textContent = `${rows.length} mismatching or failed examples`
    for (const row of rows) {
      const item = node('li'), details = node('details'), summary = node('summary', `${name(row.engine)} · Example ${row.example} · ${row.section} · ${row.status}`), link = node('a', `${label} example ${row.example}`)
      setLink(link, row)
      const panes = node('div', undefined, 'detail-panes')
      panes.append(pane(sourceLabel, row[sourceKey], true), pane('Expected HTML', row.expectedHtml, true), pane('Carve output', row.carve, true), pane('Rendered HTML', row.carveHtml, true))
      details.append(summary, link)
      if (row.error) details.append(node('p', row.error))
      details.append(node('p', `Report class: ${row.reportClass}. Diagnostic codes: ${(row.diagnostics ?? []).map(d => d.code).join(', ') || 'None'}`), panes)
      item.append(details); list.append(item)
    }
  }
  filter.addEventListener('change', renderExamples); renderExamples()
  select('note').hidden = true; select('results').hidden = false
}
async function loadHtmlSuite(config) {
  const note = $(`#${config.id}-note`)
  try {
    const response = await fetch(`${config.id}.json`, {cache:'no-store'})
    if (response.status === 404) { note.textContent = 'Not measured in this report.'; return }
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    fillHtmlSuite(await response.json(), config)
  } catch (error) { note.textContent = `${config.label} report could not be loaded: ${error.message}` }
}
void loadHtmlSuite({id:'commonmark',kind:'commonmark-spec',label:'CommonMark',sourceKey:'markdown',sourceLabel:'Markdown',sectionLabel:'spec section'})
void loadHtmlSuite({id:'djot',kind:'djot-tests',label:'Djot',sourceKey:'source',sourceLabel:'Djot',sectionLabel:'file'})
try {
  const [data, manifest] = await Promise.all([fetchJson('report.json'), fetchJson('manifest.json')])
  if (data.schemaVersion !== 1 || !Array.isArray(data.rows) || !data.generatedAt) throw new Error('Unsupported or incomplete report')
  if (!Array.isArray(manifest.tools) || !manifest.tools.length) throw new Error('Unsupported or incomplete manifest')
  report = data; tools = manifest.tools; fillOverview(manifest)
  const query = new URL(location.href).searchParams
  for (const selector of ['#search', '#tool-filter', '#kind-filter', '#status-filter', '#engine-filter']) $(selector).addEventListener(selector === '#search' ? 'input' : 'change', () => { closeDetail(); renderMatrix() })
  $('#reset').addEventListener('click', () => { closeDetail(); for (const selector of ['#search', '#tool-filter', '#kind-filter', '#status-filter']) $(selector).value = ''; $('#engine-filter').value='javascript'; renderMatrix() })
  $('#close-detail').addEventListener('click', closeDetail); document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#detail').hidden) closeDetail() })
  if(query.get('engine') && [...$('#engine-filter').options].some(o=>o.value===query.get('engine')))$('#engine-filter').value=query.get('engine')
  renderMatrix()
  const initial = report.rows.find(r => r.case === query.get('case') && r.tool === query.get('tool') && r.kind === query.get('kind') && (r.engine??'javascript')===$('#engine-filter').value)
  if (initial) showDetail(initial, [...$('#matrix tbody').querySelectorAll('button')].find(b => b.dataset.case === initial.case && b.dataset.tool === initial.tool && b.dataset.kind === initial.kind))
} catch (error) {
  $('#run-status').textContent = 'Report unavailable'; $('#load-error').hidden = false; $('#load-error').textContent = `The measured report could not be loaded: ${error.message}. Use the GitHub run artifacts to inspect the evidence.`
}
