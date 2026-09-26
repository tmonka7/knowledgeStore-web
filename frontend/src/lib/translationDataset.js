/*
 * Parallel-text datasets for the Transformers page: reading them in from the
 * formats people already have them in, and writing them back out.
 *
 * A dataset is { name, languages, rows }, where each row is
 * { id, texts: { [languageCode]: text } } and languages[0] is the source.
 * JSONL export uses the Hugging Face translation layout,
 *   {"translation": {"en": "Hello", "es": "Hola"}}
 * which `datasets.load_dataset("json", data_files=...)` reads as-is.
 */

export const MAX_ROWS = 5000;

/** Suggestions only — any code the API accepts can be typed in. */
export const COMMON_LANGUAGES = [
  ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'],
  ['pt', 'Portuguese'], ['nl', 'Dutch'], ['ru', 'Russian'], ['uk', 'Ukrainian'], ['pl', 'Polish'],
  ['tr', 'Turkish'], ['ar', 'Arabic'], ['he', 'Hebrew'], ['hi', 'Hindi'], ['bn', 'Bengali'],
  ['zh', 'Chinese'], ['ja', 'Japanese'], ['ko', 'Korean'], ['vi', 'Vietnamese'], ['th', 'Thai'],
  ['id', 'Indonesian'], ['ms', 'Malay'], ['sv', 'Swedish'], ['fi', 'Finnish'], ['el', 'Greek'],
];

/** Same rule as the API, so a bad code is caught before the save. */
export const LANGUAGE_CODE = /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/;

export const newRowId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export const emptyRow = (languages) => ({
  id: newRowId(),
  texts: Object.fromEntries(languages.map((code) => [code, ''])),
});

/** Rows with text in every language — the ones a model can train on. */
export const countComplete = (rows, languages) => rows
  .filter((row) => languages.every((code) => String(row.texts?.[code] || '').trim()))
  .length;

/**
 * RFC 4180-style parsing: quoted fields may hold the delimiter, doubled quotes
 * and line breaks. Hand-rolled because a split on commas breaks on the first
 * sentence that contains one, which in a translation corpus is most of them.
 */
export const parseDelimited = (text, delimiter) => {
  const records = [];
  let record = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"' && field === '') {
      quoted = true;
    } else if (char === delimiter) {
      record.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field !== '' || record.length) {
    record.push(field);
    records.push(record);
  }
  return records.filter((row) => row.some((cell) => cell.trim() !== ''));
};

const quoteCsv = (value) => {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/**
 * Turn pasted or uploaded text into rows for `languages`.
 *
 * JSONL rows may be {"translation": {...}} or flat {"en": ..., "es": ...}.
 * Delimited text is matched to languages by its header when the header names
 * them, and by column order otherwise — which is what a paste from a
 * spreadsheet with no header row needs.
 *
 * @returns {{ rows, languages }} languages found in the input, in order.
 */
export const parseImport = (text, languages, format = 'auto') => {
  const trimmed = String(text || '').replace(/^﻿/, '').trim();
  if (!trimmed) return { rows: [], languages };

  const looksJson = trimmed.startsWith('{') || trimmed.startsWith('[');
  if (format === 'jsonl' || (format === 'auto' && looksJson)) {
    const objects = trimmed.startsWith('[')
      ? JSON.parse(trimmed)
      : trimmed.split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
        try {
          return JSON.parse(line);
        } catch {
          throw new Error(`Line ${index + 1} is not valid JSON.`);
        }
      });

    const found = [];
    const rows = objects.map((object) => {
      const texts = object?.translation && typeof object.translation === 'object' ? object.translation : object;
      const row = { id: newRowId(), texts: {} };
      Object.entries(texts || {}).forEach(([code, value]) => {
        if (!LANGUAGE_CODE.test(code) || typeof value !== 'string') return;
        if (!found.includes(code)) found.push(code);
        row.texts[code] = value;
      });
      return row;
    });
    return { rows, languages: found.length ? found : languages };
  }

  const delimiter = format === 'csv' ? ','
    : format === 'tsv' ? '\t'
      : trimmed.split(/\r?\n/, 1)[0].includes('\t') ? '\t' : ',';
  const records = parseDelimited(trimmed, delimiter);
  if (!records.length) return { rows: [], languages };

  const header = records[0].map((cell) => cell.trim());
  const hasHeader = header.length > 1 && header.every((cell) => LANGUAGE_CODE.test(cell));
  const columns = hasHeader ? header : languages;
  const body = hasHeader ? records.slice(1) : records;

  const rows = body.map((record) => ({
    id: newRowId(),
    texts: Object.fromEntries(columns.map((code, index) => [code, (record[index] || '').trim()])),
  }));
  return { rows, languages: columns };
};

export const buildJsonl = (dataset) => dataset.rows
  .map((row) => JSON.stringify({
    translation: Object.fromEntries(dataset.languages.map((code) => [code, row.texts?.[code] || ''])),
  }))
  .join('\n');

export const buildDelimited = (dataset, delimiter) => {
  const clean = delimiter === '\t'
    // TSV has no quoting, so tabs and line breaks inside a sentence become spaces.
    ? (value) => String(value ?? '').replace(/[\t\r\n]+/g, ' ')
    : quoteCsv;
  const lines = [dataset.languages.map(clean).join(delimiter)];
  dataset.rows.forEach((row) => {
    lines.push(dataset.languages.map((code) => clean(row.texts?.[code] || '')).join(delimiter));
  });
  return `${lines.join('\r\n')}\r\n`;
};

export const safeFileName = (name) => String(name || 'dataset').trim().replace(/[^\w.-]+/g, '_') || 'dataset';

export const downloadText = (filename, text, type) => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
