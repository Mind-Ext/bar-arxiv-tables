/**
 * Parameterized fixture tests for the arXiv table parser.
 *
 * Loops over all *.html files in tests/fixtures/, loads the paired
 * .expected.json (if it exists), and asserts parser output matches.
 */

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { JSDOM } from 'jsdom'
import {
  CellValue,
  discoverTables,
  expandGrid,
  extractCellText,
  hasQualifyingNumericColumn,
  isAllIntegerColumn,
  ParsedTable,
  parseNumeric,
  parseTable,
  sanitizeForParse,
} from '../src/parser'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXTURES_DIR = join(__dirname, 'fixtures')

interface ExpectedMetric {
  colName?: string[]
  rowName?: string[]
  min?: number
  max?: number
  nullCount?: number
  highlightedCount?: number
  hasSd?: boolean
}

interface ExpectedOutput {
  caption: string | null
  orientation: 'column' | 'row'
  totalRowCount: number
  totalColCount: number
  topNonNumRows: number
  leftNonNumCols: number
  metrics: ExpectedMetric[]
}

function loadFixture(htmlPath: string): { dom: JSDOM; html: string } {
  const html = readFileSync(htmlPath, 'utf-8')
  const dom = new JSDOM(html)
  return { dom, html }
}

function computeMetricStats(data: CellValue[][], colIndex: number) {
  let min = Infinity
  let max = -Infinity
  let nullCount = 0
  let highlightedCount = 0
  let hasSd = false

  for (let r = 0; r < data.length; r++) {
    const cell = data[r][colIndex]
    if (cell.value === null) {
      nullCount++
    } else {
      if (cell.value < min) min = cell.value
      if (cell.value > max) max = cell.value
    }
    if (cell.isHighlighted) highlightedCount++
    if (cell.variance !== undefined) hasSd = true
  }

  return { min, max, nullCount, highlightedCount, hasSd }
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

const htmlFiles = readdirSync(FIXTURES_DIR)
  .filter((f) => f.endsWith('.html'))
  .sort()

describe('Fixture-based parser tests', () => {
  for (const htmlFile of htmlFiles) {
    const baseName = htmlFile.replace('.html', '')
    const htmlPath = join(FIXTURES_DIR, htmlFile)
    const expectedPath = join(FIXTURES_DIR, `${baseName}.expected.json`)

    let hasExpected = false
    try {
      readFileSync(expectedPath)
      hasExpected = true
    } catch {
      hasExpected = false
    }

    if (!hasExpected) {
      // Rejection test: table should not be discovered
      it(`${baseName}: should be rejected (no .expected.json)`, () => {
        const { dom } = loadFixture(htmlPath)
        const candidates = discoverTables(dom.window.document)
        expect(candidates).toHaveLength(0)
      })
    } else {
      // Parser test
      describe(`${baseName}`, () => {
        const { dom } = loadFixture(htmlPath)
        const expected: ExpectedOutput = JSON.parse(
          readFileSync(expectedPath, 'utf-8'),
        )

        // Find the table and optional figure wrapper
        const table = dom.window.document.querySelector(
          'table',
        ) as HTMLTableElement
        const figure = (table?.closest('figure') ||
          undefined) as HTMLElement | undefined

        // Expand grid
        const { grid, totalRows, totalCols } = expandGrid(table)

        // Parse
        const parsed = parseTable(table, figure)

        it('discovers table via discoverTables', () => {
          const candidates = discoverTables(dom.window.document)
          expect(candidates.length).toBeGreaterThanOrEqual(1)
        })

        it('grid dimensions match', () => {
          expect(totalRows).toBe(expected.totalRowCount)
          expect(totalCols).toBe(expected.totalColCount)
        })

        it('topNonNumRows matches', () => {
          expect(parsed.topNonNumRows).toBe(expected.topNonNumRows)
        })

        it('leftNonNumCols matches', () => {
          expect(parsed.leftNonNumCols).toBe(expected.leftNonNumCols)
        })

        it('orientation matches', () => {
          expect(parsed.orientation).toBe(expected.orientation)
        })

        it('caption matches', () => {
          if (expected.caption !== null) {
            expect(parsed.caption).toBe(expected.caption)
          } else {
            expect(parsed.caption).toBeNull()
          }
        })

        it('metric count matches', () => {
          expect(parsed.colNames).toHaveLength(expected.metrics.length)
        })

        for (let m = 0; m < expected.metrics.length; m++) {
          const metric = expected.metrics[m]
          const nameKey = metric.colName ? 'colName' : 'rowName'
          const expectedName = metric.colName || metric.rowName || []

          describe(`metric[${m}] "${expectedName.join(' → ')}"`, () => {
            it('name matches', () => {
              expect(parsed.colNames[m]).toEqual(expectedName)
            })

            if (metric.min !== undefined) {
              it('min matches', () => {
                const stats = computeMetricStats(parsed.data, m)
                expect(stats.min).toBeCloseTo(metric.min!, 5)
              })
            }

            if (metric.max !== undefined) {
              it('max matches', () => {
                const stats = computeMetricStats(parsed.data, m)
                expect(stats.max).toBeCloseTo(metric.max!, 5)
              })
            }

            if (metric.nullCount !== undefined) {
              it('nullCount matches', () => {
                const stats = computeMetricStats(parsed.data, m)
                expect(stats.nullCount).toBe(metric.nullCount)
              })
            }

            if (metric.highlightedCount !== undefined) {
              it('highlightedCount matches', () => {
                const stats = computeMetricStats(parsed.data, m)
                expect(stats.highlightedCount).toBe(metric.highlightedCount)
              })
            }

            if (metric.hasSd !== undefined) {
              it('hasSd matches', () => {
                const stats = computeMetricStats(parsed.data, m)
                expect(stats.hasSd).toBe(metric.hasSd)
              })
            }
          })
        }
      })
    }
  }
})

describe('enhanced style detection (bold / underline)', () => {
  it('detects bold from inline styles and classes', () => {
    const html = `
      <table>
        <thead><tr><th>Model</th><th>Score</th></tr></thead>
        <tbody>
          <tr><td>A</td><td style="font-weight: 700">95.0</td></tr>
          <tr><td>B</td><td class="fw-bold">92.1</td></tr>
          <tr><td>C</td><td><span style="font-weight: bold">90.5</span></td></tr>
        </tbody>
      </table>
    `
    const dom = new JSDOM(html)
    const table = dom.window.document.querySelector('table') as HTMLTableElement
    const parsed = parseTable(table)
    expect(parsed.data[0][0].isHighlighted).toBe(true)
    expect(parsed.data[1][0].isHighlighted).toBe(true)
    expect(parsed.data[2][0].isHighlighted).toBe(true)
  })

  it('detects underline from tags, classes, and inline styles', () => {
    const html = `
      <table>
        <thead><tr><th>Model</th><th>Score</th></tr></thead>
        <tbody>
          <tr><td>A</td><td><ins>95.0</ins></td></tr>
          <tr><td>B</td><td class="text-underline">92.1</td></tr>
          <tr><td>C</td><td style="text-decoration: underline">90.5</td></tr>
        </tbody>
      </table>
    `
    const dom = new JSDOM(html)
    const table = dom.window.document.querySelector('table') as HTMLTableElement
    const parsed = parseTable(table)
    expect(parsed.data[0][0].isHighlighted).toBe(true)
    expect(parsed.data[1][0].isHighlighted).toBe(true)
    expect(parsed.data[2][0].isHighlighted).toBe(true)
  })
})

describe('isAllIntegerColumn helper', () => {
  it('returns true when all numeric cells in a column are integers', () => {
    const data: CellValue[][] = [
      [{ value: 1, isHighlighted: false, raw: '1' }],
      [{ value: 20, isHighlighted: false, raw: '20' }],
      [{ value: 300, isHighlighted: false, raw: '300' }],
    ]
    expect(isAllIntegerColumn(data, 0)).toBe(true)
  })

  it('returns false when at least one numeric cell is a float', () => {
    const data: CellValue[][] = [
      [{ value: 1, isHighlighted: false, raw: '1' }],
      [{ value: 2.5, isHighlighted: false, raw: '2.5' }],
      [{ value: 300, isHighlighted: false, raw: '300' }],
    ]
    expect(isAllIntegerColumn(data, 0)).toBe(false)
  })

  it('ignores null values and returns true if remaining values are integers', () => {
    const data: CellValue[][] = [
      [{ value: null, isHighlighted: false, raw: '' }],
      [{ value: 5, isHighlighted: false, raw: '5' }],
      [{ value: 10, isHighlighted: false, raw: '10' }],
    ]
    expect(isAllIntegerColumn(data, 0)).toBe(true)
  })

  it('returns false if column has no numeric values', () => {
    const data: CellValue[][] = [
      [{ value: null, isHighlighted: false, raw: '' }],
      [{ value: null, isHighlighted: false, raw: '' }],
    ]
    expect(isAllIntegerColumn(data, 0)).toBe(false)
  })
})

describe('discoverTables with includeAllIntegerColumns flag', () => {
  const pureIntegerHtml = `
    <table>
      <thead><tr><th>A</th><th>B</th></tr></thead>
      <tbody>
        <tr><td>1</td><td>10</td></tr>
        <tr><td>2</td><td>20</td></tr>
        <tr><td>3</td><td>30</td></tr>
      </tbody>
    </table>
  `

  it('rejects pure-integer table when includeAllIntegerColumns is false (default)', () => {
    const dom = new JSDOM(pureIntegerHtml)
    const candidates = discoverTables(dom.window.document, false)
    expect(candidates).toHaveLength(0)
  })

  it('discovers pure-integer table when includeAllIntegerColumns is true', () => {
    const dom = new JSDOM(pureIntegerHtml)
    const candidates = discoverTables(dom.window.document, true)
    expect(candidates).toHaveLength(1)
  })
})

describe('zero-width character removal', () => {
  it('strips zero-width characters in sanitizeForParse and table headers', () => {
    expect(sanitizeForParse('P\u200Bd\u200Cr\u200Do\u200Bp')).toBe('Pdrop')
    expect(sanitizeForParse('9\u200B5\uFEFF.2')).toBe('95.2')

    const html = `
      <table>
        <thead><tr><th>P\u200Bd\u200Cr\u200Do\u200Bp</th></tr></thead>
        <tbody>
          <tr><td>0.1</td></tr>
          <tr><td>0.2</td></tr>
          <tr><td>0.3</td></tr>
        </tbody>
      </table>
    `
    const dom = new JSDOM(html)
    const table = dom.window.document.querySelector('table') as HTMLTableElement
    const parsed = parseTable(table)
    expect(parsed.colNames[0]).toEqual(['Pdrop'])
  })
})

describe('Scientific notation sanitization (sanitizeForParse)', () => {
  it('normalizes standard e-notation and signs', () => {
    expect(sanitizeForParse('1.23e-4')).toBe('1.23e-4')
    expect(sanitizeForParse('5E+3')).toBe('5E+3')
    expect(sanitizeForParse('-1.5e-2')).toBe('-1.5e-2')
  })

  it('normalizes LaTeX \\times and \\cdot scientific notation', () => {
    expect(sanitizeForParse('1.23 \\times 10^{-4}')).toBe('1.23e-4')
    expect(sanitizeForParse('1.23 \\times 10^{ -4 }')).toBe('1.23e-4')
    expect(sanitizeForParse('2.5 \\cdot 10^{3}')).toBe('2.5e3')
    expect(sanitizeForParse('3.14 \\times 10^2')).toBe('3.14e2')
  })

  it('normalizes Unicode multiplication operators and superscripts', () => {
    expect(sanitizeForParse('1.23 × 10⁻⁴')).toBe('1.23e-4')
    expect(sanitizeForParse('2.5 · 10³')).toBe('2.5e3')
    expect(sanitizeForParse('4.2 ⋅ 10⁺⁵')).toBe('4.2e+5')
  })

  it('normalizes standalone powers of 10 without mantissa', () => {
    expect(sanitizeForParse('10^{-5}')).toBe('1e-5')
    expect(sanitizeForParse('10^4')).toBe('1e4')
    expect(sanitizeForParse('10⁻⁵')).toBe('1e-5')
    expect(sanitizeForParse('-10^{-3}')).toBe('-1e-3')
  })

  it('distributes factored variance notation', () => {
    expect(sanitizeForParse('(1.23 ± 0.05) \\times 10^{-4}')).toBe(
      '1.23e-4 ± 0.05e-4',
    )
    expect(sanitizeForParse('(1.23 ± 0.05) × 10⁻⁴')).toBe('1.23e-4 ± 0.05e-4')
    expect(sanitizeForParse('(1.23 \\pm 0.05) \\cdot 10^{3}')).toBe(
      '1.23e3 ± 0.05e3',
    )
    expect(sanitizeForParse('(1.23 ± 0.05)e-4')).toBe('1.23e-4 ± 0.05e-4')
    expect(sanitizeForParse('(1.23 ± 0.05)E+3')).toBe('1.23e+3 ± 0.05e+3')
  })

  it('strips LaTeX math delimiters $, ~, and text styles around scientific notation', () => {
    expect(sanitizeForParse('$1.23 \\times 10^{-4}$')).toBe('1.23e-4')
    expect(sanitizeForParse('1.23~\\times~10^{-4}')).toBe('1.23e-4')
    expect(sanitizeForParse('\\mathbf{1.23 \\times 10^{-4}}')).toBe('1.23e-4')
  })
})

describe('Scientific notation numeric parsing (parseNumeric)', () => {
  it('parses scientific notation', () => {
    expect(parseNumeric('1.23e-4')).toEqual({ value: 0.000123 })
    expect(parseNumeric('1e-5')).toEqual({ value: 0.00001 })
    expect(parseNumeric('5E+3')).toEqual({ value: 5000 })
    expect(parseNumeric('-1.5e-2')).toEqual({ value: -0.015 })
  })

  it('parses standard numbers', () => {
    expect(parseNumeric('1.23')).toEqual({ value: 1.23 })
    expect(parseNumeric('1.23 ± 0.05')).toEqual({
      value: 1.23,
      variance: 0.05,
    })
    expect(parseNumeric('-45.6')).toEqual({ value: -45.6 })
  })

  it('parses scientific notation with variance', () => {
    const result = parseNumeric('1.23e-4 ± 0.02e-4')
    expect(result.value).toBeCloseTo(0.000123, 8)
    expect(result.variance).toBeCloseTo(0.000002, 8)
  })
})

describe('DOM cell text extraction (extractCellText)', () => {
  it('converts <sup> elements to ^{...}', () => {
    const dom = new JSDOM(
      '<table><tr><td>1.23 × 10<sup>-4</sup></td></tr></table>',
    )
    const cell = dom.window.document.querySelector('td') as HTMLTableCellElement
    expect(extractCellText(cell)).toBe('1.23 × 10^{-4}')
  })

  it('selectively replaces math[alttext] when containing exponent expressions', () => {
    const dom = new JSDOM(
      '<table><tr><td><math alttext="1.23 \\times 10^{-4}"><mrow>...</mrow></math></td></tr></table>',
    )
    const cell = dom.window.document.querySelector('td') as HTMLTableCellElement
    expect(extractCellText(cell)).toBe('1.23 \\times 10^{-4}')
  })

  it('preserves non-exponent math content without corrupting labels like d_model', () => {
    const dom = new JSDOM(
      '<table><tr><th><math alttext="d_{\\text{model}}"><span>d</span><sub>model</sub></math></th></tr></table>',
    )
    const cell = dom.window.document.querySelector('th') as HTMLTableCellElement
    expect(extractCellText(cell)).toBe('dmodel')
  })
})

describe('discoverTables with scientific notation', () => {
  const sciTableHtml = `
    <table>
      <thead><tr><th>Model</th><th>Error Rate</th></tr></thead>
      <tbody>
        <tr><td>A</td><td>1.23e-4</td></tr>
        <tr><td>B</td><td>2.45e-4</td></tr>
        <tr><td>C</td><td>3.67e-4</td></tr>
      </tbody>
    </table>
  `

  it('discovers table with scientific notation', () => {
    const dom = new JSDOM(sciTableHtml)
    const candidates = discoverTables(dom.window.document)
    expect(candidates).toHaveLength(1)
    expect(candidates[0].parsed.data[0][0].value).toBeCloseTo(0.000123, 7)
    expect(candidates[0].parsed.data[1][0].value).toBeCloseTo(0.000245, 7)
    expect(candidates[0].parsed.data[2][0].value).toBeCloseTo(0.000367, 7)
  })

  it('correctly handles scientific notation integers in isAllIntegerColumn', () => {
    const intSciData: CellValue[][] = [
      [{ value: 1e3, isHighlighted: false, raw: '1e3' }],
      [{ value: 2e4, isHighlighted: false, raw: '2e4' }],
      [{ value: 5e2, isHighlighted: false, raw: '5e2' }],
    ]
    expect(isAllIntegerColumn(intSciData, 0)).toBe(true)

    const floatSciData: CellValue[][] = [
      [{ value: 1e-3, isHighlighted: false, raw: '1e-3' }],
      [{ value: 2e-4, isHighlighted: false, raw: '2e-4' }],
      [{ value: 5e-2, isHighlighted: false, raw: '5e-2' }],
    ]
    expect(isAllIntegerColumn(floatSciData, 0)).toBe(false)
  })
})
