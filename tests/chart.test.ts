import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseToRgb, applyInlineBars, removeInlineBars, toggleInlineBars } from '../src/chart';
import { injectButtons, CandidateTable, ParsedTable } from '../src/parser';
import { updateSettings, _resetStorageForTesting } from '../src/settings';

describe('Chart & Visualization Styling', () => {
  beforeEach(() => {
    _resetStorageForTesting();
  });

  describe('parseToRgb', () => {
    it('parses 6-digit hex colors correctly', () => {
      expect(parseToRgb('#1f77b4')).toEqual({ r: 31, g: 119, b: 180 });
      expect(parseToRgb('#ff7f0e')).toEqual({ r: 255, g: 127, b: 14 });
    });

    it('parses 3-digit hex colors correctly', () => {
      expect(parseToRgb('#f00')).toEqual({ r: 255, g: 0, b: 0 });
    });

    it('parses rgb strings correctly', () => {
      expect(parseToRgb('rgb(100, 200, 50)')).toEqual({ r: 100, g: 200, b: 50 });
      expect(parseToRgb('rgba(10, 20, 30, 0.5)')).toEqual({ r: 10, g: 20, b: 30 });
    });

    it('returns fallback for invalid inputs', () => {
      expect(parseToRgb('invalid')).toEqual({ r: 76, g: 175, b: 80 });
    });
  });

  describe('Color Palette Cycling across columns', () => {
    it('applies cycled palette colors to different columns', () => {
      updateSettings({ colorPalette: 'tab10' });
      // tab10 colors: #1f77b4 (rgb(31, 119, 180)), #ff7f0e (rgb(255, 127, 14)), #2ca02c ...

      const dom = new JSDOM(`
        <figure>
          <table>
            <tr><td>10</td><td>20</td></tr>
            <tr><td>30</td><td>40</td></tr>
          </table>
        </figure>
      `);

      const table = dom.window.document.querySelector('table') as HTMLTableElement;
      const td00 = table.rows[0].cells[0];
      const td01 = table.rows[0].cells[1];

      const parsed: ParsedTable = {
        caption: 'Test',
        colNames: [['Col1'], ['Col2']],
        rowNames: [['R1'], ['R2']],
        topNonNumRows: 0,
        leftNonNumCols: 0,
        data: [
          [{ value: 10, isHighlighted: false, raw: '10' }, { value: 20, isHighlighted: false, raw: '20' }],
          [{ value: 30, isHighlighted: false, raw: '30' }, { value: 40, isHighlighted: false, raw: '40' }],
        ],
        domCells: [
          [td00, td01],
          [table.rows[1].cells[0], table.rows[1].cells[1]],
        ],
        orientation: 'column',
      };

      applyInlineBars(parsed, table);

      // Col 0 should use rgb(31, 119, 180) from tab10[0] with consistent opacity 0.35
      expect(td00.style.background).toContain('rgba(31, 119, 180, 0.35)');
      // Col 1 should use rgb(255, 127, 14) from tab10[1] with consistent opacity 0.35
      expect(td01.style.background).toContain('rgba(255, 127, 14, 0.35)');
    });
  });

  describe('Button Injection & Styling', () => {
    it('injects button with bottom-right positioning, rotated emoji, and grayscale filter', () => {
      const dom = new JSDOM(`
        <figure>
          <table>
            <tr><td>1.5</td></tr>
          </table>
          <figcaption>Sample Table</figcaption>
        </figure>
      `);

      const figure = dom.window.document.querySelector('figure') as HTMLElement;
      const table = dom.window.document.querySelector('table') as HTMLTableElement;

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
      ];

      injectButtons(candidates, () => {});

      const wrapper = table.parentElement as HTMLElement;
      expect(wrapper.classList.contains('arxiv-chart-wrapper')).toBe(true);

      const btn = wrapper.querySelector('.arxiv-chart-btn') as HTMLButtonElement;
      expect(btn).not.toBeNull();
      expect(btn.classList.contains('inactive')).toBe(true);
      expect(btn.style.position).toBe('absolute');
      expect(btn.style.bottom).toBe('8px');
      expect(btn.style.right).toBe('8px');
      expect(btn.style.filter).toBe('grayscale(100%)');
      expect(btn.innerHTML).toContain('rotate(90deg)');
      expect(btn.innerHTML).toContain('📊');
    });
  });
});
