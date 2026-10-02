import { XMLParser } from 'fast-xml-parser'
import { context, document, text, coalesce, plain } from './trees.mjs'
const parser = new XMLParser({preserveOrder:true,ignoreAttributes:false,attributeNamePrefix:'',parseTagValue:false,trimValues:false,htmlEntities:true})
function tree(records) {
  return records.flatMap(record => {
    const tag = Object.keys(record).find(key=>key!==':@')
    if (tag === '?asciidoc-hr') return [{tag:'thematic_break',children:[]}]
    if (!tag || tag.startsWith('?') || tag.startsWith('!')) return []
    if (tag === '#text') return [{tag:'#text',value:String(record[tag])}]
    return [{tag,attrs:record[':@']??{},children:tree(record[tag]??[])}]
  })
}
export function fromDocbook(source, ctx = context('asciidoctor-docbook'), options = {}) {
  const roots = tree(parser.parse(source))
  const content = n => n.tag === '#text' ? n.value : (n.children??[]).map(content).join('')
  const map = (n,path,depth=0) => {
    const inline = nodes => coalesce(nodes.flatMap((child,i)=>map(child,`${path}/children/${i}`,depth)))
    const blocks = nodes => coalesce(nodes.flatMap((child,i)=>child.tag === '#text' && /^\s*$/.test(child.value) ? [] : map(child,`${path}/children/${i}`,depth)))
    if (n.tag === 'thematic_break') return {type:'thematic_break'}
    if (n.tag === '#text') return text(n.value)
    if (n.tag === 'article' || n.tag === 'book') return blocks(n.children)
    if (n.tag === 'info') { if (options.hasHeader === false) { ctx.note(path,'generated-docbook-title','normalized','Omitted generated document metadata and the placeholder title.');return [] } const title=n.children.find(c=>c.tag==='title'); return title ? {type:'heading',level:1,children:inline(title.children)} : [] }
    if (n.tag === 'section' || /^sect[1-6]$/.test(n.tag)) return n.children.flatMap((child,i)=>child.tag==='#text' && /^\s*$/.test(child.value) ? [] : child.tag==='title' ? [{type:'heading',level:depth+2,children:inline(child.children)}] : map(child,`${path}/children/${i}`,depth+1))
    if ((n.tag === 'simpara' || n.tag === 'para') && n.children.length && n.children.filter(c=>c.tag!== '#text' || !/^\s*$/.test(c.value)).every(c=>c.tag==='thematic_break')) return {type:'thematic_break'}
    if (n.tag === 'simpara' || n.tag === 'para') return {type:'paragraph',children:inline(n.children)}
    if (n.tag === 'emphasis') return {type:n.attrs.role==='strong'?'strong':'emphasis',children:inline(n.children)}
    if (n.tag === 'literal' || n.tag === 'code') return {type:'code',value:content(n)}
    if (n.tag === 'link') return {type:'link',href:n.attrs['xl:href']??n.attrs['xlink:href']??n.attrs.linkend??'',children:inline(n.children)}
    if (n.tag === 'blockquote') return {type:'block_quote',children:blocks(n.children)}
    if (n.tag === 'programlisting' || n.tag === 'screen') return {type:'code_block',content:content(n).replace(/\n?$/,'\n'),...(n.attrs.language?{lang:n.attrs.language}:{})}
    if (n.tag === 'itemizedlist' || n.tag === 'orderedlist') return {type:'list',ordered:n.tag==='orderedlist',tight:false,items:n.children.filter(c=>c.tag==='listitem').map((c,i)=>map(c,`${path}/items/${i}`,depth)),...(n.attrs.startingnumber && Number(n.attrs.startingnumber)!==1 ? {start:Number(n.attrs.startingnumber)} : {})}
    if (n.tag === 'listitem') return {type:'list_item',children:blocks(n.children)}
    if (n.tag === 'variablelist') return {type:'definition_list',items:n.children.filter(c=>c.tag==='varlistentry').flatMap((entry,i)=>entry.children.filter(c=>c.tag==="term"||c.tag==="listitem").map((c,j)=>({type:c.tag==='term'?'definition_term':'definition_description',children:c.tag==='term'?inline(c.children):blocks(c.children)})))}
    if (n.tag === 'phrase' && n.attrs.role === 'line-through') return {type:'strike',children:inline(n.children)}
    if (n.tag === 'superscript' || n.tag === 'subscript') return {type:n.tag,children:inline(n.children)}
    if (n.tag === 'formalpara') return blocks(n.children)
    if (n.tag === 'phrase' && n.attrs.role === 'strong') return {type:'strong',children:inline(n.children)}
    return ctx.unsupported({type:n.tag,value:content(n)},path,['table','informaltable','mediaobject'].includes(n.tag))
  }
  return document(coalesce(roots.flatMap((n,i)=>n.tag === '#text' && /^\s*$/.test(n.value) ? [] : map(n,`/docbook/${i}`))))
}
