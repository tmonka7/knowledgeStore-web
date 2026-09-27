// Word and Excel files from pages read by OCR (see lib/ocrDocument.js).
//
// Word (docx): a Word page per page, of the original's size, with its
// content in reading order — paragraphs at their type size, weight, colour,
// indent and spacing; tables as Word tables with the original's column
// widths, row heights and merged cells; figures as pictures at their size.
// Excel (xlsx): a sheet per page, with each table in cells (merged cells
// kept, numbers and percentages as numbers) and the text between them a
// paragraph a row. The libraries are loaded only when a file is made.

import {
  lineHeight, pageDpi, readingOrder, tableCells,
} from './ocrDocument';

const TWIPS_PER_INCH = 1440;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const hex = (color) => (color && /^#[0-9a-f]{6}$/i.test(color) ? color.slice(1).toUpperCase() : undefined);
/** The first family of a CSS font list, as Word names fonts. */
export const fontName = (family) => String(family || 'Arial').split(',')[0].trim().replace(/^["']|["']$/g, '');

const dataUrlBytes = (url) => {
  const binary = atob(String(url).split(',')[1] || '');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
};

/**
 * A .docx of the pages. `fontFamily` is the CSS font list chosen on the page;
 * Word gets its first font, for Latin and East Asian text alike.
 */
export async function toDocx(pages, { fontFamily, title }) {
  const {
    AlignmentType, Document, HeightRule, ImageRun, LineRuleType, Packer, Paragraph, Table, TableCell, TableLayoutType,
    TableRow, TextRun, VerticalAlign, WidthType,
  } = await import('docx');
  const name = fontName(fontFamily);
  const font = {
    ascii: name, hAnsi: name, eastAsia: name, cs: name,
  };
  const halfPoints = (page, height) => clamp(Math.round(((height * 0.75 * 72) / pageDpi(page)) * 2), 8, 144);

  const sections = pages.map((page) => {
    const twips = TWIPS_PER_INCH / pageDpi(page);
    const items = readingOrder(page);
    const edge = items.length ? {
      left: Math.min(...items.map((item) => item.left)),
      right: Math.max(...items.map((item) => item.right)),
      top: Math.min(...items.map((item) => item.top)),
    } : { left: page.width * 0.1, right: page.width * 0.9, top: page.height * 0.1 };
    const margin = {
      left: Math.round(clamp(edge.left * twips, 360, 2880)),
      right: Math.round(clamp((page.width - edge.right) * twips, 360, 2880)),
      top: Math.round(clamp(edge.top * twips, 360, 2880)),
      bottom: 360,
    };
    const usable = page.width * twips - margin.left - margin.right;
    const middle = (edge.left + edge.right) / 2;
    let previousBottom = edge.top;
    const children = [];

    items.forEach((item) => {
      const before = Math.round(clamp((item.top - previousBottom) * twips, 0, 4320));
      previousBottom = Math.max(previousBottom, item.bottom);
      const indent = Math.round(clamp((item.left - edge.left) * twips, 0, usable * 0.9));

      if (item.type === 'paragraph') {
        const heights = item.lines.map((line) => line.height);
        const width = item.right - item.left;
        // Centred: its middle on the text's middle, and not a full-width line.
        const centred = Math.abs((item.left + item.right) / 2 - middle) < page.width * 0.02
          && width < (edge.right - edge.left) * 0.8 && item.left - edge.left > page.width * 0.05;
        // Line pitch of the original, for a paragraph of several lines.
        const tops = item.lines.filter((line) => !line.sameRow).map((line) => line.top);
        const pitch = tops.length > 1 ? median(tops.slice(1).map((top, i) => top - tops[i])) : 0;
        const runs = [];
        item.lines.forEach((line, i) => {
          if (i > 0) {
            const joined = item.lines.slice(0, i).map((l) => l.text).join('');
            runs.push(new TextRun({ text: line.sameRow ? '\t' : (/[぀-ヿ㐀-鿿가-힯]$/.test(joined) ? '' : ' '), font }));
          }
          runs.push(new TextRun({
            text: line.text,
            bold: Boolean(line.bold),
            color: hex(line.color),
            size: halfPoints(page, line.height),
            font,
          }));
        });
        children.push(new Paragraph({
          children: runs,
          alignment: centred ? AlignmentType.CENTER : AlignmentType.LEFT,
          indent: centred ? undefined : { left: indent },
          spacing: {
            before,
            after: 0,
            ...(pitch > median(heights) ? { line: Math.round(pitch * twips), lineRule: LineRuleType.EXACT } : {}),
          },
        }));
        return;
      }

      const { block } = item;
      const [x1, y1, x2, y2] = block.box;
      if (item.type === 'figure') {
        const scale = 96 / pageDpi(page); // docx sizes pictures in 96-dpi pixels
        children.push(new Paragraph({
          indent: { left: indent },
          spacing: { before, after: 0 },
          children: [new ImageRun({
            type: 'jpg',
            data: dataUrlBytes(block.image),
            transformation: { width: Math.round((x2 - x1) * scale), height: Math.round((y2 - y1) * scale) },
          })],
        }));
        return;
      }

      // A table: the grid the server measured, or equal columns across its width.
      const grid = tableCells(block.html);
      const columnCount = Math.max(1, ...grid.map((row) => row.reduce((sum, cell) => sum + cell.colspan, 0)));
      const edges = block.columns && block.columns.length === columnCount + 1 ? block.columns : null;
      const columnWidths = Array.from({ length: columnCount }, (_, i) => Math.round(
        (edges ? edges[i + 1] - edges[i] : (x2 - x1) / columnCount) * twips,
      ));
      const tops = block.rows && block.rows.length === grid.length + 1 ? block.rows : null;
      const cellLines = page.lines.filter((line) => line.block === block.index);
      const cellSize = halfPoints(page, median(cellLines.map((line) => lineHeight(line.box))) || 40);
      children.push(new Paragraph({ spacing: { before, after: 0 }, children: [] }));
      children.push(new Table({
        layout: TableLayoutType.FIXED,
        width: { size: columnWidths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
        columnWidths,
        indent: { size: indent, type: WidthType.DXA },
        rows: grid.map((row, r) => {
          let column = 0;
          return new TableRow({
            height: tops ? { value: Math.round((tops[r + 1] - tops[r]) * twips), rule: HeightRule.ATLEAST } : undefined,
            children: row.map((cell) => {
              const width = columnWidths.slice(column, column + cell.colspan).reduce((a, b) => a + b, 0);
              column += cell.colspan;
              return new TableCell({
                columnSpan: cell.colspan > 1 ? cell.colspan : undefined,
                rowSpan: cell.rowspan > 1 ? cell.rowspan : undefined,
                width: { size: width, type: WidthType.DXA },
                verticalAlign: VerticalAlign.CENTER,
                margins: {
                  top: 40, bottom: 40, left: 80, right: 80,
                },
                children: (cell.text ? cell.text.split('\n') : ['']).map((text) => new Paragraph({
                  children: [new TextRun({
                    text, bold: cell.bold, color: hex(cell.color), size: cellSize, font,
                  })],
                })),
              });
            }),
          });
        }),
      }));
      previousBottom = Math.max(previousBottom, y2);
      // Word joins two tables that touch; a paragraph keeps them apart.
      children.push(new Paragraph({ spacing: { before: 0, after: 0 }, children: [] }));
    });

    return {
      properties: {
        page: {
          size: { width: Math.round(page.width * twips), height: Math.round(page.height * twips) },
          margin,
        },
      },
      children: children.length ? children : [new Paragraph({ children: [] })],
    };
  });

  const doc = new Document({
    creator: 'knowledgeStore OCR',
    title: title || 'OCR',
    styles: { default: { document: { run: { font } } } },
    sections,
  });
  return Packer.toBlob(doc);
}

const NUMBER = /^[+-]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/;
const PERCENT = /^[+-]?\d+(\.\d+)?%$/;
/** A cell's value: numbers and percentages as numbers (keeping how they were written), else text. */
const cellValue = (text) => {
  const value = text.trim();
  if (NUMBER.test(value)) {
    const decimals = (value.split('.')[1] || '').length;
    const grouped = value.includes(',');
    const base = `${grouped ? '#,##0' : '0'}${decimals ? `.${'0'.repeat(decimals)}` : ''}`;
    return {
      t: 'n', v: Number(value.replace(/,/g, '')), z: value.startsWith('+') ? `+${base};-${base};${base}` : base,
    };
  }
  if (PERCENT.test(value)) {
    const decimals = (value.replace('%', '').split('.')[1] || '').length;
    const base = `0${decimals ? `.${'0'.repeat(decimals)}` : ''}%`;
    return {
      t: 'n', v: Number(value.replace('%', '')) / 100, z: value.startsWith('+') ? `+${base};-${base};${base}` : base,
    };
  }
  return { t: 's', v: value };
};

/**
 * An .xlsx of the pages, a sheet each (`sheetName(page)` names it). The free
 * Excel writer keeps no fonts or pictures, so a figure is a note in its row.
 */
export async function toXlsx(pages, { sheetName, figureLabel }) {
  const XLSX = await import('xlsx');
  const book = XLSX.utils.book_new();
  pages.forEach((page) => {
    const sheet = {};
    const merges = [];
    const widths = [];
    let lastRow = 0;
    let lastColumn = 0;
    const put = (r, c, cell) => {
      sheet[XLSX.utils.encode_cell({ r, c })] = cell;
      lastRow = Math.max(lastRow, r);
      lastColumn = Math.max(lastColumn, c);
      const longest = Math.max(...String(cell.v).split('\n').map((part) => part.length));
      widths[c] = Math.max(widths[c] || 10, Math.min(60, longest + 2));
    };
    let row = 0;
    let figures = 0;
    readingOrder(page).forEach((item) => {
      if (item.type === 'paragraph') {
        // A paragraph's text spans the sheet, so it is not squeezed into column A's width.
        sheet[XLSX.utils.encode_cell({ r: row, c: 0 })] = { t: 's', v: item.text };
        lastRow = Math.max(lastRow, row);
        row += 1;
      } else if (item.type === 'figure') {
        figures += 1;
        put(row, 0, { t: 's', v: `[${figureLabel(figures)}]` });
        row += 1;
      } else {
        const grid = tableCells(item.block.html);
        const taken = new Set();
        grid.forEach((cells, r) => {
          let c = 0;
          cells.forEach((cell) => {
            while (taken.has(`${r},${c}`)) c += 1;
            put(row + r, c, cellValue(cell.text));
            if (cell.colspan > 1 || cell.rowspan > 1) {
              merges.push({ s: { r: row + r, c }, e: { r: row + r + cell.rowspan - 1, c: c + cell.colspan - 1 } });
            }
            for (let dr = 0; dr < cell.rowspan; dr += 1) {
              for (let dc = 0; dc < cell.colspan; dc += 1) taken.add(`${r + dr},${c + dc}`);
            }
            c += cell.colspan;
          });
        });
        row += grid.length + 1; // a blank row after a table
      }
    });
    sheet['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, lastRow), c: Math.max(0, lastColumn) } });
    if (merges.length) sheet['!merges'] = merges;
    sheet['!cols'] = Array.from({ length: lastColumn + 1 }, (_, c) => ({ wch: widths[c] || 10 }));
    XLSX.utils.book_append_sheet(book, sheet, sheetName(page).slice(0, 31));
  });
  const data = XLSX.write(book, { bookType: 'xlsx', type: 'array' });
  return new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
