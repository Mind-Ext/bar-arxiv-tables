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
  computeMedian,
  computeSliceCV,
  detectMetricAxis,
  discoverTables,
  expandGrid,
  extractCellText,
  hasQualifyingNumericColumn,
  isAllIntegerColumn,
  isAllIntegerRow,
  MetricAxis,
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
  metricAxis?: MetricAxis
  orientation?: MetricAxis
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

function computeMetricStats(
  data: CellValue[][],
  index: number,
  axis: MetricAxis = 'column',
) {
  let min = Infinity
  let max = -Infinity
  let nullCount = 0
  let highlightedCount = 0
  let hasSd = false

  const slice = axis === 'row' ? data[index] : data.map((r) => r[index])
  if (!slice) return { min, max, nullCount, highlightedCount, hasSd }

  for (let i = 0; i < slice.length; i++) {
    const cell = slice[i]
    if (!cell || cell.value === null) {
      nullCount++
    } else {
      if (cell.value < min) min = cell.value
      if (cell.value > max) max = cell.value
    }
    if (cell?.isHighlighted) highlightedCount++
    if (cell?.variance !== undefined) hasSd = true
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

        const expAxis = expected.metricAxis || expected.orientation || 'column'
        const names = expAxis === 'row' ? parsed.rowNames : parsed.colNames

        it('metricAxis matches', () => {
          expect(parsed.metricAxis).toBe(expAxis)
        })

        it('caption matches', () => {
          if (expected.caption !== null) {
            expect(parsed.caption).toBe(expected.caption)
          } else {
            expect(parsed.caption).toBeNull()
          }
        })

        it('metric count matches', () => {
          expect(names).toHaveLength(expected.metrics.length)
        })

        for (let m = 0; m < expected.metrics.length; m++) {
          const metric = expected.metrics[m]
          const expectedName = metric.colName || metric.rowName || []

          describe(`metric[${m}] "${expectedName.join(' → ')}"`, () => {
            it('name matches', () => {
              expect(names[m]).toEqual(expectedName)
            })

            if (metric.min !== undefined) {
              it('min matches', () => {
                const stats = computeMetricStats(parsed.data, m, expAxis)
                expect(stats.min).toBeCloseTo(metric.min!, 5)
              })
            }

            if (metric.max !== undefined) {
              it('max matches', () => {
                const stats = computeMetricStats(parsed.data, m, expAxis)
                expect(stats.max).toBeCloseTo(metric.max!, 5)
              })
            }

            if (metric.nullCount !== undefined) {
              it('nullCount matches', () => {
                const stats = computeMetricStats(parsed.data, m, expAxis)
                expect(stats.nullCount).toBe(metric.nullCount)
              })
            }

            if (metric.highlightedCount !== undefined) {
              it('highlightedCount matches', () => {
                const stats = computeMetricStats(parsed.data, m, expAxis)
                expect(stats.highlightedCount).toBe(metric.highlightedCount)
              })
            }

            if (metric.hasSd !== undefined) {
              it('hasSd matches', () => {
                const stats = computeMetricStats(parsed.data, m, expAxis)
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

  it('removes footnote elements and footnote marks from cell text', () => {
    const dom = new JSDOM(
      '<table><tr><td>85.4<span class="ltx_note ltx_role_footnote"><sup class="ltx_note_mark">1</sup><span class="ltx_note_outer"><span class="ltx_note_content">Footnote text</span></span></span></td></tr></table>',
    )
    const cell = dom.window.document.querySelector('td') as HTMLTableCellElement
    expect(extractCellText(cell)).toBe('85.4')
  })
})

describe('Superscript and annotation symbol sanitization (sanitizeForParse)', () => {
  it('strips non-exponent superscripts like footnote markers', () => {
    expect(sanitizeForParse('73.6^{α}')).toBe('73.6')
    expect(sanitizeForParse('56.41^{γ}')).toBe('56.41')
    expect(sanitizeForParse('85.4^{1}')).toBe('85.4')
    expect(sanitizeForParse('85.4^{*}')).toBe('85.4')
    expect(sanitizeForParse('85.4^{a,b}')).toBe('85.4')
  })

  it('preserves scientific exponents while stripping footnote superscripts', () => {
    expect(sanitizeForParse('1.23 × 10^{-4}')).toBe('1.23e-4')
    expect(sanitizeForParse('1.23 × 10^{-4}^{a}')).toBe('1.23e-4')
    expect(parseNumeric(sanitizeForParse('1.23 × 10^{-4}^{a}')).value)
      .toBeCloseTo(0.000123, 7)
  })

  it('strips annotation symbols including asterisks, section markers, and trend arrows', () => {
    expect(sanitizeForParse('85.4*')).toBe('85.4')
    expect(sanitizeForParse('90.1***')).toBe('90.1')
    expect(sanitizeForParse('85.4†')).toBe('85.4')
    expect(sanitizeForParse('85.4‡')).toBe('85.4')
    expect(sanitizeForParse('85.4§')).toBe('85.4')
    expect(sanitizeForParse('85.4¶')).toBe('85.4')
    expect(sanitizeForParse('85.4 ↑')).toBe('85.4')
    expect(sanitizeForParse('72.1↓')).toBe('72.1')
    expect(sanitizeForParse('90.0▲')).toBe('90.0')
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

describe('computeSliceCV and computeMedian', () => {
  it('computeSliceCV returns null for < 2 values', () => {
    expect(computeSliceCV([])).toBeNull()
    expect(computeSliceCV([42])).toBeNull()
  })

  it('computeSliceCV computes std / |mean| correctly', () => {
    // [10, 10, 10] -> std = 0, cv = 0
    expect(computeSliceCV([10, 10, 10])).toBeCloseTo(0, 5)

    // [10, 20] -> mean = 15, var = ((10-15)^2 + (20-15)^2)/1 = 50, std = sqrt(50) = 7.071, cv = 7.071/15 = 0.4714
    expect(computeSliceCV([10, 20])).toBeCloseTo(Math.sqrt(50) / 15, 4)
  })

  it('computeMedian calculates median for odd and even length arrays', () => {
    expect(computeMedian([])).toBeNull()
    expect(computeMedian([5])).toBe(5)
    expect(computeMedian([3, 1, 2])).toBe(2)
    expect(computeMedian([4, 1, 3, 2])).toBe(2.5)
  })
})

describe('detectMetricAxis heuristics', () => {
  it('detects column orientation when column bold ratio > 0.5 and > row bold ratio', () => {
    // 3 rows x 2 cols. Col 0 has bold, Col 1 has bold (pCol = 2/2 = 1.0 > 0.5).
    // Row 0 has bold, Row 1 has none, Row 2 has none (pRow = 1/3 = 0.33).
    const data: CellValue[][] = [
      [
        { value: 80, isHighlighted: true, raw: '80' },
        { value: 90, isHighlighted: true, raw: '90' },
      ],
      [
        { value: 75, isHighlighted: false, raw: '75' },
        { value: 85, isHighlighted: false, raw: '85' },
      ],
      [
        { value: 70, isHighlighted: false, raw: '70' },
        { value: 80, isHighlighted: false, raw: '80' },
      ],
    ]
    expect(detectMetricAxis(data)).toBe('column')
  })

  it('detects row orientation when row bold ratio > 0.5 and > column bold ratio', () => {
    // 2 rows x 3 cols.
    // Row 0 has bold, Row 1 has bold (pRow = 2/2 = 1.0 > 0.5).
    // Col 0 has bold in row 0 & 1, Col 1 has none, Col 2 has none (pCol = 1/3 = 0.33).
    const data: CellValue[][] = [
      [
        { value: 80, isHighlighted: true, raw: '80' },
        { value: 75, isHighlighted: false, raw: '75' },
        { value: 70, isHighlighted: false, raw: '70' },
      ],
      [
        { value: 90, isHighlighted: true, raw: '90' },
        { value: 85, isHighlighted: false, raw: '85' },
        { value: 80, isHighlighted: false, raw: '80' },
      ],
    ]
    expect(detectMetricAxis(data)).toBe('row')
  })

  it('falls through to CV when bold ratio <= 0.5', () => {
    // 4 rows x 4 cols, only 1 bold in entire table (pCol = 0.25 <= 0.5, pRow = 0.25 <= 0.5)
    // Row numbers:
    // Row 0: [100, 102, 101, 103] (tight, small CV)
    // Row 1: [2000, 2010, 2005, 2020] (tight, small CV)
    // Row 2: [5, 5.2, 5.1, 5.3] (tight, small CV)
    // Row 3: [50, 52, 51, 53] (tight, small CV)
    // Along columns: each column mixes 100, 2000, 5, 50 -> huge CV!
    const data: CellValue[][] = [
      [
        { value: 100, isHighlighted: true, raw: '100' },
        { value: 102, isHighlighted: false, raw: '102' },
        { value: 101, isHighlighted: false, raw: '101' },
        { value: 103, isHighlighted: false, raw: '103' },
      ],
      [
        { value: 2000, isHighlighted: false, raw: '2000' },
        { value: 2010, isHighlighted: false, raw: '2010' },
        { value: 2005, isHighlighted: false, raw: '2005' },
        { value: 2020, isHighlighted: false, raw: '2020' },
      ],
      [
        { value: 5, isHighlighted: false, raw: '5' },
        { value: 5.2, isHighlighted: false, raw: '5.2' },
        { value: 5.1, isHighlighted: false, raw: '5.1' },
        { value: 5.3, isHighlighted: false, raw: '5.3' },
      ],
      [
        { value: 50, isHighlighted: false, raw: '50' },
        { value: 52, isHighlighted: false, raw: '52' },
        { value: 51, isHighlighted: false, raw: '51' },
        { value: 53, isHighlighted: false, raw: '53' },
      ],
    ]
    expect(detectMetricAxis(data)).toBe('row')
  })

  it('defaults to column on empty or inconclusive data', () => {
    expect(detectMetricAxis([])).toBe('column')
    expect(detectMetricAxis([[]])).toBe('column')
  })
})

describe('isAllIntegerRow helper', () => {
  it('returns true when all numeric cells in a row are integers', () => {
    const data: CellValue[][] = [
      [
        { value: 10, isHighlighted: false, raw: '10' },
        { value: 20, isHighlighted: false, raw: '20' },
        { value: null, isHighlighted: false, raw: '-' },
      ],
    ]
    expect(isAllIntegerRow(data, 0)).toBe(true)
  })

  it('returns false when at least one numeric cell is a float', () => {
    const data: CellValue[][] = [
      [
        { value: 10, isHighlighted: false, raw: '10' },
        { value: 20.5, isHighlighted: false, raw: '20.5' },
      ],
    ]
    expect(isAllIntegerRow(data, 0)).toBe(false)
  })

  it('returns false for invalid row index or empty row', () => {
    expect(isAllIntegerRow([], 0)).toBe(false)
    expect(isAllIntegerRow([[]], 0)).toBe(false)
  })
})
