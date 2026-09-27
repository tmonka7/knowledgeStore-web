// A page read by OCR (backend/python/ocr_worker.py), as a document: its
// geometry, its tables made safe to show, and its content in reading order —
// shared by the OCR page, which draws it, and by the Word, Excel, HTML and
// text exports (lib/ocrExport.js).
//
// A page is { page, width, height, dpi, image, lines, blocks }: lines are
// { text, score, box: [[x, y] x 4], color, bold, role, region }, and blocks
// are tables { type: 'table', box, html, columns, rows } and figures
// { type: 'figure', box, image }, all in the page's pixels.

/** Lines the model was less sure of than this are left out (specks, stray marks). */
export const MIN_SCORE = 0.5;

export const center = (box) => [
  box.reduce((sum, [x]) => sum + x, 0) / box.length,
  box.reduce((sum, [, y]) => sum + y, 0) / box.length,
];
export const inside = ([x, y], [x1, y1, x2, y2]) => x >= x1 && x <= x2 && y >= y1 && y <= y2;
const side = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
/** A line's height and length in the page's pixels: the mean of its two sides. */
export const lineHeight = (box) => Math.max(1, (side(box[0], box[3]) + side(box[1], box[2])) / 2);
export const lineWidth = (box) => Math.max(1, (side(box[0], box[1]) + side(box[3], box[2])) / 2);
const bounds = (box) => {
  const xs = box.map(([x]) => x);
  const ys = box.map(([, y]) => y);
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
};

/**
 * Pixels per inch of a page: known for a PDF (rendered at a set resolution);
 * for an image, taken as an A4 page's width, which is what a scan or photo of
 * a document usually is.
 */
export const pageDpi = (page) => page.dpi || page.width / 8.27;
/** The type size of a line, in points: about three quarters of its box. */
export const linePoints = (page, line) => (lineHeight(line.box) * 0.75 * 72) / pageDpi(page);

const COLOR = /^#[0-9a-f]{6}$/i;
const ALLOWED = new Set(['TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'BR', 'B', 'SPAN']);

/**
 * The table HTML the server rebuilt, reduced to table markup — table
 * elements, line breaks, bold, and colour spans; colspan/rowspan and a colour
 * are the only attributes kept, whatever it contains — with the original's
 * column widths and row heights when the server measured them.
 */
export const cleanTable = (html, block = {}) => {
  const source = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const copy = (node, into) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        into.appendChild(document.createTextNode(child.textContent));
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        if (!ALLOWED.has(child.tagName)) {
          copy(child, into);
          return;
        }
        const element = document.createElement(child.tagName);
        ['colspan', 'rowspan'].forEach((name) => {
          const value = Number(child.getAttribute(name));
          if (value > 1 && value < 100) element.setAttribute(name, String(value));
        });
        const color = child.tagName === 'SPAN' && child.style.color && rgbToHex(child.style.color);
        if (color) element.style.color = color;
        copy(child, element);
        into.appendChild(element);
      }
    });
  };
  const holder = document.createElement('div');
  copy(source.body, holder);
  const table = holder.querySelector('table');
  if (table && block.box) {
    const [x1, y1, x2, y2] = block.box;
    const edges = block.columns || [];
    if (edges.length > 2) {
      const colgroup = document.createElement('colgroup');
      for (let i = 1; i < edges.length; i += 1) {
        const col = document.createElement('col');
        col.style.width = `${(((edges[i] - edges[i - 1]) / (x2 - x1)) * 100).toFixed(2)}%`;
        colgroup.appendChild(col);
      }
      table.prepend(colgroup);
    }
    const rows = table.querySelectorAll('tr');
    const tops = block.rows || [];
    if (tops.length === rows.length + 1) {
      rows.forEach((row, i) => { row.style.height = `${(((tops[i + 1] - tops[i]) / (y2 - y1)) * 100).toFixed(2)}%`; });
    }
  }
  return holder.innerHTML;
};

function rgbToHex(value) {
  if (COLOR.test(value)) return value.toLowerCase();
  const match = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(value);
  return match ? `#${match.slice(1).map((n) => Number(n).toString(16).padStart(2, '0')).join('')}` : '';
}

/** A table's rows as a grid: [{ text, bold, color, colspan, rowspan }] per row. */
export const tableCells = (html) => [...new DOMParser().parseFromString(html, 'text/html').querySelectorAll('tr')]
  .map((row) => [...row.querySelectorAll('td, th')].map((cell) => {
    const bold = cell.querySelector('b') !== null && cell.textContent.trim() === [...cell.querySelectorAll('b')].map((b) => b.textContent).join(' ').trim();
    const span = cell.querySelector('span');
    return {
      // Line breaks in a cell stay line breaks.
      text: [...cell.childNodes].map((node) => (node.nodeName === 'BR' ? '\n' : node.textContent)).join('').trim(),
      bold,
      color: span ? rgbToHex(span.style.color) : '',
      colspan: Number(cell.getAttribute('colspan')) || 1,
      rowspan: Number(cell.getAttribute('rowspan')) || 1,
    };
  }));

/**
 * What the OCR page and the exports need of one page: the lines kept, its
 * tables and figures, and which of those each line is in.
 */
export const preparePage = (page, minScore = MIN_SCORE) => {
  const blocks = (page.blocks || []).map((block, index) => ({
    ...block, index, html: block.type === 'table' ? cleanTable(block.html || '', block) : undefined,
  }));
  const lines = page.lines.map((line, index) => {
    const at = center(line.box);
    const block = line.role === 'table' || line.role === 'figure' ? blocks.find((item) => inside(at, item.box)) : null;
    return { ...line, index, block: block ? block.index : null, inTable: block?.type === 'table' };
  }).filter((line) => line.score >= minScore);
  return { ...page, blocks, lines };
};

const CJK = /[぀-ヿ㐀-鿿가-힯豈-﫿＀-￯]/;
/** Two lines of one paragraph, joined as the script wants: no space for CJK, none across a hyphenated break. */
const joinText = (before, after) => {
  if (/[a-z]-$/i.test(before) && /^[a-z]/.test(after)) return `${before.slice(0, -1)}${after}`;
  if (CJK.test(before.slice(-1)) || CJK.test(after[0])) return `${before}${after}`;
  return `${before} ${after}`;
};

/**
 * The page's content in reading order: paragraphs, tables and figures, each
 * with its extent on the page. Lines inside a table or figure belong to it.
 *
 * A line continues the paragraph just above it when it follows closely,
 * starts where that paragraph starts, and is of the same size, weight, colour
 * and role (a caption never runs into the text above it). Starting where the
 * paragraph starts keeps two columns apart; a line level with the
 * paragraph's last one (a label and its value) joins it on the same line.
 * Layout regions are not used: the model often gives each line of a short
 * paragraph a region of its own.
 */
export const readingOrder = (page) => {
  const free = page.lines.filter((line) => line.block === null)
    .map((line) => ({ ...line, ...bounds(line.box), height: lineHeight(line.box) }))
    .sort((a, b) => a.top - b.top || a.left - b.left);

  const items = [];
  const open = []; // paragraphs a later line may still continue
  free.forEach((line) => {
    const fits = (paragraph) => {
      const previous = paragraph.lines[paragraph.lines.length - 1];
      if ((line.role || 'text') !== (previous.role || 'text')) return null;
      const overlap = Math.min(previous.bottom, line.bottom) - Math.max(previous.top, line.top);
      // Level with the last line and close after it: a label and its value.
      // Further off it is another column.
      const gap = line.left - previous.right;
      if (overlap > Math.min(previous.height, line.height) / 2 && gap >= -previous.height && gap < previous.height * 3) {
        return { sameRow: true };
      }
      const follows = line.top - previous.bottom < previous.height * 0.9 && line.top > previous.top
        && Math.abs(line.height / previous.height - 1) < 0.25
        && Math.abs(line.left - paragraph.left) < previous.height * 1.5
        && Boolean(line.bold) === Boolean(previous.bold)
        && (line.color || '#000000') === (previous.color || '#000000');
      return follows ? { sameRow: false } : null;
    };
    let paragraph = null;
    let how = null;
    for (let i = open.length - 1; i >= 0 && !paragraph; i -= 1) {
      how = fits(open[i]);
      if (how) paragraph = open[i];
    }
    if (!paragraph) {
      paragraph = {
        type: 'paragraph', lines: [], left: line.left, right: line.right, top: line.top, bottom: line.bottom,
      };
      items.push(paragraph);
      open.push(paragraph);
      how = { sameRow: false };
    }
    paragraph.lines.push({ ...line, sameRow: how.sameRow });
    paragraph.left = Math.min(paragraph.left, line.left);
    paragraph.right = Math.max(paragraph.right, line.right);
    paragraph.bottom = Math.max(paragraph.bottom, line.bottom);
    // A paragraph far above the current line can take no more.
    for (let i = open.length - 1; i >= 0; i -= 1) {
      const last = open[i].lines[open[i].lines.length - 1];
      if (line.top - last.bottom > last.height * 3) open.splice(i, 1);
    }
  });
  items.forEach((item) => {
    item.text = item.lines.reduce((text, line, i) => {
      if (i === 0) return line.text;
      return line.sameRow ? `${text}\t${line.text}` : joinText(text, line.text);
    }, '');
  });
  page.blocks.forEach((block) => {
    const [left, top, right, bottom] = block.box;
    items.push({ type: block.type, block, left, top, right, bottom });
  });
  return xyCut(items, Math.max(12, page.width * 0.01));
};

/**
 * Reading order by recursive XY-cut: where a clear gutter runs down between
 * the items, the left side is read before the right; where there is none,
 * what is above the first gap across the page comes first. A heading across
 * two columns is thus read first, then each column top to bottom.
 */
function xyCut(items, gutter) {
  if (items.length <= 1) return items;
  const gaps = (start, end) => {
    const spans = items.map((item) => [start(item), end(item)]).sort((a, b) => a[0] - b[0]);
    const cuts = [];
    let reach = spans[0][1];
    spans.slice(1).forEach(([from, to]) => {
      if (from - reach >= (start === left ? gutter : 1)) cuts.push((reach + from) / 2);
      reach = Math.max(reach, to);
    });
    return cuts;
  };
  const columns = gaps(left, right);
  if (columns.length) {
    const cut = columns[0];
    return [...xyCut(items.filter((item) => item.right <= cut), gutter), ...xyCut(items.filter((item) => item.left > cut), gutter)];
  }
  const rows = gaps(top, bottom);
  if (rows.length) {
    const cut = rows[0];
    return [...xyCut(items.filter((item) => item.bottom <= cut), gutter), ...xyCut(items.filter((item) => item.top > cut), gutter)];
  }
  // Overlapping every way (a figure with text over it): top to bottom, then left to right.
  return [...items].sort((a, b) => (Math.abs(a.top - b.top) < 8 ? a.left - b.left : a.top - b.top));
}
const left = (item) => item.left;
const right = (item) => item.right;
const top = (item) => item.top;
const bottom = (item) => item.bottom;

/** A page's text in reading order: a paragraph a line, each table as tab-separated rows. */
export const pageText = (page) => readingOrder(page).map((item) => {
  if (item.type === 'paragraph') return item.text;
  if (item.type === 'table') return tableCells(item.block.html).map((row) => row.map((cell) => cell.text.replace(/\n/g, ' ')).join('\t')).join('\n');
  return null;
}).filter((text) => text !== null).join('\n');
