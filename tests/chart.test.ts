import { beforeEach, describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import {
  applyInlineBars,
  parseToRgb,
  removeInlineBars,
  toggleInlineBars,
  updateAllVisualizations,
} from '../src/chart'
import {
  CandidateTable,
  discoverTables,
  injectButtons,
  ParsedTable,
} from '../src/parser'
import {
  _resetStorageForTesting,
  setLocalTableSettings,
  updateSettings,
} from '../src/settings'

describe('Chart & Visualization Styling', () => {
  beforeEach(() => {
    _resetStorageForTesting()
  })

  describe('parseToRgb', () => {
    it('parses 6-digit hex colors correctly', () => {
      expect(parseToRgb('#1f77b4')).toEqual({ r: 31, g: 119, b: 180 })
      expect(parseToRgb('#ff7f0e')).toEqual({ r: 255, g: 127, b: 14 })
    })

    it('parses 3-digit hex colors correctly', () => {
      expect(parseToRgb('#f00')).toEqual({ r: 255, g: 0, b: 0 })
    })

    it('parses rgb strings correctly', () => {
      expect(parseToRgb('rgb(100, 200, 50)')).toEqual({ r: 100, g: 200, b: 50 })
      expect(parseToRgb('rgba(10, 20, 30, 0.5)')).toEqual({
        r: 10,
        g: 20,
        b: 30,
      })
    })

    it('returns fallback for invalid inputs', () => {
      expect(parseToRgb('invalid')).toEqual({ r: 76, g: 175, b: 80 })
    })
  })

  describe('Color Palette Cycling across columns', () => {
    it('applies cycled palette colors to different columns', () => {
      updateSettings({
        barColorScheme: 'tab10',
        includeAllIntegerColumns: true,
      })
      // tab10 colors: #1f77b4 (rgb(31, 119, 180)), #ff7f0e (rgb(255, 127, 14)), #2ca02c ...

      const dom = new JSDOM(`
        <figure>
          <table>
            <tr><td>10</td><td>20</td></tr>
            <tr><td>30</td><td>40</td></tr>
          </table>
        </figure>
      `)

      const table = dom.window.document.querySelector(
        'table',
      ) as HTMLTableElement
      const td00 = table.rows[0].cells[0]
      const td01 = table.rows[0].cells[1]

      const parsed: ParsedTable = {
        caption: 'Test',
        colNames: [['Col1'], ['Col2']],
        rowNames: [['R1'], ['R2']],
        topNonNumRows: 0,
        leftNonNumCols: 0,
        data: [
          [{ value: 10, isHighlighted: false, raw: '10' }, {
            value: 20,
            isHighlighted: false,
            raw: '20',
          }],
          [{ value: 30, isHighlighted: false, raw: '30' }, {
            value: 40,
            isHighlighted: false,
            raw: '40',
          }],
        ],
        domCells: [
          [td00, td01],
          [table.rows[1].cells[0], table.rows[1].cells[1]],
        ],
        orientation: 'column',
      }

      applyInlineBars(parsed, table)

      // Col 0 should use rgb(31, 119, 180) from tab10[0] with consistent opacity 0.35
      expect(td00.style.background).toContain('rgba(31, 119, 180, 0.35)')
      // Col 1 should use rgb(255, 127, 14) from tab10[1] with consistent opacity 0.35
      expect(td01.style.background).toContain('rgba(255, 127, 14, 0.35)')
    })

    it('applies heatmap background colors continuously when renderMode is heatmap', () => {
      updateSettings({
        heatmapColorScheme: 'Viridis',
        autoVisualize: 'heatmap',
        includeAllIntegerColumns: true,
      })

      const dom = new JSDOM(`
        <figure>
          <table>
            <tr><td>0</td></tr>
            <tr><td>100</td></tr>
          </table>
        </figure>
      `)

      const table = dom.window.document.querySelector(
        'table',
      ) as HTMLTableElement
      const td0 = table.rows[0].cells[0]
      const td1 = table.rows[1].cells[0]

      const parsed: ParsedTable = {
        caption: 'Test Heatmap',
        colNames: [['Val']],
        rowNames: [['R1'], ['R2']],
        topNonNumRows: 0,
        leftNonNumCols: 0,
        data: [
          [{ value: 0, isHighlighted: false, raw: '0' }],
          [{ value: 100, isHighlighted: false, raw: '100' }],
        ],
        domCells: [[td0], [td1]],
        orientation: 'column',
      }

      applyInlineBars(parsed, table)

      // Heatmap mode should apply full cell gradient with opacity 0.35
      expect(td0.style.background).toContain('linear-gradient(to right,')
      expect(td0.style.background).toContain('0.35')
      expect(td1.style.background).toContain('linear-gradient(to right,')
      expect(td1.style.background).toContain('0.35')
      // Values at 0 and 100 should produce different heatmap colors along Viridis scale
      expect(td0.style.background).not.toEqual(td1.style.background)
    })

    it('applies diverging colormap with zero anchored to midpoint (0.5) for bipolar columns in heatmap mode', () => {
      updateSettings({
        heatmapColorScheme: 'Cividis',
        divergingColorScheme: 'PuOr',
        autoVisualize: 'heatmap',
        includeAllIntegerColumns: true,
      })

      const dom = new JSDOM(`
        <figure>
          <table>
            <tr><td>-20</td></tr>
            <tr><td>0</td></tr>
            <tr><td>10</td></tr>
          </table>
        </figure>
      `)

      const table = dom.window.document.querySelector(
        'table',
      ) as HTMLTableElement
      const tdNeg = table.rows[0].cells[0]
      const tdZero = table.rows[1].cells[0]
      const tdPos = table.rows[2].cells[0]

      const parsed: ParsedTable = {
        caption: 'Test Diverging Heatmap',
        colNames: [['Delta']],
        rowNames: [['R1'], ['R2'], ['R3']],
        topNonNumRows: 0,
        leftNonNumCols: 0,
        data: [
          [{ value: -20, isHighlighted: false, raw: '-20' }],
          [{ value: 0, isHighlighted: false, raw: '0' }],
          [{ value: 10, isHighlighted: false, raw: '10' }],
        ],
        domCells: [[tdNeg], [tdZero], [tdPos]],
        orientation: 'column',
      }

      applyInlineBars(parsed, table)

      // Zero value in bipolar column (-20 to 10, absMax = 20) should map to norm = 0.5
      // PuOr(0.5) = rgb(243, 238, 234)
      expect(tdZero.style.background).toContain('rgba(243, 238, 234, 0.35)')

      // Negative value (-20) should map to norm = 0.0 -> PuOr(0.0) = rgb(45, 0, 75)
      expect(tdNeg.style.background).toContain('rgba(45, 0, 75, 0.35)')

      // Positive value (+10) should map to norm = 0.5 + (10/20)*0.5 = 0.75 (orange side)
      expect(tdPos.style.background).not.toEqual(tdZero.style.background)
      expect(tdPos.style.background).not.toEqual(tdNeg.style.background)
    })

    it('applies continuous colormap colors to bars in bar mode when barColorScheme is a colormap', () => {
      updateSettings({
        barColorScheme: 'Viridis',
        renderMode: 'bars',
        includeAllIntegerColumns: true,
      })

      const dom = new JSDOM(`
        <figure>
          <table>
            <tr><td>0</td></tr>
            <tr><td>100</td></tr>
          </table>
        </figure>
      `)

      const table = dom.window.document.querySelector(
        'table',
      ) as HTMLTableElement
      const td0 = table.rows[0].cells[0]
      const td1 = table.rows[1].cells[0]

      const parsed: ParsedTable = {
        caption: 'Test Colormap Bars',
        colNames: [['Val']],
        rowNames: [['R1'], ['R2']],
        topNonNumRows: 0,
        leftNonNumCols: 0,
        data: [
          [{ value: 0, isHighlighted: false, raw: '0' }],
          [{ value: 100, isHighlighted: false, raw: '100' }],
        ],
        domCells: [[td0], [td1]],
        orientation: 'column',
      }

      applyInlineBars(parsed, table)

      // Bar mode with colormap: low value (0%) and high value (100%) get different bar colors
      expect(td0.style.background).toContain('linear-gradient(to right,')
      expect(td1.style.background).toContain('linear-gradient(to right,')
      expect(td0.style.background).not.toEqual(td1.style.background)
    })

    it('renders bipolar columns with centered zero at 50% and consistent column palette colors', () => {
      updateSettings({
        barColorScheme: 'tab10',
        includeAllIntegerColumns: true,
      })
      // tab10[0] = #1f77b4 -> rgb(31, 119, 180)

      const dom = new JSDOM(`
        <figure>
          <table>
            <tr><td>-10</td></tr>
            <tr><td>10</td></tr>
            <tr><td>20</td></tr>
          </table>
        </figure>
      `)

      const table = dom.window.document.querySelector(
        'table',
      ) as HTMLTableElement
      const tdNeg = table.rows[0].cells[0]
      const tdPos1 = table.rows[1].cells[0]
      const tdPos2 = table.rows[2].cells[0]

      const parsed: ParsedTable = {
        caption: 'Bipolar Test',
        colNames: [['Metric']],
        rowNames: [['R1'], ['R2'], ['R3']],
        topNonNumRows: 0,
        leftNonNumCols: 0,
        data: [
          [{ value: -10, isHighlighted: false, raw: '-10' }],
          [{ value: 10, isHighlighted: false, raw: '10' }],
          [{ value: 20, isHighlighted: false, raw: '20' }],
        ],
        domCells: [[tdNeg], [tdPos1], [tdPos2]],
        orientation: 'column',
      }

      applyInlineBars(parsed, table)

      // Both positive and negative cells use the column's tab10[0] color rgba(31, 119, 180, 0.35)
      expect(tdNeg.style.background).toContain('rgba(31, 119, 180, 0.35)')
      expect(tdPos1.style.background).toContain('rgba(31, 119, 180, 0.35)')
      expect(tdPos2.style.background).toContain('rgba(31, 119, 180, 0.35)')

      // absMax = 20:
      // value = -10 -> valPct = 50 - (10/20)*50 = 25%. Bar spans 25% to 50%
      expect(tdNeg.style.background).toContain(
        'linear-gradient(to right, transparent 25%, rgba(31, 119, 180, 0.35) 25%, rgba(31, 119, 180, 0.35) 50%, transparent 50%)',
      )

      // value = +10 -> valPct = 50 + (10/20)*50 = 75%. Bar spans 50% to 75%
      expect(tdPos1.style.background).toContain(
        'linear-gradient(to right, transparent 50%, rgba(31, 119, 180, 0.35) 50%, rgba(31, 119, 180, 0.35) 75%, transparent 75%)',
      )

      // value = +20 -> valPct = 50 + (20/20)*50 = 100%. Bar spans 50% to 100%
      expect(tdPos2.style.background).toContain(
        'linear-gradient(to right, transparent 50%, rgba(31, 119, 180, 0.35) 50%, rgba(31, 119, 180, 0.35) 100%, transparent 100%)',
      )
    })

    it('renders all-negative columns with column palette colors', () => {
      updateSettings({
        barColorScheme: 'tab10',
        includeAllIntegerColumns: true,
      })

      const dom = new JSDOM(`
        <figure>
          <table>
            <tr><td>-5</td></tr>
            <tr><td>-15</td></tr>
          </table>
        </figure>
      `)

      const table = dom.window.document.querySelector(
        'table',
      ) as HTMLTableElement
      const td0 = table.rows[0].cells[0]
      const td1 = table.rows[1].cells[0]

      const parsed: ParsedTable = {
        caption: 'Negative Test',
        colNames: [['Metric']],
        rowNames: [['R1'], ['R2']],
        topNonNumRows: 0,
        leftNonNumCols: 0,
        data: [
          [{ value: -5, isHighlighted: false, raw: '-5' }],
          [{ value: -15, isHighlighted: false, raw: '-15' }],
        ],
        domCells: [[td0], [td1]],
        orientation: 'column',
      }

      applyInlineBars(parsed, table)

      // Uses column color tab10[0] rgba(31, 119, 180, 0.35) without hardcoded red
      expect(td0.style.background).toContain('rgba(31, 119, 180, 0.35)')
      expect(td1.style.background).toContain('rgba(31, 119, 180, 0.35)')
      expect(td0.style.background).toContain('linear-gradient(to left,')
      expect(td1.style.background).toContain('linear-gradient(to left,')
    })
  })

  describe('Button Injection & Styling', () => {
    it('injects bars and heatmap buttons with bottom-right positioning, rotated emoji, rainbow flag, and grayscale filter', () => {
      const dom = new JSDOM(`
        <figure>
          <table>
            <tr><td>1.5</td></tr>
          </table>
          <figcaption>Sample Table</figcaption>
        </figure>
      `)

      const figure = dom.window.document.querySelector('figure') as HTMLElement
      const table = dom.window.document.querySelector(
        'table',
      ) as HTMLTableElement

      const candidates: CandidateTable[] = [
        {
          figure,
          table,
          parsed: {
            caption: 'Sample Table',
            colNames: [['Value']],
            rowNames: [['R1']],
            topNonNumRows: 0,
            leftNonNumCols: 0,
            data: [[{ value: 1.5, isHighlighted: false, raw: '1.5' }]],
            domCells: [[table.rows[0].cells[0]]],
            orientation: 'column',
          },
        },
      ]

      injectButtons(candidates, () => {})

      const actionsContainer = table.querySelector(
        '.b-a-t-actions',
      ) as HTMLElement
      expect(actionsContainer).not.toBeNull()
      expect(actionsContainer.parentElement?.tagName).toBe('TD')
      expect(
        actionsContainer.parentElement?.parentElement?.parentElement?.tagName,
      ).toBe('TFOOT')
      expect(actionsContainer.style.display).toBe('inline-flex')

      const barsBtn = actionsContainer.querySelector(
        '.b-a-t-bars-btn',
      ) as HTMLButtonElement
      expect(barsBtn).not.toBeNull()
      expect(barsBtn.classList.contains('inactive')).toBe(true)
      expect(barsBtn.style.filter).toBe('grayscale(100%)')
      expect(barsBtn.innerHTML).toContain('rotate(90deg)')
      expect(barsBtn.innerHTML).toContain('📊')

      const heatmapBtn = actionsContainer.querySelector(
        '.b-a-t-heatmap-btn',
      ) as HTMLButtonElement
      expect(heatmapBtn).not.toBeNull()
      expect(heatmapBtn.classList.contains('inactive')).toBe(true)
      expect(heatmapBtn.style.filter).toBe('grayscale(100%)')
      expect(heatmapBtn.innerHTML).toContain('🌈')
    })

    it('injects buttons for multiple sibling tables in the same parent container', () => {
      const dom = new JSDOM(`
        <div class="container">
          <table id="t1">
            <thead><tr><th>A</th><th>B</th></tr></thead>
            <tbody>
              <tr><td>X</td><td>1.5</td></tr>
              <tr><td>Y</td><td>2.5</td></tr>
              <tr><td>Z</td><td>3.5</td></tr>
            </tbody>
          </table>
          <table id="t2">
            <thead><tr><th>A</th><th>B</th></tr></thead>
            <tbody>
              <tr><td>X</td><td>4.5</td></tr>
              <tr><td>Y</td><td>5.5</td></tr>
              <tr><td>Z</td><td>6.5</td></tr>
            </tbody>
          </table>
        </div>
      `)
      const candidates = discoverTables(dom.window.document)
      expect(candidates).toHaveLength(2)
      injectButtons(candidates, () => {})
      const t1Actions = candidates[0].table.querySelector(
        '.b-a-t-actions',
      ) as HTMLElement
      const t2Actions = candidates[1].table.querySelector(
        '.b-a-t-actions',
      ) as HTMLElement
      expect(t1Actions).not.toBeNull()
      expect(t2Actions).not.toBeNull()
    })

    it('toggles bars and heatmap modes mutually exclusively', () => {
      const dom = new JSDOM(`
        <figure>
          <table>
            <tr><td>10.5</td></tr>
            <tr><td>20.5</td></tr>
          </table>
        </figure>
      `)

      const table = dom.window.document.querySelector(
        'table',
      ) as HTMLTableElement
      const parsed: ParsedTable = {
        caption: 'Sample Table',
        colNames: [['Val']],
        rowNames: [['R1'], ['R2']],
        topNonNumRows: 0,
        leftNonNumCols: 0,
        data: [[{ value: 10.5, isHighlighted: false, raw: '10.5' }], [{
          value: 20.5,
          isHighlighted: false,
          raw: '20.5',
        }]],
        domCells: [[table.rows[0].cells[0]], [table.rows[1].cells[0]]],
        orientation: 'column',
      }

      // Turn on bars mode
      let mode = toggleInlineBars(parsed, table, 'bars')
      expect(mode).toBe('bars')

      // Switch to heatmap mode
      mode = toggleInlineBars(parsed, table, 'heatmap')
      expect(mode).toBe('heatmap')

      // Toggle off heatmap mode
      mode = toggleInlineBars(parsed, table, 'heatmap')
      expect(mode).toBeNull()
    })

    it('updateAllVisualizations re-renders active visualizations without looping infinitely', () => {
      const dom = new JSDOM(`
        <table>
          <tr><td>10.5</td></tr>
          <tr><td>20.5</td></tr>
        </table>
      `)
      const table = dom.window.document.querySelector(
        'table',
      ) as HTMLTableElement
      const parsed: ParsedTable = {
        caption: 'Test',
        colNames: [['V']],
        rowNames: [['R1'], ['R2']],
        topNonNumRows: 0,
        leftNonNumCols: 0,
        data: [[{ value: 10.5, isHighlighted: false, raw: '10.5' }], [{
          value: 20.5,
          isHighlighted: false,
          raw: '20.5',
        }]],
        domCells: [[table.rows[0].cells[0]], [table.rows[1].cells[0]]],
        orientation: 'column',
      }

      applyInlineBars(parsed, table, 'bars', 'test#t1')
      expect(() => updateAllVisualizations()).not.toThrow()
    })
  })

  describe('includeAllIntegerColumns setting', () => {
    it('skips all-integer columns by default and only styles non-integer columns', () => {
      const dom = new JSDOM(`
        <table>
          <tr><td>10</td><td>10.5</td></tr>
          <tr><td>20</td><td>20.5</td></tr>
        </table>
      `)
      const table = dom.window.document.querySelector(
        'table',
      ) as HTMLTableElement
      const tdInt0 = table.rows[0].cells[0]
      const tdFloat0 = table.rows[0].cells[1]

      const parsed: ParsedTable = {
        caption: 'Mixed Table',
        colNames: [['IntCol'], ['FloatCol']],
        rowNames: [['R1'], ['R2']],
        topNonNumRows: 0,
        leftNonNumCols: 0,
        data: [
          [
            { value: 10, isHighlighted: false, raw: '10' },
            { value: 10.5, isHighlighted: false, raw: '10.5' },
          ],
          [
            { value: 20, isHighlighted: false, raw: '20' },
            { value: 20.5, isHighlighted: false, raw: '20.5' },
          ],
        ],
        domCells: [
          [tdInt0, tdFloat0],
          [table.rows[1].cells[0], table.rows[1].cells[1]],
        ],
        orientation: 'column',
      }

      applyInlineBars(parsed, table)

      // Default (includeAllIntegerColumns: false): integer column should have NO background style
      expect(tdInt0.style.background).toBe('')
      // Float column should have background gradient
      expect(tdFloat0.style.background).toContain('linear-gradient')
    })

    it('styles all-integer columns when includeAllIntegerColumns is true', () => {
      updateSettings({ includeAllIntegerColumns: true })

      const dom = new JSDOM(`
        <table>
          <tr><td>10</td><td>10.5</td></tr>
          <tr><td>20</td><td>20.5</td></tr>
        </table>
      `)
      const table = dom.window.document.querySelector(
        'table',
      ) as HTMLTableElement
      const tdInt0 = table.rows[0].cells[0]
      const tdFloat0 = table.rows[0].cells[1]

      const parsed: ParsedTable = {
        caption: 'Mixed Table',
        colNames: [['IntCol'], ['FloatCol']],
        rowNames: [['R1'], ['R2']],
        topNonNumRows: 0,
        leftNonNumCols: 0,
        data: [
          [
            { value: 10, isHighlighted: false, raw: '10' },
            { value: 10.5, isHighlighted: false, raw: '10.5' },
          ],
          [
            { value: 20, isHighlighted: false, raw: '20' },
            { value: 20.5, isHighlighted: false, raw: '20.5' },
          ],
        ],
        domCells: [
          [tdInt0, tdFloat0],
          [table.rows[1].cells[0], table.rows[1].cells[1]],
        ],
        orientation: 'column',
      }

      applyInlineBars(parsed, table)

      // With includeAllIntegerColumns: true, integer column also receives background styling
      expect(tdInt0.style.background).toContain('linear-gradient')
      expect(tdFloat0.style.background).toContain('linear-gradient')
    })

    it('styles all-integer columns when local override has includeAllIntegerColumns: true while global is false', () => {
      updateSettings({ includeAllIntegerColumns: false })
      const compositeKey = 'paper#t-int-override'
      setLocalTableSettings(compositeKey, { includeAllIntegerColumns: true })

      const dom = new JSDOM(`
        <table>
          <tr><td>10</td><td>10.5</td></tr>
          <tr><td>20</td><td>20.5</td></tr>
        </table>
      `)
      const table = dom.window.document.querySelector(
        'table',
      ) as HTMLTableElement
      const tdInt0 = table.rows[0].cells[0]
      const tdFloat0 = table.rows[0].cells[1]

      const parsed: ParsedTable = {
        caption: 'Mixed Table Local Override',
        colNames: [['IntCol'], ['FloatCol']],
        rowNames: [['R1'], ['R2']],
        topNonNumRows: 0,
        leftNonNumCols: 0,
        data: [
          [
            { value: 10, isHighlighted: false, raw: '10' },
            { value: 10.5, isHighlighted: false, raw: '10.5' },
          ],
          [
            { value: 20, isHighlighted: false, raw: '20' },
            { value: 20.5, isHighlighted: false, raw: '20.5' },
          ],
        ],
        domCells: [
          [tdInt0, tdFloat0],
          [table.rows[1].cells[0], table.rows[1].cells[1]],
        ],
        orientation: 'column',
      }

      applyInlineBars(parsed, table, undefined, compositeKey)

      expect(tdInt0.style.background).toContain('linear-gradient')
      expect(tdFloat0.style.background).toContain('linear-gradient')
    })
  })

  describe('metricAxis: "row" rendering', () => {
    it('normalizes bars horizontally along rows rather than down columns', () => {
      const dom = new JSDOM(`
        <table>
          <tbody>
            <tr><td id="r0c0">10.5</td><td id="r0c1">20.5</td></tr>
            <tr><td id="r1c0">1000.5</td><td id="r1c1">2000.5</td></tr>
          </tbody>
        </table>
      `)
      const table = dom.window.document.querySelector(
        'table',
      ) as HTMLTableElement
      const td00 = table.rows[0].cells[0]
      const td01 = table.rows[0].cells[1]
      const td10 = table.rows[1].cells[0]
      const td11 = table.rows[1].cells[1]

      const parsed: ParsedTable = {
        caption: 'Row Metric Table',
        colNames: [['ModelA'], ['ModelB']],
        rowNames: [['Metric1'], ['Metric2']],
        topNonNumRows: 0,
        leftNonNumCols: 0,
        data: [
          [
            { value: 10.5, isHighlighted: false, raw: '10.5' },
            { value: 20.5, isHighlighted: false, raw: '20.5' },
          ],
          [
            { value: 1000.5, isHighlighted: false, raw: '1000.5' },
            { value: 2000.5, isHighlighted: false, raw: '2000.5' },
          ],
        ],
        domCells: [
          [td00, td01],
          [td10, td11],
        ],
        metricAxis: 'row',
        orientation: 'row',
      }

      applyInlineBars(parsed, table, 'bars')

      // In row 0: min=10.5 (0%), max=20.5 (100%)
      expect(td00.style.background).toContain('0%')
      expect(td01.style.background).toContain('100%')

      // In row 1: min=1000.5 (0%), max=2000.5 (100%)
      expect(td10.style.background).toContain('0%')
      expect(td11.style.background).toContain('100%')
    })

    it('respects local settings override for metricAxis', () => {
      const dom = new JSDOM(`
        <table>
          <tbody>
            <tr><td id="r0c0">10.5</td><td id="r0c1">20.5</td></tr>
            <tr><td id="r1c0">1000.5</td><td id="r1c1">2000.5</td></tr>
          </tbody>
        </table>
      `)
      const table = dom.window.document.querySelector(
        'table',
      ) as HTMLTableElement
      const td00 = table.rows[0].cells[0]
      const td01 = table.rows[0].cells[1]
      const td10 = table.rows[1].cells[0]
      const td11 = table.rows[1].cells[1]

      const parsed: ParsedTable = {
        caption: 'Default Column Table',
        colNames: [['MetricA'], ['MetricB']],
        rowNames: [['R1'], ['R2']],
        topNonNumRows: 0,
        leftNonNumCols: 0,
        data: [
          [
            { value: 10.5, isHighlighted: false, raw: '10.5' },
            { value: 20.5, isHighlighted: false, raw: '20.5' },
          ],
          [
            { value: 1000.5, isHighlighted: false, raw: '1000.5' },
            { value: 2000.5, isHighlighted: false, raw: '2000.5' },
          ],
        ],
        domCells: [
          [td00, td01],
          [td10, td11],
        ],
        metricAxis: 'column',
        orientation: 'column',
      }

      // Override table to 'row' via local table settings
      const compositeKey = 'test#table-axis'
      setLocalTableSettings(compositeKey, { metricAxis: 'row' })

      applyInlineBars(parsed, table, 'bars', compositeKey)

      // When overridden to 'row', row 0 evaluates [10.5, 20.5] so td01 is 100%
      expect(td01.style.background).toContain('100%')
      expect(td00.style.background).toContain('0%')
    })
  })
})
