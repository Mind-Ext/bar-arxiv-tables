import { beforeEach, describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import {
  applyInlineBars,
  parseToRgb,
  removeInlineBars,
  toggleInlineBars,
} from '../src/chart'
import { CandidateTable, injectButtons, ParsedTable } from '../src/parser'
import { _resetStorageForTesting, updateSettings } from '../src/settings'

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
      updateSettings({ colorPalette: 'tab10' })
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
      updateSettings({ colorMap: 'Viridis', renderMode: 'heatmap' })

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

      const wrapper = table.parentElement as HTMLElement
      expect(wrapper.classList.contains('arxiv-chart-wrapper')).toBe(true)

      const actionsContainer = wrapper.querySelector(
        '.arxiv-chart-actions',
      ) as HTMLElement
      expect(actionsContainer).not.toBeNull()
      expect(actionsContainer.style.position).toBe('absolute')
      expect(actionsContainer.style.bottom).toBe('8px')
      expect(actionsContainer.style.right).toBe('8px')

      const barsBtn = actionsContainer.querySelector(
        '.bars-btn',
      ) as HTMLButtonElement
      expect(barsBtn).not.toBeNull()
      expect(barsBtn.classList.contains('inactive')).toBe(true)
      expect(barsBtn.style.filter).toBe('grayscale(100%)')
      expect(barsBtn.innerHTML).toContain('rotate(90deg)')
      expect(barsBtn.innerHTML).toContain('📊')

      const heatmapBtn = actionsContainer.querySelector(
        '.heatmap-btn',
      ) as HTMLButtonElement
      expect(heatmapBtn).not.toBeNull()
      expect(heatmapBtn.classList.contains('inactive')).toBe(true)
      expect(heatmapBtn.style.filter).toBe('grayscale(100%)')
      expect(heatmapBtn.innerHTML).toContain('🏳️‍🌈')
    })

    it('toggles bars and heatmap modes mutually exclusively', () => {
      const dom = new JSDOM(`
        <figure>
          <table>
            <tr><td>10</td></tr>
            <tr><td>20</td></tr>
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
        data: [[{ value: 10, isHighlighted: false, raw: '10' }], [{
          value: 20,
          isHighlighted: false,
          raw: '20',
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
  })
})
