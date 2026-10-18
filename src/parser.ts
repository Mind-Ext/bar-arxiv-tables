/**
 * arXiv Table Parser — Phase 4
 *
 * Transforms raw HTML tables (with merged cells, LaTeX artifacts, multi-level
 * headers) into a clean, flat ParsedTable structure suitable for charting.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Metric axis of the data in the table: 'column' (metrics in columns) or 'row' (metrics in rows). */
export type MetricAxis = 'column' | 'row'

/** @deprecated Use MetricAxis instead. */
export type Orientation = MetricAxis

/** A single parsed numeric cell. */
export interface CellValue {
  value: number | null // null = missing / unparseable
  variance?: number // from ± notation
  isHighlighted: boolean // was bolded / underlined / best-marked
  raw: string // original text before sanitization
}

/** The fully parsed, renderer-ready table. */
export interface ParsedTable {
  /** Human-readable caption, if a <caption> or .ltx_caption exists. */
  caption: string | null

  /**
   * Column names, one per numeric column.
   * Each entry is an array of levels (e.g. ["ImageNet", "Top-1"]).
   */
  colNames: string[][]

  /**
   * Row names (model / method names), extracted from the label column(s).
   * Each entry is an array of levels to support multi-level row headers
   * (e.g. ["ResNet", "ResNet-50"]).
   */
  rowNames: string[][]

  /** Contiguous non-numeric rows from the top of the grid. */
  topNonNumRows: number

  /** Contiguous non-numeric columns from the left of the grid. */
  leftNonNumCols: number

  /** Numeric data grid, shape [rows × cols]. */
  data: CellValue[][]

  /** Parallel grid of DOM references, shape [rows × cols]. */
  domCells: HTMLTableCellElement[][]

  /** Detected metric axis of the table ('column' | 'row'). */
  metricAxis: MetricAxis

  /** Detected orientation of the original table (alias for metricAxis). */
  orientation: MetricAxis
}

// ---------------------------------------------------------------------------
// Internal grid cell — carries text + metadata through expansion
// ---------------------------------------------------------------------------

interface GridCell {
  text: string
  isBold: boolean
  isUnderlined: boolean
  isHeader: boolean // <th> element
  domElement: HTMLTableCellElement | null
}

// ---------------------------------------------------------------------------
// 4a. Grid Expansion
// ---------------------------------------------------------------------------

/**
 * Expand an HTML table into a flat 2D grid accounting for rowspan/colspan.
 * Returns the grid and its dimensions.
 */
export function expandGrid(table: HTMLTableElement): {
  grid: (GridCell | null)[][]
  totalRows: number
  totalCols: number
} {
  // Collect only direct <tr> children (skip nested tables)
  const rows = getDirectRows(table)
  if (rows.length === 0) return { grid: [], totalRows: 0, totalCols: 0 }

  // First pass: determine total column count
  let totalCols = 0
  for (const tr of rows) {
    let rowCols = 0
    for (const cell of Array.from(tr.cells)) {
      rowCols += cell.colSpan || 1
    }
    totalCols = Math.max(totalCols, rowCols)
  }

  const totalRows = rows.length
  const grid: (GridCell | null)[][] = Array.from(
    { length: totalRows },
    () => Array(totalCols).fill(null),
  )

  for (let r = 0; r < totalRows; r++) {
    const tr = rows[r]
    const cells = Array.from(tr.cells)
    let cellIdx = 0

    for (const cell of cells) {
      // Find next available column
      while (cellIdx < totalCols && grid[r][cellIdx] !== null) {
        cellIdx++
      }
      if (cellIdx >= totalCols) break

      const rowspan = cell.rowSpan || 1
      const colspan = cell.colSpan || 1
      const text = extractCellText(cell)
      const isBold = detectBold(cell)
      const isUnderlined = detectUnderline(cell)
      const isHeader = cell.tagName.toUpperCase() === 'TH'

      const gcell: GridCell = {
        text,
        isBold,
        isUnderlined,
        isHeader,
        domElement: cell,
      }

      for (let dr = 0; dr < rowspan && r + dr < totalRows; dr++) {
        for (let dc = 0; dc < colspan && cellIdx + dc < totalCols; dc++) {
          // Only the origin cell gets the domElement reference
          const fillCell: GridCell = dr === 0 && dc === 0
            ? gcell
            : { ...gcell, domElement: null }
          grid[r + dr][cellIdx + dc] = fillCell
        }
      }
      cellIdx += colspan
    }
  }

  return { grid, totalRows, totalCols }
}

// ---------------------------------------------------------------------------
// 4b. Header Extraction
// ---------------------------------------------------------------------------

/**
 * Identify header rows (from top) and header columns (from left).
 */
export function detectHeaders(
  grid: (GridCell | null)[][],
  totalRows: number,
  totalCols: number,
): { topNonNumRows: number; leftNonNumCols: number } {
  // Identify non-numeric rows from the top
  let topNonNumRows = 0
  for (let r = 0; r < totalRows; r++) {
    const row = grid[r]
    const allTh = row.every((c) => c === null || c.isHeader)
    const noneNumeric = row.every(
      (c) =>
        c === null ||
        !isNumericString(sanitizeForParse(c.text)),
    )
    if (allTh || noneNumeric) {
      topNonNumRows = r + 1
    } else {
      break
    }
  }

  // Identify non-numeric columns from the left across body rows
  let leftNonNumCols = 0
  for (let c = 0; c < totalCols; c++) {
    let allTh = true
    let noneNumeric = true
    for (let r = topNonNumRows; r < totalRows; r++) {
      const cell = grid[r][c]
      if (cell === null) continue
      if (!cell.isHeader) allTh = false
      if (
        isNumericString(sanitizeForParse(cell.text))
      ) {
        noneNumeric = false
      }
    }
    if (allTh || noneNumeric) {
      leftNonNumCols = c + 1
    } else {
      break
    }
  }

  return { topNonNumRows, leftNonNumCols }
}

/**
 * Flatten multi-level column headers into arrays of label levels.
 * Skips header columns (those become rowNames).
 */
export function flattenColumnHeaders(
  grid: (GridCell | null)[][],
  topNonNumRows: number,
  leftNonNumCols: number,
  totalCols: number,
): string[][] {
  // Pre-compute which header rows are full-span (all data cols identical text).
  // These are group separators, not column-specific labels — skip them.
  const skipRows = new Set<number>()
  for (let r = 0; r < topNonNumRows; r++) {
    const texts: string[] = []
    for (let c = leftNonNumCols; c < totalCols; c++) {
      texts.push(grid[r][c]?.text.trim() ?? '')
    }
    if (texts.length > 1 && texts.every((t) => t === texts[0])) {
      skipRows.add(r)
    }
  }

  const colNames: string[][] = []
  for (let c = leftNonNumCols; c < totalCols; c++) {
    const levels: string[] = []
    let prevText: string | null = null
    for (let r = 0; r < topNonNumRows; r++) {
      if (skipRows.has(r)) continue
      const cell = grid[r][c]
      const text = cell ? cell.text.trim() : ''
      // Deduplicate when a merged cell spans multiple header rows
      if (text && text !== prevText) {
        levels.push(text)
        prevText = text
      }
    }
    colNames.push(levels)
  }
  return colNames
}

/**
 * Extract row names (one level per header column) from body rows.
 */
export function extractRowNames(
  grid: (GridCell | null)[][],
  topNonNumRows: number,
  leftNonNumCols: number,
  totalRows: number,
): string[][] {
  const rowNames: string[][] = []
  for (let r = topNonNumRows; r < totalRows; r++) {
    const levels: string[] = []
    for (let c = 0; c < leftNonNumCols; c++) {
      const cell = grid[r][c]
      levels.push(cell ? cell.text.trim() : '')
    }
    rowNames.push(levels)
  }
  return rowNames
}

// ---------------------------------------------------------------------------
// 4c. Body Extraction & Sanitization
// ---------------------------------------------------------------------------

const SUPERSCRIPT_MAP: Record<string, string> = {
  '⁰': '0',
  '¹': '1',
  '²': '2',
  '³': '3',
  '⁴': '4',
  '⁵': '5',
  '⁶': '6',
  '⁷': '7',
  '⁸': '8',
  '⁹': '9',
  '⁺': '+',
  '⁻': '-',
  '¯': '-',
}

/**
 * Sanitize a raw cell string for numeric parsing.
 * Strips LaTeX, HTML artifacts, special symbols, etc., and normalizes
 * scientific notation into standard `1.23e-4` or `1.23e-4 ± 0.05e-4`.
 */
export function sanitizeForParse(raw: string): string {
  let s = raw
  // Strip zero-width characters (ZWSP, ZWNJ, ZWJ, BOM)
  s = s.replace(/[\u200B-\u200D\uFEFF]/g, '')
  // Replace Unicode minus signs and dashes with ASCII '-'
  s = s.replace(/[\u2212\u2010\u2011\u2012\u2013\u2014]/g, '-')
  // Replace LaTeX non-breaking spaces (~) with standard space
  s = s.replace(/~/g, ' ')

  // Normalize Unicode superscripts: 10⁻⁴ -> 10^{-4}
  s = s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻¯]+/g, (match) => {
    const digits = match
      .split('')
      .map((ch) => SUPERSCRIPT_MAP[ch] ?? ch)
      .join('')
    return `^{${digits}}`
  })

  // Distribute factored variance: (1.23 ± 0.05) × 10^{-4} or (1.23 ± 0.05)e-4 -> 1.23e-4 ± 0.05e-4
  s = s.replace(
    /\(\s*([^±()]+)\s*(?:±|\\pm|&plusmn;|\u00b1)\s*([^±()]+)\s*\)\s*(?:(?:\\times|\\cdot|[×·⋅])\s*10\s*(?:\^\{\s*([+-]?\s*\d+)\s*\}|\^\(?\s*([+-]?\s*\d+)\s*\)?)|[eE]([+-]?\d+))/g,
    (_, val, varVal, exp1, exp2, exp3) => {
      const exp = (exp1 || exp2 || exp3 || '').replace(/\s+/g, '')
      return `${val.trim()}e${exp} ± ${varVal.trim()}e${exp}`
    },
  )

  // Single scientific notation: 1.23 \times 10^{-4} -> 1.23e-4
  s = s.replace(
    /\s*(?:\\times|\\cdot|[×·⋅])\s*10\s*(?:\^\{\s*([+-]?\s*\d+)\s*\}|\^\(?\s*([+-]?\s*\d+)\s*\)?)/g,
    (_, exp1, exp2) => {
      const exp = (exp1 || exp2 || '').replace(/\s+/g, '')
      return `e${exp}`
    },
  )

  // Standalone power of 10: 10^{-4} -> 1e-4
  s = s.replace(
    /(^|[^\d.eE])10\s*(?:\^\{\s*([+-]?\s*\d+)\s*\}|\^\(?\s*([+-]?\s*\d+)\s*\)?)/g,
    (_, prefix, exp1, exp2) => {
      const exp = (exp1 || exp2 || '').replace(/\s+/g, '')
      return `${prefix}1e${exp}`
    },
  )

  // Remove HTML tags (leftover from textContent shouldn't have many, but just in case)
  s = s.replace(/<[^>]+>/g, '')
  // Remove LaTeX formatting commands: \textbf{}, \mathbf{}, \underline{}, etc.
  s = s.replace(
    /\\(?:textbf|mathbf|textit|mathit|underline|textsc|mathrm)\{([^}]*)\}/g,
    '$1',
  )
  // Remove remaining backslash commands without braces
  s = s.replace(/\\[a-zA-Z]+/g, '')
  // Strip wrapping LaTeX math delimiters $…$
  s = s.replace(/\$(.*?)\$/g, '$1')
  // Strip %, ‰, †, ‡ superscript markers
  s = s.replace(/[%‰†‡]/g, '')
  // Collapse whitespace
  s = s.replace(/\s+/g, ' ').trim()
  // Collapse whitespace around scientific 'e' / 'E' (e.g. "1.23 e-4" -> "1.23e-4")
  s = s.replace(/(?<=\d|\.)\s+([eE])/g, '$1')
  // Remove space between sign and number (e.g. "- 0.0297" -> "-0.0297")
  s = s.replace(/([+-])\s+(?=\d)/g, '$1')
  return s
}

/** Matches a valid floating-point number with optional scientific exponent */
const NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/

/**
 * Parse a sanitized string into a value + optional variance.
 */
export function parseNumeric(sanitized: string): {
  value: number | null
  variance?: number
} {
  if (!sanitized) return { value: null }

  // Split on variance separator (±, \pm, etc.)
  const parts = sanitized.split(/\s*(?:±|\\pm|&plusmn;|\u00b1)\s*/)
  if (parts.length > 2) return { value: null }

  if (parts.length === 2) {
    if (NUMBER_RE.test(parts[0]) && NUMBER_RE.test(parts[1])) {
      return {
        value: parseFloat(parts[0]),
        variance: parseFloat(parts[1]),
      }
    }
    return { value: null }
  }

  if (NUMBER_RE.test(parts[0])) {
    return { value: parseFloat(parts[0]) }
  }

  return { value: null }
}

/**
 * Check if a sanitized string parses as a finite number.
 */
export function isNumericString(sanitized: string): boolean {
  const { value } = parseNumeric(sanitized)
  return value !== null && isFinite(value)
}

/**
 * Parse the body of the grid into CellValue[][] and domCells[][].
 * Also filters out separator rows (all-null/empty).
 */
export function extractBody(
  grid: (GridCell | null)[][],
  topNonNumRows: number,
  leftNonNumCols: number,
  totalRows: number,
  totalCols: number,
): {
  data: CellValue[][]
  domCells: HTMLTableCellElement[][]
  keptBodyRowIndices: number[]
} {
  const data: CellValue[][] = []
  const domCells: HTMLTableCellElement[][] = []
  const keptBodyRowIndices: number[] = []

  for (let r = topNonNumRows; r < totalRows; r++) {
    // Check if this is a separator/group-header row
    // A row is a separator if all data cells (non-label columns) are empty/null
    let isSeparator = true
    for (let c = leftNonNumCols; c < totalCols; c++) {
      const cell = grid[r][c]
      if (cell !== null) {
        const sanitized = sanitizeForParse(cell.text)
        if (sanitized && !isMissingMarker(sanitized)) {
          isSeparator = false
          break
        }
      }
    }

    // Also check if it's a sub-group header spanning all columns
    if (!isSeparator) {
      const firstCell = grid[r][0]
      if (firstCell && firstCell.domElement) {
        const cs = firstCell.domElement.colSpan || 1
        if (cs >= totalCols) {
          isSeparator = true
        }
      }
    }

    if (isSeparator) continue

    const dataRow: CellValue[] = []
    const domRow: HTMLTableCellElement[] = []

    for (let c = leftNonNumCols; c < totalCols; c++) {
      const cell = grid[r][c]
      if (cell === null) {
        dataRow.push({ value: null, isHighlighted: false, raw: '' })
        domRow.push(null as unknown as HTMLTableCellElement)
        continue
      }

      const raw = cell.text
      const sanitized = sanitizeForParse(raw)
      const { value, variance } = parseNumeric(sanitized)
      const isHighlighted = cell.isBold || cell.isUnderlined

      const cv: CellValue = { value, isHighlighted, raw }
      if (variance !== undefined) cv.variance = variance
      dataRow.push(cv)
      domRow.push(cell.domElement as HTMLTableCellElement)
    }

    data.push(dataRow)
    domCells.push(domRow)
    keptBodyRowIndices.push(r)
  }

  return { data, domCells, keptBodyRowIndices }
}

// ---------------------------------------------------------------------------
// 4d. Metric Axis (Orientation) Detection
// ---------------------------------------------------------------------------

/**
 * Compute the Coefficient of Variation (CV = std / |mean|) for an array of numbers.
 * Returns null if fewer than 2 numbers.
 */
export function computeSliceCV(vals: number[]): number | null {
  const n = vals.length
  if (n < 2) return null
  const mean = vals.reduce((a, b) => a + b, 0) / n
  const variance = vals.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (n - 1)
  const std = Math.sqrt(variance)

  // Use mean absolute value as scale denominator to avoid division by near-zero on bipolar metrics
  const meanAbs = vals.reduce((sum, v) => sum + Math.abs(v), 0) / n
  const denominator = Math.max(meanAbs, 1e-9)
  return std / denominator
}

/**
 * Compute the median of an array of numbers.
 * Returns null if array is empty.
 */
export function computeMedian(arr: number[]): number | null {
  if (arr.length === 0) return null
  const sorted = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * Detect whether the table's metric axis is column-oriented ('column') or row-oriented ('row').
 *
 * Heuristics:
 * 1. Bold ratio: compute percentage of columns and rows containing at least one bold/highlighted cell.
 *    If the larger ratio > 0.5 (50%) and ratios are not equal, the direction with higher bold ratio is chosen.
 * 2. If no bold decision (neither > 50%, tie, or no bold):
 *    Compute the median coefficient of variation (CV = std / |mean|) across columns and rows
 *    (for slices with >= 2 numeric cells).
 *    The direction with the smaller median CV is chosen (measurements of the same metric cluster closer).
 * 3. Default fallback: 'column'.
 */
export function detectMetricAxis(data: CellValue[][]): MetricAxis {
  const numRows = data.length
  if (numRows === 0) return 'column'
  const numCols = data[0].length
  if (numCols === 0) return 'column'

  // 1. Bold ratio
  let colsWithBold = 0
  for (let c = 0; c < numCols; c++) {
    for (let r = 0; r < numRows; r++) {
      if (data[r][c]?.isHighlighted) {
        colsWithBold++
        break
      }
    }
  }

  let rowsWithBold = 0
  for (let r = 0; r < numRows; r++) {
    for (let c = 0; c < numCols; c++) {
      if (data[r][c]?.isHighlighted) {
        rowsWithBold++
        break
      }
    }
  }

  const pCol = colsWithBold / numCols
  const pRow = rowsWithBold / numRows

  const maxP = Math.max(pCol, pRow)
  if (maxP > 0.5 && pCol !== pRow) {
    return pCol > pRow ? 'column' : 'row'
  }

  // 2. Median Coefficient of Variation (CV)
  const colCVs: number[] = []
  for (let c = 0; c < numCols; c++) {
    const vals: number[] = []
    for (let r = 0; r < numRows; r++) {
      const v = data[r][c]?.value
      if (v !== null && v !== undefined && isFinite(v)) {
        vals.push(v)
      }
    }
    if (vals.length >= 3) {
      const cv = computeSliceCV(vals)
      if (cv !== null) colCVs.push(cv)
    }
  }

  const rowCVs: number[] = []
  for (let r = 0; r < numRows; r++) {
    const vals: number[] = []
    for (let c = 0; c < numCols; c++) {
      const v = data[r][c]?.value
      if (v !== null && v !== undefined && isFinite(v)) {
        vals.push(v)
      }
    }
    if (vals.length >= 3) {
      const cv = computeSliceCV(vals)
      if (cv !== null) rowCVs.push(cv)
    }
  }

  const medianColCV = computeMedian(colCVs)
  const medianRowCV = computeMedian(rowCVs)

  if (
    medianColCV !== null &&
    medianRowCV !== null &&
    medianColCV !== medianRowCV
  ) {
    return medianColCV < medianRowCV ? 'column' : 'row'
  }
  if (medianColCV !== null && medianRowCV === null) {
    return 'column'
  }
  if (medianRowCV !== null && medianColCV === null) {
    return 'row'
  }

  // 3. Fallback
  return 'column'
}

// ---------------------------------------------------------------------------
// Main parse function
// ---------------------------------------------------------------------------

/**
 * Parse an HTML table element into a ParsedTable.
 * Caption will be extracted from figure/container or table if present.
 */
export function parseTable(
  table: HTMLTableElement,
  figure?: HTMLElement,
): ParsedTable {
  // Caption extraction
  let caption: string | null = null
  const container = figure ||
    (table.closest('figure, .ltx_table') as HTMLElement | null) ||
    table.parentElement

  const captionEl = container?.querySelector('figcaption, .ltx_caption') ||
    table.querySelector('caption, .ltx_caption')

  if (captionEl) {
    caption = extractCaption(captionEl.textContent || '')
  }

  // Grid expansion
  const { grid, totalRows, totalCols } = expandGrid(table)

  // Header detection
  const { topNonNumRows, leftNonNumCols } = detectHeaders(
    grid,
    totalRows,
    totalCols,
  )

  // Column headers
  const colNames = flattenColumnHeaders(
    grid,
    topNonNumRows,
    leftNonNumCols,
    totalCols,
  )

  // Body extraction (filters separator rows)
  const { data, domCells, keptBodyRowIndices } = extractBody(
    grid,
    topNonNumRows,
    leftNonNumCols,
    totalRows,
    totalCols,
  )

  // Row names (only from kept body rows)
  const rowNames: string[][] = []
  for (const r of keptBodyRowIndices) {
    const levels: string[] = []
    for (let c = 0; c < leftNonNumCols; c++) {
      const cell = grid[r][c]
      levels.push(cell ? cell.text.trim() : '')
    }
    rowNames.push(levels)
  }

  // Detect metric axis via heuristics (bold ratio -> median CV -> default column)
  const metricAxis = detectMetricAxis(data)

  return {
    caption,
    colNames,
    rowNames,
    topNonNumRows,
    leftNonNumCols,
    data,
    domCells,
    metricAxis,
    orientation: metricAxis,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get direct <tr> children of a table, skipping nested tables. */
function getDirectRows(table: HTMLTableElement): HTMLTableRowElement[] {
  const rows: HTMLTableRowElement[] = []
  // Walk <thead>, <tbody>, <tfoot>, or direct <tr> children
  const sections = table.querySelectorAll(
    ':scope > thead, :scope > tbody, :scope > tfoot',
  )
  if (sections.length > 0) {
    for (const section of Array.from(sections)) {
      const trs = section.querySelectorAll(':scope > tr')
      for (const tr of Array.from(trs)) {
        rows.push(tr as HTMLTableRowElement)
      }
    }
  } else {
    const trs = table.querySelectorAll(':scope > tr')
    for (const tr of Array.from(trs)) {
      rows.push(tr as HTMLTableRowElement)
    }
  }
  return rows
}

/** Extract cleaned text from a cell, ignoring nested tables. */
export function extractCellText(cell: HTMLTableCellElement): string {
  if (!cell) return ''
  // Clone node, remove nested tables, then get textContent
  const clone = cell.cloneNode(true) as HTMLTableCellElement
  for (const nested of Array.from(clone.querySelectorAll('table'))) {
    nested.remove()
  }
  // Also remove <annotation> and <annotation-xml> elements (LaTeX / MathML metadata)
  for (
    const ann of Array.from(
      clone.querySelectorAll('annotation, annotation-xml'),
    )
  ) {
    ann.remove()
  }

  // Preserve <sup> and .ltx_sup exponents
  for (const sup of Array.from(clone.querySelectorAll('sup, .ltx_sup'))) {
    sup.textContent = `^{${sup.textContent || ''}}`
  }

  // Selective alttext: only if it contains scientific/power expressions
  for (const math of Array.from(clone.querySelectorAll('math[alttext]'))) {
    const alt = math.getAttribute('alttext') || ''
    if (
      /(?:\\times|\\cdot|[×·⋅])\s*10\s*\^|10\s*\^\s*\{?\s*[+-]?\s*\d+\s*\}?/
        .test(
          alt,
        )
    ) {
      math.textContent = ` ${alt} `
    }
  }

  return (clone.textContent || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Check if a single DOM element is bold (via tags, classes, or inline style). */
function isBoldElement(el: Element): boolean {
  const tag = el.tagName.toUpperCase()
  if (tag === 'B' || tag === 'STRONG') return true
  if (
    el.classList.contains('ltx_font_bold') ||
    el.classList.contains('bold') ||
    el.classList.contains('fw-bold') ||
    el.classList.contains('font-bold') ||
    el.classList.contains('font-weight-bold')
  ) {
    return true
  }
  const inlineStyle = (el as HTMLElement).style?.fontWeight
  if (inlineStyle) {
    const fw = parseInt(inlineStyle, 10)
    if (!isNaN(fw) && fw >= 600) return true
    if (
      inlineStyle.toLowerCase() === 'bold' ||
      inlineStyle.toLowerCase() === 'bolder'
    ) {
      return true
    }
  }
  return false
}

/** Detect if a cell's content is bold. */
function detectBold(cell: HTMLTableCellElement): boolean {
  if (isBoldElement(cell)) return true

  const allElements = Array.from(cell.querySelectorAll('*'))
  const boldElements = allElements.filter((el) => isBoldElement(el))
  if (boldElements.length > 0) {
    const boldText = boldElements
      .map((el) => el.textContent || '')
      .join('')
    const cellText = extractCellText(cell)
    if (
      boldText.trim() &&
      cellText.trim() &&
      boldText.trim().length >= cellText.trim().length * 0.5
    ) {
      return true
    }
  }
  return false
}

/** Check if a single DOM element is underlined (via tags, classes, or inline style). */
function isUnderlineElement(el: Element): boolean {
  const tag = el.tagName.toUpperCase()
  if (tag === 'U' || tag === 'INS') return true
  if (
    el.classList.contains('ltx_font_underline') ||
    el.classList.contains('underline') ||
    el.classList.contains('text-underline') ||
    el.classList.contains('text-decoration-underline')
  ) {
    return true
  }
  const inlineTd = (el as HTMLElement).style?.textDecoration ||
    (el as HTMLElement).style?.textDecorationLine
  if (inlineTd && inlineTd.toLowerCase().includes('underline')) return true
  return false
}

/** Detect if a cell's content is underlined. */
function detectUnderline(cell: HTMLTableCellElement): boolean {
  if (isUnderlineElement(cell)) return true
  const allElements = Array.from(cell.querySelectorAll('*'))
  return allElements.some((el) => isUnderlineElement(el))
}

/** Check if a value is a missing-data marker. */
function isMissingMarker(sanitized: string): boolean {
  return /^[-–—]$/.test(sanitized) || /^n\/?a$/i.test(sanitized)
}

/**
 * Extract caption text: keep at least 25 characters, break only at
 * whitespace boundaries, then right-trim trailing punctuation.
 */
function extractCaption(raw: string): string {
  const text = raw.replace(/\s+/g, ' ').trim()
  if (text.length <= 25) return text
  // Find the first whitespace at or after position 25
  let cutoff = text.length
  for (let i = 25; i < text.length; i++) {
    if (text[i] === ' ') {
      cutoff = i
      break
    }
  }
  // Right-trim punctuation
  return text.slice(0, cutoff).replace(/[.,;:!?]+$/, '')
}

// ---------------------------------------------------------------------------
// Table Discovery & Classification
// ---------------------------------------------------------------------------

export interface CandidateTable {
  figure?: HTMLElement
  table: HTMLTableElement
  parsed: ParsedTable
  id: string
}

/**
 * Extract a stable table ID from available DOM attributes and content.
 * Resolution order:
 *   1. `table.id` (if non-empty)
 *   2. `figure.id` or container ID (if non-empty)
 *   3. `figcaption` / caption text matching /table\s+(\d+|[a-z0-9.]+)/i
 *   4. Candidate index fallback (`"table-0"`, `"table-1"`, …)
 */
export function extractTableId(
  table: HTMLTableElement,
  figure?: HTMLElement | null,
  figcaption?: HTMLElement | null,
  index?: number,
): string {
  if (table.id) return table.id
  if (figure?.id) return figure.id
  const container = figure || table.closest('figure, .ltx_table')
  if (container?.id) return container.id
  const capEl = figcaption ||
    container?.querySelector('figcaption, .ltx_caption') ||
    table.querySelector('caption, .ltx_caption')
  if (capEl) {
    const text = capEl.textContent || ''
    const m = /table\s+(\d+|[a-z0-9.]+)/i.exec(text)
    if (m) return `table-${m[1].toLowerCase()}`
  }
  return `table-${index ?? 0}`
}

/**
 * Discover all data tables on the page.
 * Supports table.ltx_tabular, tables within figures, and standalone tables.
 * Returns candidate tables that pass the numerical-column filter.
 */
export function discoverTables(
  root: ParentNode = document,
  includeAllIntegerColumns = false,
): CandidateTable[] {
  const candidates: CandidateTable[] = []

  // Query table.ltx_tabular elements, tables inside figures, and standard tables
  const tableElements = Array.from(
    new Set(
      Array.from(
        root.querySelectorAll<HTMLTableElement>(
          'table.ltx_tabular, figure > table, table',
        ),
      ),
    ),
  )

  let candidateIndex = 0
  for (const tableEl of tableElements) {
    // Skip nested inner tables (tables inside cells of another table)
    if (tableEl.parentElement?.closest('table')) continue

    const figure = (tableEl.closest('figure, .ltx_table') ||
      tableEl.parentElement) as HTMLElement | undefined

    const figcaption = (figure?.querySelector('figcaption, .ltx_caption') ||
      tableEl.querySelector('caption, .ltx_caption')) as HTMLElement | undefined

    // Parse the table
    const parsed = parseTable(tableEl, figure)

    // Check numerical column filter: at least one column with ≥ 3 numeric
    // values and not all integers (unless includeAllIntegerColumns is true)
    if (!hasQualifyingNumericColumn(parsed, includeAllIntegerColumns)) continue

    const id = extractTableId(tableEl, figure, figcaption, candidateIndex)
    candidates.push({ figure, table: tableEl, parsed, id })
    candidateIndex++
  }

  return candidates
}

/**
 * Check if all non-null finite numeric values in a column are integers.
 * Returns true if the column contains at least one numeric value and all numeric values are integers.
 */
export function isAllIntegerColumn(
  data: CellValue[][],
  colIndex: number,
): boolean {
  let hasNumeric = false
  for (let r = 0; r < data.length; r++) {
    const cell = data[r][colIndex]
    if (cell && cell.value !== null && isFinite(cell.value)) {
      hasNumeric = true
      if (!Number.isInteger(cell.value)) {
        return false
      }
    }
  }
  return hasNumeric
}

/**
 * Check if all non-null finite numeric values in a row are integers.
 * Returns true if the row contains at least one numeric value and all numeric values are integers.
 */
export function isAllIntegerRow(
  data: CellValue[][],
  rowIndex: number,
): boolean {
  let hasNumeric = false
  const row = data[rowIndex]
  if (!row) return false
  for (let c = 0; c < row.length; c++) {
    const cell = row[c]
    if (cell && cell.value !== null && isFinite(cell.value)) {
      hasNumeric = true
      if (!Number.isInteger(cell.value)) {
        return false
      }
    }
  }
  return hasNumeric
}

/**
 * Check if a parsed table has at least one qualifying numerical column.
 * A column qualifies if it has ≥ 3 numeric values and the numbers are not
 * all integers (unless includeAllIntegerColumns is true).
 */
export function hasQualifyingNumericColumn(
  parsed: ParsedTable,
  includeAllIntegerColumns = false,
): boolean {
  const numCols = parsed.data[0]?.length ?? 0
  for (let c = 0; c < numCols; c++) {
    let numericCount = 0
    let allIntegers = true
    for (let r = 0; r < parsed.data.length; r++) {
      const cell = parsed.data[r][c]
      if (cell.value !== null && isFinite(cell.value)) {
        numericCount++
        if (!Number.isInteger(cell.value)) {
          allIntegers = false
        }
      }
    }
    if (numericCount >= 3 && (includeAllIntegerColumns || !allIntegers)) {
      return true
    }
  }

  // If table is row-oriented, check if any row qualifies (>= 3 values)
  if (parsed.metricAxis === 'row') {
    for (let r = 0; r < parsed.data.length; r++) {
      let numericCount = 0
      let allIntegers = true
      for (let c = 0; c < numCols; c++) {
        const cell = parsed.data[r][c]
        if (cell.value !== null && isFinite(cell.value)) {
          numericCount++
          if (!Number.isInteger(cell.value)) {
            allIntegers = false
          }
        }
      }
      if (numericCount >= 3 && (includeAllIntegerColumns || !allIntegers)) {
        return true
      }
    }
  }

  return false
}

// ---------------------------------------------------------------------------
// UI Injection & Observer
// ---------------------------------------------------------------------------

export type VisualizeCallback = (
  candidate: CandidateTable,
  mode: 'bars' | 'heatmap',
  btn: HTMLButtonElement,
) => void

export type SettingsCallback = (
  candidate: CandidateTable,
  btn: HTMLButtonElement,
) => void

/**
 * Inject rotated emoji button (bars), rainbow flag emoji button (heatmap),
 * and gear button (⚙️ settings) at the bottom-right of each candidate table.
 */
export function injectButtons(
  candidates: CandidateTable[],
  onVisualize: VisualizeCallback,
  onSettings?: SettingsCallback,
): void {
  for (const candidate of candidates) {
    const parent = candidate.table.parentElement
    if (!parent) continue

    // Don't inject twice for the same table
    if (candidate.table.querySelector('.b-a-t-actions')) {
      continue
    }

    const actionsContainer = document.createElement('div')
    actionsContainer.className = 'b-a-t-actions'
    actionsContainer.style.cssText = `
      display: inline-flex;
      gap: 4px;
      padding: 4px 0;
    `

    const commonBtnStyle = `
      cursor: pointer;
      padding: 4px 6px;
      border: 1px solid #ccc;
      border-radius: 4px;
      background: #ffffff;
      font-size: 14px;
      line-height: 1;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      filter: grayscale(100%);
      opacity: 0.5;
      transition: filter 0.2s ease, opacity 0.2s ease, transform 0.1s ease;
    `

    // 1. Bars button (📊 rotated 90deg)
    const barsBtn = document.createElement('button')
    barsBtn.className = 'b-a-t-btn b-a-t-bars-btn inactive'
    barsBtn.title = 'Toggle Bar Chart Overlay'
    barsBtn.innerHTML =
      '<span style="display: inline-block; transform: rotate(90deg);">📊</span>'
    barsBtn.style.cssText = commonBtnStyle
    barsBtn.addEventListener(
      'click',
      () => onVisualize(candidate, 'bars', barsBtn),
    )

    // 2. Heatmap button (🌈 rainbow)
    const heatmapBtn = document.createElement('button')
    heatmapBtn.className = 'b-a-t-btn b-a-t-heatmap-btn inactive'
    heatmapBtn.title = 'Toggle Heatmap Overlay'
    heatmapBtn.innerHTML = '<span style="display: inline-block;">🌈</span>'
    heatmapBtn.style.cssText = commonBtnStyle
    heatmapBtn.addEventListener(
      'click',
      () => onVisualize(candidate, 'heatmap', heatmapBtn),
    )

    actionsContainer.appendChild(barsBtn)
    actionsContainer.appendChild(heatmapBtn)

    // 3. Gear settings button (⚙️)
    if (onSettings) {
      const gearBtn = document.createElement('button')
      gearBtn.className = 'b-a-t-btn b-a-t-gear-btn'
      gearBtn.title = 'Table Settings'
      gearBtn.innerHTML = '<span style="display: inline-block;">⚙️</span>'
      gearBtn.style.cssText = commonBtnStyle
      gearBtn.addEventListener(
        'click',
        () => onSettings(candidate, gearBtn),
      )
      actionsContainer.appendChild(gearBtn)
    }

    // Hover: reveal buttons at full opacity
    actionsContainer.addEventListener('mouseenter', () => {
      for (
        const btn of actionsContainer.querySelectorAll(
          '.b-a-t-btn',
        )
      ) {
        ;(btn as HTMLElement).style.opacity = '1'
        ;(btn as HTMLElement).style.filter = 'none'
      }
    })
    actionsContainer.addEventListener('mouseleave', () => {
      for (
        const btn of actionsContainer.querySelectorAll(
          '.b-a-t-btn',
        )
      ) {
        const isActive = btn.classList.contains('active')
        if (!isActive) {
          ;(btn as HTMLElement).style.opacity = '0.5'
          ;(btn as HTMLElement).style.filter = 'grayscale(100%)'
        }
      }
    })

    let tfoot = candidate.table.querySelector('tfoot')
    if (!tfoot) {
      tfoot = document.createElement('tfoot')
      candidate.table.appendChild(tfoot)
    }

    let maxColSpan = 1
    if (candidate.table.rows.length > 0) {
      let cols = 0
      for (const cell of Array.from(candidate.table.rows[0].cells)) {
        cols += cell.colSpan || 1
      }
      maxColSpan = cols
    }

    const tr = document.createElement('tr')
    tr.style.cssText =
      'border: none !important; background: transparent !important;'

    const td = document.createElement('td')
    td.colSpan = maxColSpan || 100
    td.style.cssText =
      'border: none !important; padding: 0 !important; background: transparent !important; text-align: right !important;'

    td.appendChild(actionsContainer)
    tr.appendChild(td)
    tfoot.appendChild(tr)
  }
}

/**
 * Watch for dynamically injected tables and re-run discovery.
 */
export function observeForNewTables(
  callback: (newCandidates: CandidateTable[]) => void,
  includeAllIntegerColumns = false,
): MutationObserver {
  const observer = new MutationObserver((mutations) => {
    let hasNewTables = false
    for (const mutation of mutations) {
      for (const node of Array.from(mutation.addedNodes)) {
        if (node instanceof HTMLElement) {
          if (node.querySelector('table') || node.tagName === 'TABLE') {
            hasNewTables = true
            break
          }
        }
      }
      if (hasNewTables) break
    }

    if (hasNewTables) {
      const newCandidates = discoverTables(
        document,
        includeAllIntegerColumns,
      ).filter(
        (c) => !c.table.querySelector('.b-a-t-actions'),
      )
      if (newCandidates.length > 0) {
        callback(newCandidates)
      }
    }
  })

  const article = document.querySelector('article') || document.body
  observer.observe(article, { childList: true, subtree: true })

  return observer
}
