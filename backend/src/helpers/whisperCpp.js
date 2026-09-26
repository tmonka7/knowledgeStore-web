// Voice recognition with whisper.cpp for Tools > AI > Speech to Text.
//
// One long-running Python worker (backend/python/whisper_cpp_worker.py) keeps
// the ggml models loaded, so a spoken phrase is recognised in well under a
// second instead of paying for a model load each time. Requests are queued
// and sent one at a time — whisper.cpp already uses every core for one — and a
// worker that dies is started again on the next request. It is stopped after
// a while without work, which gives the memory back.

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import readline from 'node:readline';
import { PYTHON_BIN } from './pythonRunner.js';
import {
  JobError, PYTHON_DIR, findModel, listModels, pythonEnv,
} from './translationJobs.js';

export const TASK = 'recognition';

const WORKER = path.join(PYTHON_DIR, 'whisper_cpp_worker.py');
const START_TIMEOUT_MS = 60 * 1000;
const IDLE_MS = Math.max(60, Number(process.env.WHISPER_CPP_IDLE_SECONDS) || 600) * 1000;
const MAX_WAITING = Math.max(1, Number(process.env.WHISPER_CPP_MAX_QUEUE) || 8);

let worker = null; // { child, ready: Promise, pending: Map, stderr }
let idleTimer = null;
let queue = Promise.resolve();
let waiting = 0;

const stopWorker = () => {
  clearTimeout(idleTimer);
  worker?.child.kill();
  worker = null;
};

const armIdle = () => {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!waiting) stopWorker();
  }, IDLE_MS);
  idleTimer.unref?.();
};

const startWorker = () => {
  const child = spawn(PYTHON_BIN, [WORKER], {
    cwd: PYTHON_DIR,
    env: { ...pythonEnv(), WHISPER_CPP_THREADS: process.env.WHISPER_CPP_THREADS || '' },
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const state = { child, pending: new Map(), stderr: '' };

  state.ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new JobError('The whisper.cpp worker did not start in time.', 503)), START_TIMEOUT_MS);
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return; // Not a reply; the worker keeps its own output off this stream.
      }
      if (message.ready) {
        clearTimeout(timer);
        resolve(message);
      } else if (message.fatal) {
        clearTimeout(timer);
        reject(new JobError(message.fatal, 503));
      } else if (state.pending.has(message.id)) {
        const { resolve: done, reject: failed } = state.pending.get(message.id);
        state.pending.delete(message.id);
        if (message.ok) done(message);
        else failed(new JobError(`Recognition failed: ${message.error}`));
      }
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new JobError(error.code === 'ENOENT'
        ? `Python was not found ("${PYTHON_BIN}"). Install Python 3 or set PYTHON_BIN.`
        : error.message, 503));
    });
  });
  // A worker that fails to start is dropped; the next request tries again.
  state.ready.catch(() => {
    if (worker === state) worker = null;
  });

  child.stderr.on('data', (chunk) => {
    state.stderr = (state.stderr + chunk).slice(-4000);
  });
  child.on('exit', (code) => {
    if (worker === state) worker = null;
    const reason = state.stderr.trim().split('\n').slice(-2).join(' ') || `exit code ${code}`;
    for (const { reject } of state.pending.values()) {
      reject(new JobError(`The whisper.cpp worker stopped (${reason}).`, 500));
    }
    state.pending.clear();
  });
  return state;
};

const send = async (request, timeoutMs) => {
  if (!worker) worker = startWorker();
  const current = worker;
  await current.ready;
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => {
      current.pending.delete(id);
      // A stuck decode cannot be interrupted from here: restart the worker.
      if (worker === current) stopWorker();
      reject(new JobError('Recognition took too long and was stopped.', 504));
    }, timeoutMs);
    current.pending.set(id, {
      resolve: (value) => { clearTimeout(timer); resolve(value); },
      reject: (error) => { clearTimeout(timer); reject(error); },
    });
    current.child.stdin.write(`${JSON.stringify({ id, ...request })}\n`);
  });
};

/** The whisper.cpp models on the server (downloaded with download_models.py ggml-tiny …). */
export const recognitionModels = async (ownerId) => (await listModels(ownerId, TASK)).map((model) => ({
  id: model.id,
  name: model.name,
  englishOnly: Boolean(model.englishOnly),
  bytes: Object.values(model.files || {}).reduce((sum, size) => sum + size, 0),
}));

/** Whether recognition can run: models present, and the worker starts. */
export const recognitionStatus = async (ownerId) => {
  const models = await recognitionModels(ownerId);
  let engine = { ok: true, message: '' };
  if (models.length) {
    try {
      if (!worker) worker = startWorker();
      const info = await worker.ready;
      engine = { ok: true, message: '', threads: info.threads };
      armIdle();
    } catch (error) {
      engine = { ok: false, message: error.message };
    }
  }
  return { models, engine };
};

/**
 * Recognise the speech in a WAV file (16 kHz mono PCM from the page).
 * `prompt` is the text said just before, which helps continuity when a long
 * dictation arrives phrase by phrase.
 */
export const recognize = async ({ ownerId, modelId, audioPath, language, translate, prompt, audioSeconds }) => {
  const model = await findModel(ownerId, modelId, TASK);
  const lang = String(language || 'auto').toLowerCase();
  if (!/^(auto|[a-z]{2,3})$/.test(lang)) throw new JobError('Unknown language.');
  if (model.englishOnly && lang !== 'auto' && lang !== 'en') {
    throw new JobError(`${model.name} understands English only; choose a multilingual model for "${lang}".`);
  }
  if (waiting >= MAX_WAITING) throw new JobError('Voice recognition is busy; try again in a moment.', 429);

  // Roughly: a long file may need a few times its own length on a slow CPU.
  const timeoutMs = Math.max(60, (Number(audioSeconds) || 600) * 3) * 1000;
  waiting += 1;
  const turn = queue.then(() => send({
    model: path.join(model.folder, model.file || `${model.id}.bin`),
    audio: audioPath,
    language: model.englishOnly ? 'en' : lang,
    translate: Boolean(translate) && !model.englishOnly,
    prompt: String(prompt || '').slice(-400),
  }, timeoutMs));
  queue = turn.catch(() => {});
  try {
    const result = await turn;
    return { ...result, model: model.id };
  } finally {
    waiting -= 1;
    armIdle();
  }
};
