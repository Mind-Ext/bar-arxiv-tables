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
export type Orientation = 'column' | 'row';

/** A single parsed numeric cell. */
export interface CellValue {
  value: number | null;    // null = missing / unparseable
  variance?: number;       // from ± notation
  isHighlighted: boolean;  // was bolded / underlined / best-marked
  raw: string;             // original text before sanitization
}

/** The fully parsed, renderer-ready table. */
export interface ParsedTable {
  /** Human-readable caption, if a <caption> or .ltx_caption exists. */
  caption: string | null;

  /**
   * Column names, one per numeric column.
   * Each entry is an array of levels (e.g. ["ImageNet", "Top-1"]).
   */
  colNames: string[][];

  /**
   * Row names (model / method names), extracted from the label column(s).
   * Each entry is an array of levels to support multi-level row headers
   * (e.g. ["ResNet", "ResNet-50"]).
   */
  rowNames: string[][];

  /** Contiguous non-numeric rows from the top of the grid. */
  topNonNumRows: number;

  /** Contiguous non-numeric columns from the left of the grid. */
  leftNonNumCols: number;

  /** Numeric data grid, shape [rows × cols]. */
  data: CellValue[][];

  /** Parallel grid of DOM references, shape [rows × cols]. */
  domCells: HTMLTableCellElement[][];

  /** Detected orientation of the original table. */
  orientation: Orientation;
}

// ---------------------------------------------------------------------------
// Internal grid cell — carries text + metadata through expansion
// ---------------------------------------------------------------------------

interface GridCell {
  text: string;
  isBold: boolean;
  isUnderlined: boolean;
  isHeader: boolean;          // <th> element
  domElement: HTMLTableCellElement | null;
}

// ---------------------------------------------------------------------------
// 4a. Grid Expansion
// ---------------------------------------------------------------------------

/**
 * Expand an HTML table into a flat 2D grid accounting for rowspan/colspan.
 * Returns the grid and its dimensions.
 */
export function expandGrid(table: HTMLTableElement): {
  grid: (GridCell | null)[][];
  totalRows: number;
  totalCols: number;
} {
  // Collect only direct <tr> children (skip nested tables)
  const rows = getDirectRows(table);
  if (rows.length === 0) return { grid: [], totalRows: 0, totalCols: 0 };

  // First pass: determine total column count
  let totalCols = 0;
  for (const tr of rows) {
    let rowCols = 0;
    for (const cell of Array.from(tr.cells)) {
      rowCols += cell.colSpan || 1;
    }
    totalCols = Math.max(totalCols, rowCols);
  }

  const totalRows = rows.length;
  const grid: (GridCell | null)[][] = Array.from({ length: totalRows }, () =>
    Array(totalCols).fill(null),
  );

  for (let r = 0; r < totalRows; r++) {
    const tr = rows[r];
    const cells = Array.from(tr.cells);
    let cellIdx = 0;

    for (const cell of cells) {
      // Find next available column
      while (cellIdx < totalCols && grid[r][cellIdx] !== null) {
        cellIdx++;
      }
      if (cellIdx >= totalCols) break;

      const rowspan = cell.rowSpan || 1;
      const colspan = cell.colSpan || 1;
      const text = extractCellText(cell);
      const isBold = detectBold(cell);
      const isUnderlined = detectUnderline(cell);
      const isHeader = cell.tagName.toUpperCase() === 'TH';

      const gcell: GridCell = {
        text,
        isBold,
        isUnderlined,
        isHeader,
        domElement: cell,
      };

      for (let dr = 0; dr < rowspan && r + dr < totalRows; dr++) {
        for (let dc = 0; dc < colspan && cellIdx + dc < totalCols; dc++) {
          // Only the origin cell gets the domElement reference
          const fillCell: GridCell =
            dr === 0 && dc === 0
              ? gcell
              : { ...gcell, domElement: null };
          grid[r + dr][cellIdx + dc] = fillCell;
        }
      }
      cellIdx += colspan;
    }
  }

  return { grid, totalRows, totalCols };
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
  let topNonNumRows = 0;
  for (let r = 0; r < totalRows; r++) {
    const row = grid[r];
    const allTh = row.every((c) => c === null || c.isHeader);
    const noneNumeric = row.every(
      (c) => c === null || !isNumericString(sanitizeForParse(c.text)),
    );
    if (allTh || noneNumeric) {
      topNonNumRows = r + 1;
    } else {
      break;
    }
  }

  // Identify non-numeric columns from the left across body rows
  let leftNonNumCols = 0;
  for (let c = 0; c < totalCols; c++) {
    let allTh = true;
    let noneNumeric = true;
    for (let r = topNonNumRows; r < totalRows; r++) {
      const cell = grid[r][c];
      if (cell === null) continue;
      if (!cell.isHeader) allTh = false;
      if (isNumericString(sanitizeForParse(cell.text))) noneNumeric = false;
    }
    if (allTh || noneNumeric) {
      leftNonNumCols = c + 1;
    } else {
      break;
    }
  }

  return { topNonNumRows, leftNonNumCols };
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
  const skipRows = new Set<number>();
  for (let r = 0; r < topNonNumRows; r++) {
    const texts: string[] = [];
    for (let c = leftNonNumCols; c < totalCols; c++) {
      texts.push(grid[r][c]?.text.trim() ?? '');
    }
    if (texts.length > 1 && texts.every((t) => t === texts[0])) {
      skipRows.add(r);
    }
  }

  const colNames: string[][] = [];
  for (let c = leftNonNumCols; c < totalCols; c++) {
    const levels: string[] = [];
    let prevText: string | null = null;
    for (let r = 0; r < topNonNumRows; r++) {
      if (skipRows.has(r)) continue;
      const cell = grid[r][c];
      const text = cell ? cell.text.trim() : '';
      // Deduplicate when a merged cell spans multiple header rows
      if (text && text !== prevText) {
        levels.push(text);
        prevText = text;
      }
    }
    colNames.push(levels);
  }
  return colNames;
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
  const rowNames: string[][] = [];
  for (let r = topNonNumRows; r < totalRows; r++) {
    const levels: string[] = [];
    for (let c = 0; c < leftNonNumCols; c++) {
      const cell = grid[r][c];
      levels.push(cell ? cell.text.trim() : '');
    }
    rowNames.push(levels);
  }
  return rowNames;
}

// ---------------------------------------------------------------------------
// 4c. Body Extraction & Sanitization
// ---------------------------------------------------------------------------

/**
 * Sanitize a raw cell string for numeric parsing.
 * Strips LaTeX, HTML artifacts, special symbols, etc.
 */
export function sanitizeForParse(raw: string): string {
  let s = raw;
  // Remove HTML tags (leftover from textContent shouldn't have many,
  // but just in case)
  s = s.replace(/<[^>]+>/g, '');
  // Remove LaTeX commands: \textbf{}, \mathbf{}, \underline{}, etc.
  s = s.replace(/\\(?:textbf|mathbf|textit|mathit|underline|textsc|mathrm)\{([^}]*)\}/g, '$1');
  // Remove remaining backslash commands without braces
  s = s.replace(/\\[a-zA-Z]+/g, '');
  // Strip %, ‰, †, ‡, *, superscript markers
  s = s.replace(/[%‰†‡*]/g, '');
  // Collapse whitespace
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/** Regex to parse a numeric value with optional ± variance. */
const NUMERIC_RE =
  /^([+-]?\d+(?:\.\d+)?)\s*(?:±|\\pm|&plusmn;|\u00b1)\s*(\d+(?:\.\d+)?)$/;

/** Regex for a plain number (int or float). */
const PLAIN_NUMBER_RE = /^[+-]?\d+(?:\.\d+)?$/;

/**
 * Parse a sanitized string into a value + optional variance.
 */
export function parseNumeric(sanitized: string): {
  value: number | null;
  variance?: number;
} {
  if (!sanitized) return { value: null };

  // Try value ± variance first
  const m = NUMERIC_RE.exec(sanitized);
  if (m) {
    return {
      value: parseFloat(m[1]),
      variance: parseFloat(m[2]),
    };
  }

  // Try plain number
  if (PLAIN_NUMBER_RE.test(sanitized)) {
    return { value: parseFloat(sanitized) };
  }

  return { value: null };
}

/**
 * Check if a sanitized string parses as a finite number.
 */
export function isNumericString(sanitized: string): boolean {
  const { value } = parseNumeric(sanitized);
  return value !== null && isFinite(value);
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
  data: CellValue[][];
  domCells: HTMLTableCellElement[][];
  keptBodyRowIndices: number[];
} {
  const data: CellValue[][] = [];
  const domCells: HTMLTableCellElement[][] = [];
  const keptBodyRowIndices: number[] = [];

  for (let r = topNonNumRows; r < totalRows; r++) {
    // Check if this is a separator/group-header row
    // A row is a separator if all data cells (non-label columns) are empty/null
    let isSeparator = true;
    for (let c = leftNonNumCols; c < totalCols; c++) {
      const cell = grid[r][c];
      if (cell !== null) {
        const sanitized = sanitizeForParse(cell.text);
        if (sanitized && !isMissingMarker(sanitized)) {
          isSeparator = false;
          break;
        }
      }
    }

    // Also check if it's a sub-group header spanning all columns
    if (!isSeparator) {
      const firstCell = grid[r][0];
      if (firstCell && firstCell.domElement) {
        const cs = firstCell.domElement.colSpan || 1;
        if (cs >= totalCols) {
          isSeparator = true;
        }
      }
    }

    if (isSeparator) continue;

    const dataRow: CellValue[] = [];
    const domRow: HTMLTableCellElement[] = [];

    for (let c = leftNonNumCols; c < totalCols; c++) {
      const cell = grid[r][c];
      if (cell === null) {
        dataRow.push({ value: null, isHighlighted: false, raw: '' });
        domRow.push(null as unknown as HTMLTableCellElement);
        continue;
      }

      const raw = cell.text;
      const sanitized = sanitizeForParse(raw);
      const { value, variance } = parseNumeric(sanitized);
      const isHighlighted = cell.isBold || cell.isUnderlined;

      const cv: CellValue = { value, isHighlighted, raw };
      if (variance !== undefined) cv.variance = variance;
      dataRow.push(cv);
      domRow.push(cell.domElement as HTMLTableCellElement);
    }

    data.push(dataRow);
    domCells.push(domRow);
    keptBodyRowIndices.push(r);
  }

  return { data, domCells, keptBodyRowIndices };
}

// ---------------------------------------------------------------------------
// Main parse function
// ---------------------------------------------------------------------------

/**
 * Parse an HTML table element into a ParsedTable.
 * The table must be inside a <figure> with a <figcaption>.
 */
export function parseTable(
  table: HTMLTableElement,
  figure?: HTMLElement,
): ParsedTable {
  // Caption extraction
  let caption: string | null = null;
  if (figure) {
    const figcaption = figure.querySelector('figcaption');
    if (figcaption) {
      caption = extractCaption(figcaption.textContent || '');
    }
  }

  // Grid expansion
  const { grid, totalRows, totalCols } = expandGrid(table);

  // Header detection
  const { topNonNumRows, leftNonNumCols } = detectHeaders(
    grid,
    totalRows,
    totalCols,
  );

  // Column headers
  const colNames = flattenColumnHeaders(
    grid,
    topNonNumRows,
    leftNonNumCols,
    totalCols,
  );

  // Body extraction (filters separator rows)
  const { data, domCells, keptBodyRowIndices } = extractBody(
    grid,
    topNonNumRows,
    leftNonNumCols,
    totalRows,
    totalCols,
  );

  // Row names (only from kept body rows)
  const rowNames: string[][] = [];
  for (const r of keptBodyRowIndices) {
    const levels: string[] = [];
    for (let c = 0; c < leftNonNumCols; c++) {
      const cell = grid[r][c];
      levels.push(cell ? cell.text.trim() : '');
    }
    rowNames.push(levels);
  }

  // Default orientation: column-oriented
  const orientation: Orientation = 'column';

  return {
    caption,
    colNames,
    rowNames,
    topNonNumRows,
    leftNonNumCols,
    data,
    domCells,
    orientation,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get direct <tr> children of a table, skipping nested tables. */
function getDirectRows(table: HTMLTableElement): HTMLTableRowElement[] {
  const rows: HTMLTableRowElement[] = [];
  // Walk <thead>, <tbody>, <tfoot>, or direct <tr> children
  const sections = table.querySelectorAll(':scope > thead, :scope > tbody, :scope > tfoot');
  if (sections.length > 0) {
    for (const section of Array.from(sections)) {
      const trs = section.querySelectorAll(':scope > tr');
      for (const tr of Array.from(trs)) {
        rows.push(tr as HTMLTableRowElement);
      }
    }
  } else {
    const trs = table.querySelectorAll(':scope > tr');
    for (const tr of Array.from(trs)) {
      rows.push(tr as HTMLTableRowElement);
    }
  }
  return rows;
}

/** Extract cleaned text from a cell, ignoring nested tables. */
function extractCellText(cell: HTMLTableCellElement): string {
  // Clone node, remove nested tables, then get textContent
  const clone = cell.cloneNode(true) as HTMLTableCellElement;
  for (const nested of Array.from(clone.querySelectorAll('table'))) {
    nested.remove();
  }
  // Also remove <annotation> elements (LaTeX source)
  for (const ann of Array.from(clone.querySelectorAll('annotation'))) {
    ann.remove();
  }
  return (clone.textContent || '').replace(/\s+/g, ' ').trim();
}

/** Detect if a cell's content is bold. */
function detectBold(cell: HTMLTableCellElement): boolean {
  // Check direct wrapping in <b>, <strong>
  if (cell.querySelector(':scope > b, :scope > strong')) return true;
  if (cell.querySelector(':scope > span.ltx_text.ltx_font_bold')) return true;
  // Check if the cell itself has bold class
  if (cell.classList.contains('ltx_font_bold')) return true;
  // Check all child spans
  const spans = cell.querySelectorAll('span.ltx_font_bold, span.ltx_text.ltx_font_bold');
  if (spans.length > 0) {
    // Verify the bold span wraps the main content (not just a label)
    const boldText = Array.from(spans)
      .map((s) => s.textContent || '')
      .join('');
    const cellText = extractCellText(cell);
    // Bold if the bold spans cover most of the cell content
    if (boldText.trim() && cellText.trim() && boldText.trim().length >= cellText.trim().length * 0.5) {
      return true;
    }
  }
  return false;
}

/** Detect if a cell's content is underlined. */
function detectUnderline(cell: HTMLTableCellElement): boolean {
  if (cell.querySelector(':scope > u')) return true;
  if (cell.querySelector('span.ltx_font_underline')) return true;
  return false;
}

/** Check if a value is a missing-data marker. */
function isMissingMarker(sanitized: string): boolean {
  return /^[-–—]$/.test(sanitized) || /^n\/?a$/i.test(sanitized);
}

/**
 * Extract caption text: keep at least 25 characters, break only at
 * whitespace boundaries, then right-trim trailing punctuation.
 */
function extractCaption(raw: string): string {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (text.length <= 25) return text;
  // Find the first whitespace at or after position 25
  let cutoff = text.length;
  for (let i = 25; i < text.length; i++) {
    if (text[i] === ' ') {
      cutoff = i;
      break;
    }
  }
  // Right-trim punctuation
  return text.slice(0, cutoff).replace(/[.,;:!?]+$/, '');
}

// ---------------------------------------------------------------------------
// Table Discovery & Classification
// ---------------------------------------------------------------------------

export interface CandidateTable {
  figure: HTMLElement;
  table: HTMLTableElement;
  parsed: ParsedTable;
}

/**
 * Discover all data tables on the page.
 * Returns candidate tables that pass the numerical-column filter.
 */
export function discoverTables(root: ParentNode = document): CandidateTable[] {
  const candidates: CandidateTable[] = [];

  // Query all tables inside <figure> elements
  const tables = root.querySelectorAll('figure > table');

  for (const table of Array.from(tables)) {
    const figure = table.parentElement;
    if (!figure) continue;

    // Must have a figcaption
    const figcaption = figure.querySelector('figcaption');
    if (!figcaption) continue;

    const tableEl = table as HTMLTableElement;

    // Parse the table
    const parsed = parseTable(tableEl, figure);

    // Check numerical column filter: at least one column with ≥ 3 numeric
    // values and not all integers
    if (!hasQualifyingNumericColumn(parsed)) continue;

    candidates.push({ figure, table: tableEl, parsed });
  }

  return candidates;
}

/**
 * Check if a parsed table has at least one qualifying numerical column.
 * A column qualifies if it has ≥ 3 numeric values and the numbers are not
 * all integers.
 */
function hasQualifyingNumericColumn(parsed: ParsedTable): boolean {
  const numCols = parsed.data[0]?.length ?? 0;
  for (let c = 0; c < numCols; c++) {
    let numericCount = 0;
    let allIntegers = true;
    for (let r = 0; r < parsed.data.length; r++) {
      const cell = parsed.data[r][c];
      if (cell.value !== null && isFinite(cell.value)) {
        numericCount++;
        if (!Number.isInteger(cell.value)) {
          allIntegers = false;
        }
      }
    }
    if (numericCount >= 3 && !allIntegers) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// UI Injection & Observer
// ---------------------------------------------------------------------------

type VisualizeCallback = (candidate: CandidateTable, button: HTMLButtonElement) => void;

/**
 * Inject rotated emoji buttons at the bottom-right of each candidate table.
 */
export function injectButtons(
  candidates: CandidateTable[],
  onVisualize: VisualizeCallback,
): void {
  for (const candidate of candidates) {
    const parent = candidate.table.parentElement;
    if (!parent) continue;

    // Don't inject twice
    if (parent.querySelector('.arxiv-chart-btn')) continue;

    // Wrap table in relative wrapper if not already wrapped
    let wrapper: HTMLElement = parent;
    if (!parent.classList.contains('arxiv-chart-wrapper')) {
      const div = document.createElement('div');
      div.className = 'arxiv-chart-wrapper';
      div.style.cssText = 'position: relative; display: inline-block; max-width: 100%;';
      candidate.table.parentNode?.insertBefore(div, candidate.table);
      div.appendChild(candidate.table);
      wrapper = div;
    } else {
      if (getComputedStyle(wrapper).position === 'static') {
        wrapper.style.position = 'relative';
      }
    }

    const btn = document.createElement('button');
    btn.className = 'arxiv-chart-btn inactive';
    btn.title = 'Toggle Chart Bars';
    btn.innerHTML = '<span style="display: inline-block; transform: rotate(90deg);">📊</span>';
    btn.style.cssText = `
      position: absolute;
      bottom: 8px;
      right: 8px;
      z-index: 10;
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
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.15);
      filter: grayscale(100%);
      transition: filter 0.2s ease, transform 0.1s ease;
    `;

    btn.addEventListener('click', () => onVisualize(candidate, btn));
    wrapper.appendChild(btn);
  }
}

/**
 * Watch for dynamically injected tables and re-run discovery.
 */
export function observeForNewTables(
  callback: (newCandidates: CandidateTable[]) => void,
): MutationObserver {
  const observer = new MutationObserver((mutations) => {
    let hasNewTables = false;
    for (const mutation of mutations) {
      for (const node of Array.from(mutation.addedNodes)) {
        if (node instanceof HTMLElement) {
          if (node.querySelector('table') || node.tagName === 'TABLE') {
            hasNewTables = true;
            break;
          }
        }
      }
      if (hasNewTables) break;
    }

    if (hasNewTables) {
      const newCandidates = discoverTables();
      if (newCandidates.length > 0) {
        callback(newCandidates);
      }
    }
  });

  const article = document.querySelector('article') || document.body;
  observer.observe(article, { childList: true, subtree: true });

  return observer;
}

