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
  ParsedTable,
  parseTable,
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
