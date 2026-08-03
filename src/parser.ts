/**
 * arXiv Table Parser — Phase 4
 *
 * Transforms raw HTML tables (with merged cells, LaTeX artifacts, multi-level
 * headers) into a clean, flat ParsedTable structure suitable for charting.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Orientation of the data in the original table. */
export type Orientation = 'column' | 'row'

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

  /** Detected orientation of the original table. */
  orientation: Orientation
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
      (c) => c === null || !isNumericString(sanitizeForParse(c.text)),
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
      if (isNumericString(sanitizeForParse(cell.text))) noneNumeric = false
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

/**
 * Sanitize a raw cell string for numeric parsing.
 * Strips LaTeX, HTML artifacts, special symbols, etc.
 */
/**
 * Sanitize a raw cell string for numeric parsing.
 * Strips LaTeX, HTML artifacts, special symbols, etc.
 */
export function sanitizeForParse(raw: string): string {
  let s = raw
  // Replace Unicode minus signs and dashes with ASCII '-'
  s = s.replace(/[\u2212\u2010\u2011\u2012\u2013\u2014]/g, '-')
  // Remove HTML tags (leftover from textContent shouldn't have many,
  // but just in case)
  s = s.replace(/<[^>]+>/g, '')
  // Remove LaTeX commands: \textbf{}, \mathbf{}, \underline{}, etc.
  s = s.replace(
    /\\(?:textbf|mathbf|textit|mathit|underline|textsc|mathrm)\{([^}]*)\}/g,
    '$1',
  )
  // Remove remaining backslash commands without braces
  s = s.replace(/\\[a-zA-Z]+/g, '')
  // Strip %, ‰, †, ‡, *, superscript markers
  s = s.replace(/[%‰†‡*]/g, '')
  // Collapse whitespace
  s = s.replace(/\s+/g, ' ').trim()
  // Remove space between sign and number (e.g. "- 0.0297" -> "-0.0297")
  s = s.replace(/([+-])\s+(?=\d)/g, '$1')
  return s
}

/** Regex to parse a numeric value with optional ± variance. */
const NUMERIC_RE =
  /^([+-]?\d+(?:\.\d+)?)\s*(?:±|\\pm|&plusmn;|\u00b1)\s*(\d+(?:\.\d+)?)$/

/** Regex for a plain number (int or float). */
const PLAIN_NUMBER_RE = /^[+-]?\d+(?:\.\d+)?$/

/**
 * Parse a sanitized string into a value + optional variance.
 */
export function parseNumeric(sanitized: string): {
  value: number | null
  variance?: number
} {
  if (!sanitized) return { value: null }

  // Try value ± variance first
  const m = NUMERIC_RE.exec(sanitized)
  if (m) {
    return {
      value: parseFloat(m[1]),
      variance: parseFloat(m[2]),
    }
  }

  // Try plain number
  if (PLAIN_NUMBER_RE.test(sanitized)) {
    return { value: parseFloat(sanitized) }
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

  // Default orientation: column-oriented
  const orientation: Orientation = 'column'

  return {
    caption,
    colNames,
    rowNames,
    topNonNumRows,
    leftNonNumCols,
    data,
    domCells,
    orientation,
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
function extractCellText(cell: HTMLTableCellElement): string {
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
  return (clone.textContent || '').replace(/\s+/g, ' ').trim()
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
export function discoverTables(root: ParentNode = document): CandidateTable[] {
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
    // values and not all integers
    if (!hasQualifyingNumericColumn(parsed)) continue

    const id = extractTableId(tableEl, figure, figcaption, candidateIndex)
    candidates.push({ figure, table: tableEl, parsed, id })
    candidateIndex++
  }

  return candidates
}

/**
 * Check if a parsed table has at least one qualifying numerical column.
 * A column qualifies if it has ≥ 3 numeric values and the numbers are not
 * all integers.
 */
function hasQualifyingNumericColumn(parsed: ParsedTable): boolean {
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
    if (numericCount >= 3 && !allIntegers) {
      return true
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
    if (
      parent.classList.contains('bar-arxiv-table-wrapper') &&
      parent.querySelector(':scope > .arxiv-chart-actions')
    ) {
      continue
    }

    // Wrap table in relative wrapper if not already wrapped
    let wrapper: HTMLElement = parent
    if (!parent.classList.contains('bar-arxiv-table-wrapper')) {
      const div = document.createElement('div')
      div.className = 'bar-arxiv-table-wrapper'
      div.style.cssText =
        'position: relative; display: inline-block; max-width: 100%;'
      candidate.table.parentNode?.insertBefore(div, candidate.table)
      div.appendChild(candidate.table)
      wrapper = div
    } else {
      if (!wrapper.style.position || wrapper.style.position === 'static') {
        wrapper.style.position = 'relative'
      }
    }

    const actionsContainer = document.createElement('div')
    actionsContainer.className = 'arxiv-chart-actions'
    actionsContainer.style.cssText = `
      display: flex;
      gap: 4px;
      padding: 4px 0;
      position: relative;
      width: fit-content;
      margin-left: auto;
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
    barsBtn.className = 'arxiv-chart-btn bars-btn inactive'
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
    heatmapBtn.className = 'arxiv-chart-btn heatmap-btn inactive'
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
      gearBtn.className = 'arxiv-chart-btn gear-btn'
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
      for (const btn of actionsContainer.querySelectorAll('.arxiv-chart-btn')) {
        ;(btn as HTMLElement).style.opacity = '1'
        ;(btn as HTMLElement).style.filter = 'none'
      }
    })
    actionsContainer.addEventListener('mouseleave', () => {
      for (const btn of actionsContainer.querySelectorAll('.arxiv-chart-btn')) {
        const isActive = btn.classList.contains('active')
        if (!isActive) {
          ;(btn as HTMLElement).style.opacity = '0.5'
          ;(btn as HTMLElement).style.filter = 'grayscale(100%)'
        }
      }
    })

    wrapper.appendChild(actionsContainer)
  }
}

/**
 * Watch for dynamically injected tables and re-run discovery.
 */
export function observeForNewTables(
  callback: (newCandidates: CandidateTable[]) => void,
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
      const newCandidates = discoverTables()
      if (newCandidates.length > 0) {
        callback(newCandidates)
      }
    }
  })

  const article = document.querySelector('article') || document.body
  observer.observe(article, { childList: true, subtree: true })

  return observer
}
