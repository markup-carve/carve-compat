import { context, document, text, coalesce, plain } from './trees.mjs'
const emptyAttr = () => ['', [], []]
const readable = n => typeof n === 'string' ? n : Array.isArray(n) ? n.map(readable).join('') : n?.t === 'Str' ? n.c : n?.t === 'Space' || n?.t === 'SoftBreak' ? ' ' : readable(n?.c ?? '')
function attrs(attr) {
  const [id, classes, values] = attr ?? emptyAttr(), out = {}
  if (id) out.id = id
  if (classes.length) out.classes = classes
  if (values.length) out.keyValues = Object.fromEntries(values)
  return Object.keys(out).length ? out : undefined
}
const foreignAttr = a => [a?.id ?? '', a?.classes ?? [], Object.entries(a?.keyValues ?? {})]
export function fromPandoc(root, ctx = context('pandoc')) {
  if (!Array.isArray(root.blocks) || !Array.isArray(root['pandoc-api-version'])) throw new Error('Invalid Pandoc JSON document')
  const notes = []
  const map = (n, path) => {
    const c = n.c, children = (nodes, suffix = '/c') => coalesce(nodes.flatMap((child, i) => map(child, `${path}${suffix}/${i}`)))
    let out, a
    if (n.t === 'Str') return text(c)
    if (n.t === 'Space' || n.t === 'SoftBreak') return text(' ')
    if (n.t === 'LineBreak' || n.t === 'HorizontalRule') return { type: n.t === 'LineBreak' ? 'hard_break' : 'thematic_break' }
    const inline = { Emph:'emphasis', Strong:'strong', Strikeout:'strike', Underline:'underline', Superscript:'superscript', Subscript:'subscript' }
    if (inline[n.t]) out = { type:inline[n.t], children:children(c) }
    else if (n.t === 'Para' || n.t === 'Plain') out = { type:'paragraph', children:children(c) }
    else if (n.t === 'Header') { a = attrs(c[1]); out = { type:'heading', level:c[0], children:children(c[2], '/c/2') } }
    else if (n.t === 'Span') { a = attrs(c[0]); out = { type:'span', children:children(c[1], '/c/1') } }
    else if (n.t === 'Code') { a = attrs(c[0]); out = { type:'code', value:c[1] } }
    else if (n.t === 'CodeBlock') { a = attrs([c[0][0], c[0][1].slice(1), c[0][2]]); out = { type:'code_block', content:c[1] + '\n', ...(c[0][1][0] ? { lang:c[0][1][0] } : {}) } }
    else if (n.t === 'Link' || n.t === 'Image') { a = attrs(c[0]); out = { type:n.t === 'Link' ? 'link' : 'image', ...(n.t === 'Link' ? { href:c[2][0], children:children(c[1], '/c/1') } : { src:c[2][0], alt:readable(c[1]) }), ...(c[2][1] ? { title:c[2][1] } : {}) } }
    else if (n.t === 'BlockQuote') out = { type:'block_quote', children:children(c) }
    else if (n.t === 'BulletList' || n.t === 'OrderedList') {
      const ordered = n.t === 'OrderedList', items = ordered ? c[1] : c, base = ordered ? '/c/1' : '/c'
      if (ordered && !['Decimal', 'DefaultStyle'].includes(c[0][1].t)) ctx.note(`${path}/c/0/1`, 'unsupported-field', 'dropped', 'Pandoc lettered and roman numbering styles are outside this subset.')
      out = { type:'list', ordered, tight:items.every(item => item[0]?.t === 'Plain'), items:items.map((item, i) => {
        const mapped = children(item, `${base}/${i}`)
        if (/^[☐☒] /.test(plain(mapped[0] ?? {}))) {
          ctx.note(`${path}${base}/${i}/0/c/0`, 'unsupported-field', 'dropped', 'Pandoc stores task state as a checkbox glyph; this adapter retains the item text without the flag.')
          if (mapped[0]?.children[0]?.type === 'text') mapped[0].children[0].value = mapped[0].children[0].value.replace(/^[☐☒] /, '')
        }
        return { type:'list_item', children:mapped }
      }), ...(ordered && c[0][0] !== 1 ? { start:c[0][0] } : {}) }
    } else if (n.t === 'DefinitionList') out = { type:'definition_list', items:c.flatMap(([term, definitions], i) => [{ type:'definition_term', children:children(term, `/c/${i}/0`) }, ...definitions.map((blocks, j) => ({ type:'definition_description', children:children(blocks, `/c/${i}/1/${j}`) }))]) }
    else if (n.t === 'Note') {
      const label = String(notes.length + 1), note = { type:'footnote', label, children:[] }; notes.push(note); note.children = children(c)
      ctx.note(path, 'footnote-label-normalization', 'normalized', 'Pandoc publishes note bodies without source labels; assigned numeric document-order labels.')
      return { type:'footnote_ref', label }
    } else if (n.t === 'Table') {
      a = attrs(c[0])
      if (c[1][0] || c[1][1].length) ctx.note(`${path}/c/1`, 'unsupported-field', 'dropped', 'Pandoc table captions are outside this adapter subset.')
      c[2].forEach((col, i) => { if (col[0].t !== 'AlignDefault' || col[1].t !== 'ColWidthDefault') ctx.note(`${path}/c/2/${i}`, 'unsupported-field', 'dropped', 'Pandoc column alignment and width are outside this adapter subset.') })
      const row = (r, rp, header) => {
        if (attrs(r[0])) ctx.note(`${rp}/0`, 'unsupported-field', 'dropped', 'Pandoc table-row attributes are outside this subset.')
        return { type:'table_row', cells:r[1].map((cell, i) => {
          const cp = `${rp}/1/${i}`
          if (attrs(cell[0]) || cell[1].t !== 'AlignDefault' || cell[2] !== 1 || cell[3] !== 1) ctx.note(cp, 'unsupported-field', 'dropped', 'Pandoc cell attributes, alignment and spans are outside this subset.')
          const blocks = children(cell[4], `${cp.slice(path.length)}/4`)
          if (blocks.length && (blocks.some(b => b.type !== 'paragraph') || blocks.length !== 1)) ctx.note(`${cp}/4`, 'unsupported-field', 'degraded', 'Retained readable text for a block-containing table cell.')
          return { type:'table_cell', header, children:blocks.length === 0 ? [] : blocks.length === 1 && blocks[0].type === 'paragraph' ? blocks[0].children : [text(blocks.map(plain).join(' '))] }
        }) }
      }
      out = { type:'table', rows:[...c[3][1].map((r, i) => row(r, `${path}/c/3/1/${i}`, true)), ...c[4].flatMap((body, j) => [...body[2].map((r, i) => row(r, `${path}/c/4/${j}/2/${i}`, true)), ...body[3].map((r, i) => row(r, `${path}/c/4/${j}/3/${i}`, false))]), ...c[5][1].map((r, i) => row(r, `${path}/c/5/1/${i}`, false))] }
      for (const [bp, attr] of [[`${path}/c/3/0`, c[3][0]], ...c[4].map((b,i) => [`${path}/c/4/${i}/0`, b[0]]), [`${path}/c/5/0`, c[5][0]]]) if (attrs(attr)) ctx.note(bp, 'unsupported-field', 'dropped', 'Pandoc table-section attributes are outside this subset.')
      c[4].forEach((b,i) => { if (b[1]) ctx.note(`${path}/c/4/${i}/1`, 'unsupported-field', 'dropped', 'Pandoc row-header column counts are outside this subset.') })
    } else return ctx.unsupported({ type:n.t, value:readable(c) }, path, ['Div','RawBlock','Table'].includes(n.t))
    if (a) out.attrs = a
    return out
  }
  if (Object.keys(root.meta ?? {}).length) ctx.note('/meta', 'unsupported-field', 'dropped', 'Pandoc document metadata is outside the Carve document subset.')
  return document([...root.blocks.flatMap((n,i) => map(n, `/blocks/${i}`)), ...notes])
}
export function toPandoc(root, apiVersion, ctx = context('pandoc')) {
  const notes = new Map((root.children ?? []).flatMap((n,index)=>n.type==='footnote'?[[n.label,{node:n,index}]]:[]))
  const referenced=new Set()
  const activeNotes=new Set()
  const visit=n=>{if(n.type==='footnote_ref' && !referenced.has(n.label)){referenced.add(n.label);notes.get(n.label)?.node.children.forEach(visit)}for(const key of ['children','items','rows','cells'])n[key]?.forEach(visit)}
  root.children.filter(n=>n.type!=='footnote').forEach(visit)
  const map = (n, path, tight = false) => {
    const supported = ['type','children','items','rows','cells','value','level','ordered','tight','start','href','src','alt','title','content','lang','attrs','label','header','pos','srcByteLength','bulletChar','delim']
    for (const key of Object.keys(n)) if (!supported.includes(key)) ctx.note(`${path}/${key}`, 'unsupported-field', 'dropped', `${key} is outside the Pandoc export subset.`)
    if (n.attrs && !['heading','span','code','code_block','link','image','table'].includes(n.type)) ctx.note(`${path}/attrs`, 'unsupported-field', 'dropped', 'This Pandoc node has no attribute slot.')
    const nestedFields=(value,p,allowed)=>{for(const key of Object.keys(value))if(!['type','pos','srcByteLength',...allowed].includes(key))ctx.note(`${p}/${key}`,'unsupported-field','dropped',`${key} is outside the Pandoc nested-node export subset.`)}
    const children = () => (n.children ?? []).map((child,i) => map(child, `${path}/children/${i}`))
    const node = (t,c) => c === undefined ? {t} : {t,c}
    const a = foreignAttr(n.attrs)
    if (n.type === 'document') return { 'pandoc-api-version':apiVersion, meta:{}, blocks:(n.children ?? []).flatMap((child,i)=>{const p=`${path}/children/${i}`;if(child.type!=='footnote')return [map(child,p)];nestedFields(child,p,['label','children']);if(referenced.has(child.label))return [];ctx.note(p,'unsupported-node','degraded','Pandoc cannot retain an unreferenced footnote definition; retained its body as ordinary blocks.');return child.children.map((value,j)=>map(value,`${p}/children/${j}`))}) }
    if (n.type === 'text' || n.type === 'escaped_text') return node('Str', n.value)
    const inline = { emphasis:'Emph', strong:'Strong', strike:'Strikeout', underline:'Underline', superscript:'Superscript', subscript:'Subscript' }
    if (inline[n.type]) return node(inline[n.type], children())
    if (n.type === 'paragraph') return node(tight ? 'Plain' : 'Para', children())
    if (n.type === 'heading') return node('Header', [n.level,a,children()])
    if (n.type === 'span') return node('Span', [a,children()])
    if (n.type === 'code') return node('Code', [a,n.value])
    if (n.type === 'code_block') return node('CodeBlock', [[a[0], [...(n.lang ? [n.lang] : []), ...a[1]], a[2]], n.content.replace(/\n$/, '')])
    if (n.type === 'link' || n.type === 'image') return node(n.type === 'link' ? 'Link' : 'Image', [a, n.type === 'link' ? children() : [node('Str',n.alt)], [n.href ?? n.src,n.title ?? '']])
    if (n.type === 'hard_break' || n.type === 'thematic_break') return node(n.type === 'hard_break' ? 'LineBreak' : 'HorizontalRule')
    if (n.type === 'block_quote') return node('BlockQuote',children())
    if (n.type === 'list') {
      const items = n.items.map((item,i) => { nestedFields(item,`${path}/items/${i}`,['children','checked']); if (item.checked !== undefined) ctx.note(`${path}/items/${i}/checked`, 'unsupported-field', 'dropped', 'Task flags are outside the Pandoc export subset.'); return item.children.map((child,j) => map(child, `${path}/items/${i}/children/${j}`, n.tight)) })
      return node(n.ordered ? 'OrderedList' : 'BulletList', n.ordered ? [[n.start ?? 1,node('Decimal'),node('Period')],items] : items)
    }
    if (n.type === 'definition_list') {
      const entries = []; for (const [i,item] of n.items.entries()) { nestedFields(item,`${path}/items/${i}`,['children']);if (item.type === 'definition_term') entries.push([item.children.map((c,j) => map(c, `${path}/items/${i}/children/${j}`)),[]]); else if (entries.length) entries.at(-1)[1].push(item.children.map((c,j) => map(c, `${path}/items/${i}/children/${j}`))); else throw new Error('A Pandoc definition needs a preceding term') }
      return node('DefinitionList', entries)
    }
    if (n.type === 'footnote_ref') { if(activeNotes.has(n.label) || !referenced.has(n.label)){ctx.note(path,'unsupported-node','degraded','Retained a recursive or unreachable note reference as a literal marker.');return node('Str',`[^${n.label}]`)}const note = notes.get(n.label); if (!note) throw new Error(`Unresolved footnote: ${n.label}`); if (!/^\d+$/.test(n.label)) ctx.note(`${path}/label`, 'unsupported-field', 'degraded', 'Pandoc replaces named note labels with numeric document-order labels.'); activeNotes.add(n.label);try{return node('Note',note.node.children.map((child,i) => map(child, `/children/${note.index}/children/${i}`)))}finally{activeNotes.delete(n.label)} }
    if (n.type === 'table') {
      const row = (r,i) => {nestedFields(r,`${path}/rows/${i}`,['cells','attrs']);return [foreignAttr(r.attrs),r.cells.map((cell,j) => {nestedFields(cell,`${path}/rows/${i}/cells/${j}`,['children','header','attrs','align','colspan','rowspan','valign']); for (const key of ['align','colspan','rowspan','valign']) if (cell[key]) ctx.note(`${path}/rows/${i}/cells/${j}/${key}`, 'unsupported-field', 'dropped', `${key} is outside the Pandoc table export subset.`); return [foreignAttr(cell.attrs),node('AlignDefault'),1,1,[node('Plain',cell.children.map((child,k) => map(child, `${path}/rows/${i}/cells/${j}/children/${k}`)))]] })]}
      const heads = n.rows.filter(r => r.cells.every(c => c.header)), body = n.rows.filter(r => !r.cells.every(c => c.header))
      return node('Table', [a,[null,[]],Array.from({length:Math.max(...n.rows.map(r=>r.cells.length))},()=>[node('AlignDefault'),node('ColWidthDefault')]),[emptyAttr(),heads.map(row)],[[emptyAttr(),0,[],body.map(row)]],[emptyAttr(),[]]])
    }
    const fallback = ctx.unsupported(n,path)
    return node(['paragraph','span','text'].includes(n.type) ? 'Str' : 'Para', ['paragraph','span','text'].includes(n.type) ? plain(fallback) : [node('Str',plain(fallback))])
  }
  return map(root,'')
}
