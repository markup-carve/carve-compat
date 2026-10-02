export const alignment = { AlignLeft: 'left', AlignRight: 'right', AlignCenter: 'center' }
export const pandocAlignment = value => ({ t: ({ left: 'AlignLeft', right: 'AlignRight', center: 'AlignCenter' })[value] ?? 'AlignDefault' })

export function expandTableSpans(rows) {
  const grid = rows.map(() => [])
  for (let r = 0; r < rows.length; r++) {
    let column = 0
    for (const cell of rows[r].cells) {
      while (grid[r][column]) column++
      const width = cell.colspan ?? 1, height = cell.rowspan ?? 1
      if (r + height > rows.length) throw new Error('Table rowspan exceeds its row group')
      grid[r][column] = cell
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        if (x === 0 && y === 0) continue
        if (grid[r + y][column + x]) throw new Error('Overlapping table spans')
        grid[r + y][column + x] = { type: 'table_cell', header: cell.header, span: y ? 'rowspan' : 'colspan', children: [] }
      }
      column += width
    }
  }
  return rows.map((row, r) => ({ ...row, cells: Array.from({ length: grid[r].length }, (_, c) => grid[r][c] ?? { type: 'table_cell', header: false, children: [] }) }))
}

export function tableGroups(table) {
  if (table.rowGroups) {
    const groups = table.rowGroups
    const count = groups.headRows + groups.footRows + groups.bodies.reduce((sum, body) => sum + body.headRows + body.bodyRows, 0)
    if (count !== table.rows.length) throw new Error('Table row groups must account for every row')
    return groups
  }
  let headRows = 0
  while (headRows < table.rows.length && table.rows[headRows].cells.length && table.rows[headRows].cells.every(c => c.header)) headRows++
  const body=table.rows.slice(headRows), leading=row=>{let count=0;for(const cell of row.cells){if(!cell.header)break;count++}return count}, rowHeadColumns=body.length?Math.min(...body.map(leading)):0
  return { headRows, bodies: [{ headRows: 0, bodyRows: body.length, ...(rowHeadColumns?{rowHeadColumns}:{}) }], footRows: 0 }
}

export function htmlLayout(properties) {
  const out = {}, remaining = []
  if (['left', 'right', 'center'].includes(properties.align)) out.align = properties.align
  if (['top', 'middle', 'bottom'].includes(properties.vAlign)) out.valign = properties.vAlign
  for (const declaration of String(properties.style ?? '').split(';').filter(s => s.trim())) {
    const colon=declaration.indexOf(':'), key=declaration.slice(0,colon).trim().toLowerCase(), value=declaration.slice(colon+1).trim().toLowerCase()
    if (key === 'text-align' && ['left', 'right', 'center'].includes(value)) out.align = value
    else if (key === 'vertical-align' && ['top', 'middle', 'bottom'].includes(value)) out.valign = value
    else if (key === 'width' && /^\d+(\.\d+)?%$/.test(value) && Number.parseFloat(value) > 0 && Number.parseFloat(value) <= 100) out.width = Number(shiftTableWidth(value.slice(0, -1), -2))
    else remaining.push(declaration)
  }
  return { ...out, ...(remaining.length ? { residualStyle: remaining.join(';') } : {}) }
}


export function shiftTableWidth(value, places) {
  const match = /^([+]?)(\d+(?:\.\d*)?|\.\d+)(?:[eE]([+-]?\d+))?$/.exec(String(value).trim())
  if (!match) throw new Error('Invalid decimal table width')
  const mantissa = match[2], digits = mantissa.replace('.', '')
  const point = (mantissa.includes('.') ? mantissa.indexOf('.') : mantissa.length) + Number(match[3] ?? 0) + places
  if (!Number.isSafeInteger(point) || Math.abs(point) > 1000) throw new Error('Table width exponent exceeds the decimal limit')
  const shifted = point <= 0 ? `0.${'0'.repeat(-point)}${digits}` : point >= digits.length ? `${digits}${'0'.repeat(point - digits.length)}` : `${digits.slice(0, point)}.${digits.slice(point)}`
  return shifted.replace(/^0+(?=\d)/, '')
}
