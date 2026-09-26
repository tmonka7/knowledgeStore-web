import { randomUUID } from 'crypto';
import {
  createTranslationDataset,
  getTranslationDatasetById,
  getTranslationDatasetSummaries,
} from '../models/translationDatasetModel.js';
import { MAX_CODE_LENGTH, probePython, runPythonScript } from '../helpers/pythonRunner.js';

// Sized so a full dataset still fits inside express.json's 3mb body limit.
const MAX_LANGUAGES = 12;
const MAX_ROWS = 5000;
const MAX_TEXT_LENGTH = 2000;

/*
 * BCP 47-ish ("en", "pt-BR", "zh-Hans") plus the underscore form NLLB and
 * M2M models use ("eng_Latn"). It also keeps the codes safe as Mongo map keys,
 * which may not contain "." or start with "$".
 */
const LANGUAGE_CODE = /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/;

const asPlain = (document) => {
  const plain = document?.toObject ? document.toObject({ flattenMaps: true }) : document;
  if (!plain) return plain;
  const { _id, __v, ...rest } = plain;
  return rest;
};

/** Normalises the body, or returns { error } describing the first problem. */
const datasetFields = (body = {}) => {
  const name = String(body.name || '').trim().slice(0, 120);
  if (!name) return { error: 'A dataset name is required.' };

  const languages = Array.isArray(body.languages)
    ? [...new Set(body.languages.map((code) => String(code).trim()).filter(Boolean))]
    : [];
  if (languages.length < 2) return { error: 'A translation dataset needs at least two languages.' };
  if (languages.length > MAX_LANGUAGES) return { error: `A dataset can have at most ${MAX_LANGUAGES} languages.` };
  const invalid = languages.find((code) => !LANGUAGE_CODE.test(code));
  if (invalid) return { error: `"${invalid}" is not a language code (use e.g. en, pt-BR or eng_Latn).` };

  const rawRows = Array.isArray(body.rows) ? body.rows : [];
  if (rawRows.length > MAX_ROWS) return { error: `A dataset can have at most ${MAX_ROWS} rows.` };

  const rows = [];
  for (const raw of rawRows) {
    const texts = {};
    for (const code of languages) {
      const text = String(raw?.texts?.[code] ?? '').trim();
      if (text.length > MAX_TEXT_LENGTH) {
        return { error: `A ${code} entry is longer than ${MAX_TEXT_LENGTH} characters.` };
      }
      texts[code] = text;
    }
    // A row with nothing in it is an untouched "add row" click, not data.
    if (!Object.values(texts).some(Boolean)) continue;
    const id = String(raw?.id || '').trim().slice(0, 64) || randomUUID();
    rows.push({ id, texts });
  }

  return { fields: { name, languages, rows } };
};

export const listTranslationDatasets = async (req, res) => {
  const datasets = await getTranslationDatasetSummaries(req.user.sub);
  return res.json({ datasets });
};

export const getTranslationDataset = async (req, res) => {
  const dataset = await getTranslationDatasetById(req.user.sub, req.params.id);
  if (!dataset) return res.status(404).json({ message: 'Dataset not found.' });
  return res.json({ dataset: asPlain(dataset) });
};

export const createTranslationDatasetRecord = async (req, res) => {
  const { fields, error } = datasetFields(req.body);
  if (error) return res.status(400).json({ message: error });

  const created = await createTranslationDataset({ ...fields, ownerId: req.user.sub });
  return res.status(201).json({ dataset: asPlain(created) });
};

/** PUT replaces the whole dataset: the editor always holds all of it. */
export const updateTranslationDataset = async (req, res) => {
  const existing = await getTranslationDatasetById(req.user.sub, req.params.id);
  if (!existing) return res.status(404).json({ message: 'Dataset not found.' });

  const { fields, error } = datasetFields(req.body);
  if (error) return res.status(400).json({ message: error });

  Object.assign(existing, fields, { updatedAt: new Date() });
  await existing.save();
  return res.json({ dataset: asPlain(existing) });
};

export const deleteTranslationDataset = async (req, res) => {
  const existing = await getTranslationDatasetById(req.user.sub, req.params.id);
  if (!existing) return res.status(404).json({ message: 'Dataset not found.' });

  await existing.deleteOne();
  return res.json({ ok: true });
};

/** GET /tools/transformers/python — lets the page say what the server has. */
export const pythonCapabilities = async (req, res) => res.json({ python: await probePython() });

/**
 * POST /tools/transformers/run
 *
 * Runs the posted script, optionally against one of the caller's own datasets
 * — the id is looked up under their ownerId, so it cannot reach anyone else's.
 */
export const runTranslationScript = async (req, res) => {
  const code = String(req.body?.code || '');
  if (!code.trim()) return res.status(400).json({ message: 'There is no code to run.' });
  if (code.length > MAX_CODE_LENGTH) return res.status(400).json({ message: 'That script is too long.' });

  let dataset = null;
  const datasetId = String(req.body?.datasetId || '').trim();
  if (datasetId) {
    const found = await getTranslationDatasetById(req.user.sub, datasetId);
    if (!found) return res.status(404).json({ message: 'Dataset not found.' });
    dataset = asPlain(found);
  }

  const result = await runPythonScript({ ownerId: req.user.sub, code, dataset });
  return res.json({
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    timeoutMs: result.timeoutMs,
    durationMs: result.durationMs,
    stdout: result.stdout.text,
    stdoutTruncated: result.stdout.truncated,
    stderr: result.stderr.text,
    stderrTruncated: result.stderr.truncated,
  });
};
