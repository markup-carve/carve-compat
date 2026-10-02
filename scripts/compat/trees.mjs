import { unified } from 'unified'
import rehypeParse from 'rehype-parse'
import { find, html } from 'property-information'

export const text = value => ({ type: 'text', value })
export const document = children => ({ type: 'document', children, srcByteLength: 0 })

export function coalesce(nodes) {
  const out = []
  for (const node of nodes.flat()) {
    if (node.type === 'text' && out.at(-1)?.type === 'text') out.at(-1).value += node.value
    else if (node.type !== 'text' || node.value !== '') out.push(node)
  }
  return out
}

// Compare semantic fields; spelling and foreign source coordinates stay outside this projection.
export function semantics(value) {
  if (Array.isArray(value)) return coalesce(value.map(semantics))
  if (!value || typeof value !== 'object') return value
  if (value.type === 'soft_break') return text(' ')
  if (value.type === 'text' || value.type === 'escaped_text') return text(value.value.replace(/\n/g, ' '))
  const out = {}
  for (const [key, field] of Object.entries(value)) {
    if (['pos', 'srcByteLength', 'bulletChar', 'delim', 'order'].includes(key)) continue
    if (key === 'start' && field === 1) continue
    out[key] = semantics(field)
  }
  return out
}

const parser = unified().use(rehypeParse, { fragment: true })
export const parseHtml = html => parser.parse(html)

export function authoredAttributes(ast) {
  const authoredIds = new Set(), authoredClasses = new Set(), authoredKeyValues = new Set()
  const walk = node => {
    if (node.attrs?.id) authoredIds.add(node.attrs.id)
    node.attrs?.classes?.forEach(c => authoredClasses.add(c))
    for(const [key,value]of Object.entries(node.attrs?.keyValues??{}))authoredKeyValues.add(`${key}=${value}`)
    ;(node.children ?? node.items ?? node.rows ?? node.cells ?? []).forEach(walk)
  }
  walk(ast)
  return { authoredIds, authoredClasses, authoredKeyValues }
}

export function context(tool) {
  const diagnostics = []
  const note = (path, code, fidelity, message) => diagnostics.push({ tool, path, code, fidelity, message })
  const unsupported = (node, path, block = false) => {
    note(path, 'unsupported-node', 'degraded', `Unsupported ${node.type ?? node.tag ?? node.tagName ?? node.context}; retained readable text.`)
    const value = plain(node)
    return block ? { type: 'paragraph', children: [text(value)] } : text(value)
  }
  return { tool, diagnostics, note, unsupported }
}

export function plain(node) {
  if (typeof node === 'string') return node
  return node.value ?? node.text ?? node.literal ?? node.content ?? node.alt ?? node.properties?.alt ?? (node.children ?? node.items ?? node.rows ?? node.cells ?? []).map(plain).join('')
}

export function fromHast(root, ctx = context('hast'), options = {}) {
  const generatedClasses = new Set(['docutils', 'arabic', 'reference', 'external', 'literal', 'simple', 'code', 'text', 'literal-block', 'highlight', 'sectionbody', 'paragraph', 'ulist', 'olist', 'listingblock', 'content', 'quoteblock', 'sect1', 'sect2', 'contains-task-list', 'task-list-item', 'task-list'])
  const noteSections = new Map(), noteIds = new Map(), noteBodies = new Set()
  const walk = (n, visit) => { visit(n); n.children?.forEach(c=>walk(c,visit)) }
  walk(root,n=>{
    if (n.type !== 'element' || !(n.properties?.role === 'doc-endnotes' || n.properties?.dataFootnotes !== undefined)) return
    let ol; walk(n,c=>{ if (!ol && c.tagName === 'ol') ol=c })
    const items = ol?.children?.filter(c=>c.tagName==='li')??[]
    noteSections.set(n,items)
    items.forEach((li,i)=>{ if(li.properties?.id)noteIds.set(li.properties.id,String(i+1));walk(li,c=>noteBodies.add(c)) })
  })
  const map = (n, path, block = false, taskContext = false) => {
    if (n.type === 'text') return text(n.value)
    if (n.type === 'root') return document(blocks(n.children, path))
    if (options.generated && n.type === 'comment' && /^\s*$/.test(n.value)) {
      ctx.note(path, 'source-boundary', 'normalized', 'Consumed an empty comment separating exported blocks.')
      return []
    }
    if (n.type !== 'element') return ctx.unsupported(n, path, block)
    const tag = n.tagName, props = n.properties ?? {}
    if(options.generated && tag==='sup' && n.children.some(c=>c.tagName==='a' && (c.properties?.role==='doc-noteref' || c.properties?.dataFootnoteRef!==undefined || c.properties?.className?.includes('footnote-ref'))))return coalesce(n.children.flatMap((c,i)=>map(c,`${path}/children/${i}`)))
    if (options.generated && noteSections.has(n)) {
      ctx.note(path,'generated-footnote-navigation','normalized','Reconstructed footnote bodies and omitted generated endnote navigation.')
      return noteSections.get(n).map((li,i)=>({type:'footnote',label:String(i+1),children:blocks(li.children,`${path}/footnotes/${i}`)}))
    }
    if (options.generated && tag === 'a' && (props.role === 'doc-backlink' || props.dataFootnoteBackref !== undefined || (noteBodies.has(n) && props.className?.some(c=>['footnote-back','footnote-backref'].includes(c))))) {
      ctx.note(path,'generated-footnote-navigation','normalized','Omitted a generated footnote backlink.');return []
    }
    if (options.generated && tag === 'a' && (props.role === 'doc-noteref' || props.dataFootnoteRef !== undefined || props.className?.includes('footnote-ref'))) {
      const label=noteIds.get(String(props.href??'').replace(/^#/,''))
      if(label)return {type:'footnote_ref',label}
      ctx.note(path,'unsupported-field','dropped','The rendered footnote target could not be matched to an endnote body.')
    }
    if (tag === 'input' && props.type === 'checkbox' && taskContext) {
      for(const key of Object.keys(props))if(!['type','checked','disabled','ariaLabel'].includes(key))ctx.note(`${path}/properties/${key}`,'unsupported-field','dropped','Authored checkbox-control attributes are outside this subset.')
      ctx.note(path,'task-checkbox','normalized','Moved checkbox state to its list item.');return []
    }
    const generatedLang = options.generated && options.renderer === 'pandoc' && tag === 'pre' ? props.className?.[0] : options.generated && tag === 'pre' && props.className?.includes('code') ? props.className.find(c => !['code', 'literal-block'].includes(c)) : undefined
    const children = () => {
      const mapped = coalesce(n.children.map((c, i) => map(c, `${path}/children/${i}`, false, taskContext || tag === 'li')))
      if(noteBodies.has(n) && n.children.at(-1)?.tagName==='a' && mapped.at(-1)?.type==='text')mapped.at(-1).value=mapped.at(-1).value.replace(/ $/,'')
      for (let i = 1; i < mapped.length; i++) if (mapped[i - 1].type === 'hard_break' && mapped[i].type === 'text') mapped[i].value = mapped[i].value.replace(/^\n/, '')
      return mapped
    }
    const attrs = {}
    for (const [key, value] of Object.entries(props)) {
      if(options.generated && tag==='th' && key==='scope' && value==='col' && !options.authoredKeyValues?.has('scope=col')){ctx.note(`${path}/properties/scope`,'generated-html-attribute','normalized','Omitted generated column-header scope.');continue}
      if(options.generated && options.renderer==='pandoc' && key.startsWith('data') && key.length>4){const original=key[4].toLowerCase()+key.slice(5);if(options.authoredKeyValues?.has(`${original}=${value}`)){attrs.keyValues??={};attrs.keyValues[original]=String(value);ctx.note(`${path}/properties/${key}`,'generated-html-attribute','normalized','Restored an authored attribute renamed by Pandoc HTML output.');continue}}
      if (options.renderer === 'pandoc' && tag === 'ol' && key === 'type' && String(value) === '1') { ctx.note(`${path}/properties/type`, 'generated-html-attribute', 'normalized', 'Omitted the Pandoc decimal-list type attribute.'); continue }
      if (['td','th'].includes(tag) && ['align','colSpan','rowSpan','style'].includes(key)) { if(value && value!==1)ctx.note(`${path}/properties/${key}`,'unsupported-field','dropped','Cell alignment, styles and spans are outside this HTML adapter subset.');continue }
      if ((tag === 'a' && ['href', 'title'].includes(key)) || (tag === 'img' && ['src', 'alt', 'title'].includes(key)) || (tag === 'ol' && key === 'start')) continue
      if (options.generated && key === 'className') {
        const retained = value.filter(c => (!generatedClasses.has(c) && c !== generatedLang) || options.authoredClasses?.has(c))
        if (retained.length !== value.length) ctx.note(`${path}/properties/${key}`, 'generated-html-attribute', 'normalized', 'Omitted classes added by the foreign renderer.')
        if (retained.length) attrs.classes = retained
      } else if (options.generated && ((key === 'id' && !options.authoredIds?.has(value) && (/^h[1-6]$/.test(tag) || tag === 'section')) || key === 'dataLang')) {
        ctx.note(`${path}/properties/${key}`, 'generated-html-attribute', 'normalized', `Omitted ${key} added by the foreign renderer.`)
      } else {
        if (key === 'id') attrs.id = String(value)
        else if (key === 'className') attrs.classes = value
        else { attrs.keyValues ??= {}; attrs.keyValues[find(html, key).attribute] = String(value) }
      }
    }
    let result
    if (/^h[1-6]$/.test(tag)) result = { type: 'heading', level: Number(tag[1]), children: children() }
    else if (tag === 'p') result = { type: 'paragraph', children: children() }
    else if (options.generated && tag === 'span' && props.className?.includes('literal')) result = {type:'code',value:plain(n)}
    else if (tag === 'span') result = {type:'span',children:children()}
    else if (tag === 'dl') result = {type:'definition_list',items:blocks(n.children,path)}
    else if (tag === 'dt') result = {type:'definition_term',children:children()}
    else if (tag === 'dd') { const hasBlocks=n.children.some(c=>['p','ul','ol','pre','blockquote','dl'].includes(c.tagName));result={type:'definition_description',children:hasBlocks?blocks(n.children,path):[{type:'paragraph',children:children()}]} }
    else if (tag === 'table') {
      const rows=n.children.flatMap((c,i)=>c.tagName==='tr'?[{n:c,path:`${path}/rows/${i}`}]:['thead','tbody','tfoot'].includes(c.tagName)?c.children.filter(r=>r.tagName==='tr').map((r,j)=>({n:r,path:`${path}/rows/${i}/${j}`})):[])
      for(const [i,c]of n.children.entries())if(c.tagName && !['tr','thead','tbody','tfoot'].includes(c.tagName))ctx.note(`${path}/children/${i}`,'unsupported-field','dropped','Table captions and column groups are outside this HTML adapter subset.')
      result={type:'table',rows:rows.map(r=>map(r.n,r.path,true))}
    }
    else if (tag === 'tr') result={type:'table_row',cells:n.children.filter(c=>['td','th'].includes(c.tagName)).map((c,i)=>map(c,`${path}/cells/${i}`))}
    else if (tag === 'td' || tag === 'th') { const parts=children();const content=parts.length===1 && parts[0].type==='paragraph'?parts[0].children:parts;result={type:'table_cell',header:tag==='th',children:content} }
    else if (['em', 'strong', 'del', 's', 'u', 'mark', 'sup', 'sub'].includes(tag)) {
      result = { type: ({ em: 'emphasis', del: 'strike', s: 'strike', u: 'underline', mark: 'highlight', sup: 'superscript', sub: 'subscript' })[tag] ?? tag, children: children() }
    } else if (tag === 'a') result = { type: 'link', href: props.href ?? '', children: children(), ...(props.title ? { title: props.title } : {}) }
    else if (tag === 'img') result = { type: 'image', src: props.src ?? '', alt: props.alt ?? '', ...(props.title ? { title: props.title } : {}) }
    else if (options.generated && tag === 'span' && props.className?.includes('literal')) result = { type: 'code', value: plain(n) }
    else if (tag === 'code') result = { type: 'code', value: plain(n) }
    else if (tag === 'pre') {
      const code = n.children.find(c => c.tagName === 'code') ?? n
      const lang = code.properties?.className?.find(c => c.startsWith('language-'))?.slice(9) ?? generatedLang
      let content = plain(code)
      if (options.generated && content && !content.endsWith('\n')) {
        ctx.note(path, 'code-terminal-newline', 'normalized', 'Added the terminal newline used by Carve code blocks.')
        content += '\n'
      }
      result = { type: 'code_block', content, ...(lang ? { lang } : {}) }
    } else if (tag === 'blockquote') result = { type: 'block_quote', children: blocks(n.children, path) }
    else if (tag === 'br') result = { type: 'hard_break' }
    else if (tag === 'hr') result = { type: 'thematic_break' }
    else if (tag === 'ul' || tag === 'ol') {
      const items = []
      for (const [i, child] of n.children.entries()) {
        if (child.tagName === 'li') items.push(map(child, `${path}/items/${items.length}`, true))
        else if (!(child.type === 'text' && /^\s*$/.test(child.value))) items.push({ type: 'list_item', children: [ctx.unsupported(child, `${path}/children/${i}`, true)] })
      }
      result = { type: 'list', ordered: tag === 'ol', tight: !n.children.some(li => li.tagName === 'li' && li.children.some(p => p.tagName === 'p')), items, ...(tag === 'ol' && Number(props.start ?? 1) !== 1 ? { start: Number(props.start) } : {}) }
    } else if (tag === 'li') {
      const hasBlocks = n.children.some(c => ['p', 'ul', 'ol', 'pre', 'blockquote'].includes(c.tagName))
      const inlineChildren = children()
      if (!hasBlocks) {
        if (inlineChildren[0]?.type === 'text') inlineChildren[0].value = inlineChildren[0].value.replace(/^\n/, '')
        if (inlineChildren.at(-1)?.type === 'text') inlineChildren.at(-1).value = inlineChildren.at(-1).value.replace(/\n$/, '')
      }
      const findCheckbox=node=>node.children?.flatMap(c=>c.tagName==='input' && c.properties?.type==='checkbox'?[c]:c.tagName==='p'?findCheckbox(c):[])??[];let checkbox=findCheckbox(n)[0];
      checkbox??=n.children.find(c=>c.tagName==='input' && c.properties?.type==='checkbox') ?? n.children.find(c=>c.tagName==='p')?.children.find(c=>c.tagName==='input' && c.properties?.type==='checkbox')
      const body=hasBlocks?blocks(n.children,path,true):[{type:'paragraph',children:inlineChildren}]
      if(checkbox && body[0]?.children?.[0]?.type==='text')body[0].children[0].value=body[0].children[0].value.replace(/^\n+/,'').replace(/^ /,'')
      result = { type: 'list_item', children:body,...(checkbox?{checked:!!checkbox.properties.checked}:{}) }
    } else if (options.generated && ['div', 'section', 'main'].includes(tag)) {
      ctx.note(path, 'generated-html-wrapper', 'normalized', `Removed foreign renderer ${tag} wrapper.`)
      return blocks(n.children, path)
    } else return ctx.unsupported(n, path, block)
    if (Object.keys(attrs).length) result.attrs = attrs
    return result
  }
  const blocks = (nodes, path, taskContext = false) => coalesce(nodes.flatMap((n, i) => n.type === 'text' && /^\s*$/.test(n.value) ? [] : map(n, `${path}/children/${i}`, true, taskContext)))
  return map(root, '')
}

export function fromMdast(root, ctx = context('mdast')) {
  const definitions = new Map()
  const collect = n => { if (n.type === 'definition') definitions.set(n.identifier, n); n.children?.forEach(collect) }
  collect(root)
  const map = (n, path) => {
    const children = () => coalesce((n.children ?? []).flatMap((c, i) => map(c, `${path}/children/${i}`)))
    if (n.type === 'root') return document(children())
    if (n.type === 'definition') {
      ctx.note(path, 'reference-resolved', 'normalized', 'Resolved Markdown references to their destination.')
      return []
    }
    if (n.type === 'text') return text(n.value)
    if (['paragraph', 'strong', 'emphasis', 'blockquote', 'listItem'].includes(n.type)) {
      return { ...(n.type==='listItem' && n.checked!==undefined && n.checked!==null?{checked:n.checked}:{}), type: ({ blockquote: 'block_quote', listItem: 'list_item' })[n.type] ?? n.type, children: children() }
    }
    if (n.type === 'heading') return { type: 'heading', level: n.depth, children: children() }
    if (n.type === 'break' || n.type === 'thematicBreak') return { type: n.type === 'break' ? 'hard_break' : 'thematic_break' }
    if (n.type === 'inlineCode') return { type: 'code', value: n.value }
    if (n.type === 'code') {
      if (n.meta) ctx.note(`${path}/meta`, 'unsupported-field', 'dropped', 'Code metadata is outside the shared subset.')
      return { type: 'code_block', content: n.value + '\n', ...(n.lang ? { lang: n.lang } : {}) }
    }
    if (n.type === 'list') return { type: 'list', ordered: n.ordered, tight: !n.spread && !n.children.some(c => c.spread), items: children(), ...(n.ordered && n.start !== 1 ? { start: n.start } : {}) }
    if (n.type === 'link' || n.type === 'image' || n.type === 'linkReference' || n.type === 'imageReference') {
      const reference = n.type.endsWith('Reference')
      const dest = reference ? definitions.get(n.identifier) : n
      if (!dest) return ctx.unsupported(n, path)
      if (reference) ctx.note(path, 'reference-resolved', 'normalized', 'Resolved Markdown reference spelling.')
      const image = n.type.startsWith('image')
      return { type: image ? 'image' : 'link', ...(image ? { src: dest.url, alt: n.alt ?? '' } : { href: dest.url, children: children() }), ...(dest.title ? { title: dest.title } : {}) }
    }
    if (n.type === 'footnoteReference') return {type:'footnote_ref',label:n.identifier}
    if (n.type === 'footnoteDefinition') return {type:'footnote',label:n.identifier,children:children()}
    if (n.type === 'table') {
      if(n.align?.some(Boolean))ctx.note(`${path}/align`,'unsupported-field','dropped','Column alignment is outside this mdast table subset.')
      return {type:'table',rows:n.children.map((r,i)=>({type:'table_row',cells:r.children.map((cell,j)=>({type:'table_cell',header:i===0,children:coalesce(cell.children.map((c,k)=>map(c,`${path}/children/${i}/children/${j}/children/${k}`)))}))}))}
    }
    if (n.type === 'delete') return { type: 'strike', children: children() }
    return ctx.unsupported(n, path, ['html', 'table', 'footnoteDefinition'].includes(n.type))
  }
  return map(root, '')
}

export function fromCommonmark(root, ctx = context('commonmark')) {
  const map = (n, path) => {
    const nodes = []
    for (let c = n.firstChild; c; c = c.next) nodes.push(c)
    const children = () => coalesce(nodes.map((c, i) => map(c, `${path}/children/${i}`)))
    if (n.type === 'document') return document(children())
    if (['paragraph', 'strong', 'emph', 'block_quote', 'item'].includes(n.type)) return { type: ({ emph: 'emphasis', item: 'list_item' })[n.type] ?? n.type, children: children() }
    if (n.type === 'heading') return { type: 'heading', level: n.level, children: children() }
    if (n.type === 'text') return text(n.literal)
    if (n.type === 'softbreak' || n.type === 'linebreak' || n.type === 'thematic_break') return n.type === 'softbreak' ? text(' ') : { type: n.type === 'linebreak' ? 'hard_break' : n.type }
    if (n.type === 'code') return { type: 'code', value: n.literal }
    if (n.type === 'code_block') {
      const lang = n.info?.trim().split(/\s+/)[0]
      if (n.info?.trim() && n.info.trim() !== lang) ctx.note(`${path}/info`, 'unsupported-field', 'dropped', 'Code metadata is outside the shared subset.')
      return { type: 'code_block', content: n.literal, ...(lang ? { lang } : {}) }
    }
    if (n.type === 'link' || n.type === 'image') {
      const label = children()
      return { type: n.type, ...(n.type === 'image' ? { src: n.destination, alt: label.map(plain).join('') } : { href: n.destination, children: label }), ...(n.title ? { title: n.title } : {}) }
    }
    if (n.type === 'list') return { type: 'list', ordered: n.listType === 'ordered', tight: n.listTight, items: children(), ...(n.listType === 'ordered' && n.listStart !== 1 ? { start: n.listStart } : {}) }
    return ctx.unsupported({ type: n.type, literal: n.literal }, path, n.type === 'html_block')
  }
  return map(root, '')
}

export function fromDjot(root, ctx = context('djot')) {
  const map = (n, path) => {
    const children = () => coalesce((n.children ?? []).flatMap((c, i) => map(c, `${path}/children/${i}`)))
    let result
    if (n.tag === 'doc') {
      return document([...children(),...Object.entries(n.footnotes??{}).map(([label,note])=>({type:'footnote',label,children:coalesce(note.children.map((c,i)=>map(c,`/footnotes/${label}/children/${i}`)))}))])
    }
    if (n.tag === 'section') {
      if (n.attributes) ctx.note(`${path}/attributes`, 'unsupported-field', 'dropped', 'Authored section attributes cannot survive section flattening.')
      ctx.note(path, 'automatic-section', 'normalized', 'Flattened Djot automatic section structure.')
      return children()
    }
    if (n.tag === 'str') result = text(n.text)
    else if (['para', 'emph', 'strong', 'block_quote', 'list_item'].includes(n.tag)) result = { type: ({ para: 'paragraph', emph: 'emphasis' })[n.tag] ?? n.tag, children: children() }
    else if (n.tag === 'span') result={type:'span',children:children()}
    else if (n.tag === 'footnote_reference') result={type:'footnote_ref',label:n.text}
    else if (n.tag === 'definition_list') result={type:'definition_list',items:children()}
    else if (n.tag === 'definition_list_item') return children()
    else if (n.tag === 'term' || n.tag === 'definition') result={type:n.tag==='term'?'definition_term':'definition_description',children:children()}
    else if (n.tag === 'table') {
      const caption=n.children.find(c=>c.tag==='caption');if(caption?.children.length)ctx.note(`${path}/caption`,'unsupported-field','dropped','Djot table captions are outside this subset.')
      result={type:'table',rows:n.children.filter(c=>c.tag==='row').map((r,i)=>map(r,`${path}/rows/${i}`))}
    }
    else if(n.tag==='row')result={type:'table_row',cells:children()}
    else if(n.tag==='cell'){if(n.align && n.align!=='default')ctx.note(`${path}/align`,'unsupported-field','dropped','Djot cell alignment is outside this subset.');result={type:'table_cell',header:n.head,children:children()}}
    else if(n.tag==='task_list_item')result={type:'list_item',checked:n.checkbox==='checked',children:children()}
    else if (n.tag === 'heading') result = { type: 'heading', level: n.level, children: children() }
    else if (n.tag === 'soft_break') result = text(' ')
    else if (['hard_break', 'thematic_break'].includes(n.tag)) result = { type: n.tag }
    else if (n.tag === 'verbatim') result = { type: 'code', value: n.text }
    else if (n.tag === 'code_block') result = { type: 'code_block', content: n.text, ...(n.lang ? { lang: n.lang } : {}) }
    else if (n.tag === 'link' || n.tag === 'image') {
      const destination = n.destination ?? root.references?.[n.reference]?.destination
      if (destination === undefined) return ctx.unsupported(n, path)
      result = { type: n.tag, ...(n.tag === 'image' ? { src: destination, alt: children().map(plain).join('') } : { href: destination, children: children() }) }
    } else if (n.tag === 'bullet_list' || n.tag === 'ordered_list' || n.tag === 'task_list') {
      if (n.tag === 'ordered_list' && n.style && !['1.', '1)', '(1)'].includes(n.style)) ctx.note(`${path}/style`, 'unsupported-field', 'dropped', 'Lettered and roman numbering styles are outside this adapter subset.')
      result = { type: 'list', ordered: n.tag === 'ordered_list', tight: n.tight, items: children(), ...(n.tag === 'ordered_list' && (n.start ?? 1) !== 1 ? { start: n.start } : {}) }
    }
    else return ctx.unsupported(n, path, ['div', 'table', 'raw_block', 'definition_list'].includes(n.tag))
    if (n.attributes) result.attrs = foreignAttrs(n.attributes)
    return result
  }
  return map(root, '')
}

export function fromDocutils(root, ctx = context('docutils')) {
  const map = (n, path, depth = 1) => {
    const children = () => coalesce((n.children ?? []).flatMap((c, i) => map(c, `${path}/children/${i}`, depth)))
    const a = n.attributes ?? {}
    if (n.type === 'comment') {
      if (plain(n) === '') ctx.note(path, 'source-boundary', 'normalized', 'Consumed an empty comment separating exported blocks.')
      else ctx.note(path, 'unsupported-node', 'dropped', 'Non-rendering reStructuredText comments are outside this adapter subset.')
      return []
    }
    const accepted = new Set(['ids', 'classes', 'names', 'dupnames', 'source', ...({ reference: ['name', 'refuri'], target: ['refuri', 'refid'], image: ['uri', 'alt'], bullet_list: ['bullet'], enumerated_list: ['start', 'enumtype', 'prefix', 'suffix'], literal_block: ['xml:space'] }[n.type] ?? [])])
    for (const key of Object.keys(a)) if (!accepted.has(key)) ctx.note(`${path}/attributes/${key}`, 'unsupported-field', 'dropped', `${key} is outside this adapter subset.`)
    if (a.classes?.length && !(n.type === 'literal_block' && a.classes.includes('code'))) ctx.note(`${path}/attributes/classes`, 'unsupported-field', 'dropped', 'Authored Docutils classes are outside this adapter subset.')
    if (a.ids?.length && !['section', 'target'].includes(n.type)) ctx.note(`${path}/attributes/ids`, 'unsupported-field', 'dropped', 'Docutils anchors on content nodes are outside this adapter subset.')
    if (n.type === 'document') return document(children())
    if (n.type === 'section') {
      ctx.note(path, 'automatic-section', 'normalized', 'Flattened reStructuredText section and generated identifiers.')
      return coalesce(n.children.flatMap((c, i) => map(c, `${path}/children/${i}`, depth + 1)))
    }
    if (n.type === 'target') {
      if (a.refuri) ctx.note(path, 'reference-resolved', 'normalized', 'Resolved reStructuredText reference target.')
      else ctx.note(path, 'unsupported-node', 'dropped', 'Standalone reStructuredText anchors are outside this adapter subset.')
      return []
    }
    if (n.type === 'title') return { type: 'heading', level: depth, children: children() }
    if (n.type === 'text') return text(n.value)
    if (['paragraph', 'emphasis', 'strong', 'block_quote', 'list_item'].includes(n.type)) return { type: n.type, children: children() }
    if (n.type === 'literal') return { type: 'code', value: plain(n) }
    if (n.type === 'literal_block') {
      const lang = a.classes?.includes('code') ? a.classes.find(c => c !== 'code') : undefined
      return { type: 'code_block', content: plain(n) + '\n', ...(lang ? { lang } : {}) }
    }
    if (n.type === 'reference' && a.refuri) return { type: 'link', href: a.refuri, children: children() }
    if (n.type === 'image') return { type: 'image', src: a.uri, alt: a.alt ?? '' }
    if (n.type === 'transition') return { type: 'thematic_break' }
    if (n.type === 'bullet_list' || n.type === 'enumerated_list') {
      if (a.enumtype && a.enumtype !== 'arabic') ctx.note(`${path}/attributes/enumtype`, 'unsupported-field', 'dropped', 'Lettered and roman numbering styles are outside this adapter subset.')
      ctx.note(`${path}/tight`, 'list-layout-unavailable', 'normalized', 'Docutils doctrees do not encode Carve list tightness; this adapter uses loose lists.')
      return { type: 'list', ordered: n.type === 'enumerated_list', tight: false, items: children(), ...(a.start && a.start !== 1 ? { start: a.start } : {}) }
    }
    return ctx.unsupported(n, path, ['note', 'warning', 'admonition', 'system_message', 'table', 'definition_list'].includes(n.type))
  }
  return map(root, '')
}

export function fromMd4c(events, ctx = context('md4c')) {
  const stack = [], blockTypes = ['document', 'block_quote', 'list', 'list', 'list_item', 'thematic_break', 'heading', 'code_block', 'raw_block', 'paragraph']
  const spanTypes = ['emphasis', 'strong', 'link', 'image', 'code']
  let root
  for (const [i, e] of events.entries()) {
    const path = `/events/${i}`
    if (e.event.startsWith('enter_')) {
      const type = (e.event === 'enter_block' ? blockTypes : spanTypes)[e.kind] ?? 'unsupported'
      const n = { type, children: [] }
      if (type === 'heading') n.level = e.level
      if (type === 'list') { n.ordered = e.kind === 3; n.tight = e.tight; if (e.start !== undefined && e.start !== 1) n.start = e.start }
      if (e.lang) n.lang = e.lang
      if (e.info?.trim() !== (e.lang ?? '') && e.info !== undefined) ctx.note(`${path}/info`, 'unsupported-field', 'dropped', 'Code metadata is outside the shared subset.')
      if (type === 'link') n.href = decode(e.destination)
      if (type === 'image') n.src = decode(e.destination)
      if (e.title) n.title = decode(e.title)
      if (stack.length) stack.at(-1).node.children.push(n)
      else if (root) throw new Error('MD4C emitted multiple roots')
      else root = n
      stack.push({ node: n, event: e, path })
    } else if (e.event.startsWith('leave_')) {
      const frame = stack.pop()
      if (!frame || frame.event.kind !== e.kind || frame.event.event.replace('enter_', 'leave_') !== e.event) throw new Error('Unbalanced MD4C events')
      const n = frame.node
      n.children = coalesce(n.children)
      if (n.type === 'list_item') {
        const blockChildren = [], inlineTypes = ['text', 'emphasis', 'strong', 'link', 'image', 'code', 'hard_break']
        for (const child of n.children) {
          if (inlineTypes.includes(child.type)) {
            if (blockChildren.at(-1)?.type !== 'paragraph') blockChildren.push({ type: 'paragraph', children: [] })
            blockChildren.at(-1).children.push(child)
          } else blockChildren.push(child)
        }
        n.children = blockChildren
      }
      if (['code', 'code_block', 'image'].includes(n.type)) {
        n[n.type === 'code' ? 'value' : n.type === 'image' ? 'alt' : 'content'] = n.children.map(plain).join('')
        delete n.children
      } else if (n.type === 'list') { n.items = n.children; delete n.children }
      else if (['hard_break', 'thematic_break'].includes(n.type)) delete n.children
      else if (n.type === 'raw_block' || n.type === 'unsupported') Object.assign(n, ctx.unsupported(n, frame.path, frame.event.event === 'enter_block'))
    } else if (e.event === 'text') {
      if (!stack.length) throw new Error('MD4C text outside a root')
      if (e.kind === 6) ctx.note(path, 'unsupported-node', 'degraded', 'Raw inline HTML is retained as text.')
      stack.at(-1).node.children.push(e.kind === 2 ? { type: 'hard_break' } : text(e.kind === 3 ? ' ' : e.kind === 1 ? '\uFFFD' : e.kind === 4 ? decode(e.value) : e.value))
    } else throw new Error(`Unknown MD4C event at ${path}`)
  }
  if (!root || stack.length) throw new Error('Incomplete MD4C event stream')
  root.srcByteLength = 0
  return root
}

export function foreignAttrs(attrs) {
  const result = {}
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'id') result.id = value
    else if (key === 'class') result.classes = value.split(/\s+/)
    else { result.keyValues ??= {}; result.keyValues[key] = value }
  }
  return result
}

function decode(value) { return plain(parseHtml(value.replace(/</g, '&lt;').replace(/>/g, '&gt;'))) }
