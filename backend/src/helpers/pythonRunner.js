// Runs a user's Python script against a translation dataset, for the
// Tools > AI > Transformers page.
//
// This is arbitrary code execution on the API host, and it is NOT a sandbox:
// the script runs as the same OS user as this server and can read anything
// that user can. What stands between it and everyone is the
// 'transformers:execute' permission, which is deliberately left out of the
// defaults so an administrator grants it per account. The measures below keep
// an honest script from doing damage by accident — a runaway loop, a flood of
// output, the server's own secrets showing up in os.environ — and nothing
// more.

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PYTHON_BIN = process.env.PYTHON_BIN
  // On Windows "python3" is usually the Microsoft Store stub, which prints an
  // install hint and exits instead of running anything.
  || (process.platform === 'win32' ? 'python' : 'python3');

// Generous by default: the first run of a transformers model downloads it.
const TIMEOUT_MS = Math.max(5000, Number(process.env.PYTHON_TIMEOUT_MS) || 5 * 60 * 1000);
const MAX_CONCURRENT = Math.max(1, Number(process.env.PYTHON_MAX_CONCURRENT) || 2);

/** Per stream. Past this the output is cut off and flagged as such. */
const MAX_OUTPUT_BYTES = 256 * 1024;
export const MAX_CODE_LENGTH = 100 * 1024;

/*
 * The child gets what Python and Hugging Face need to find themselves and
 * their caches — and nothing else. Passing process.env through would hand
 * every script MONGODB_URI, JWT_SECRET and the API keys.
 */
const INHERITED_ENV = [
  'PATH', 'PATHEXT', 'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR',
  'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'LANG', 'LC_ALL',
  'VIRTUAL_ENV', 'CONDA_PREFIX', 'PYTHONPATH', 'PYTHONHOME',
  'HF_HOME', 'HF_ENDPOINT', 'HF_HUB_OFFLINE', 'HF_TOKEN', 'TRANSFORMERS_CACHE', 'TRANSFORMERS_OFFLINE',
  'CUDA_VISIBLE_DEVICES', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY',
];

const childEnv = (extra) => {
  const env = {};
  for (const key of INHERITED_ENV) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  // UTF-8 both ways, or a Windows console codepage mangles every non-Latin
  // sentence in a translation dataset.
  return { ...env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', PYTHONUNBUFFERED: '1', ...extra };
};

/*
 * Imported by scripts as `ks_dataset`. Written next to the script rather than
 * installed anywhere, so there is nothing to set up on the host.
 */
const HELPER_MODULE = `"""The dataset this run was started with.

dataset.jsonl holds one row per line in the Hugging Face translation layout:
    {"translation": {"en": "Hello", "es": "Hola"}}
"""
import json
import os

PATH = os.environ.get("DATASET_PATH", "")
NAME = os.environ.get("DATASET_NAME", "")
LANGUAGES = [code for code in os.environ.get("DATASET_LANGUAGES", "").split(",") if code]


def load():
    """Every row, as {"translation": {language: text}}."""
    if not PATH:
        return []
    with open(PATH, encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def pairs(source, target):
    """(source, target) text pairs, skipping rows where either side is blank."""
    result = []
    for row in load():
        texts = row["translation"]
        if texts.get(source) and texts.get(target):
            result.append((texts[source], texts[target]))
    return result


def to_hf():
    """The rows as a datasets.Dataset (needs \`pip install datasets\`)."""
    from datasets import Dataset
    return Dataset.from_list(load())
`;

const PROBE_SCRIPT = [
  'import importlib.util, json, sys',
  'names = ["transformers", "datasets", "torch", "sentencepiece"]',
  'print(json.dumps({"version": sys.version.split()[0], "executable": sys.executable,',
  '  "packages": {n: importlib.util.find_spec(n) is not None for n in names}}))',
].join('\n');

let running = 0;
const runningOwners = new Set();

const collect = (stream) => {
  const chunks = [];
  let size = 0;
  let truncated = false;
  stream.on('data', (chunk) => {
    if (size >= MAX_OUTPUT_BYTES) {
      truncated = true;
      return;
    }
    const room = MAX_OUTPUT_BYTES - size;
    if (chunk.length > room) truncated = true;
    const kept = chunk.subarray(0, room);
    chunks.push(kept);
    size += kept.length;
  });
  return () => ({ text: Buffer.concat(chunks).toString('utf8'), truncated });
};

/**
 * Spawn Python and wait for it, killing it at the deadline.
 * Resolves in every case — a missing interpreter is reported, not thrown.
 */
const runProcess = (args, { cwd, env, timeoutMs }) => new Promise((resolve) => {
  const started = Date.now();
  let child;
  try {
    child = spawn(PYTHON_BIN, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    resolve({ spawnError: error.message });
    return;
  }

  const stdout = collect(child.stdout);
  const stderr = collect(child.stderr);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
  }, timeoutMs);

  child.on('error', (error) => {
    clearTimeout(timer);
    resolve({ spawnError: error.code === 'ENOENT' ? `"${PYTHON_BIN}" was not found on the server.` : error.message });
  });
  child.on('close', (exitCode, signal) => {
    clearTimeout(timer);
    resolve({
      exitCode,
      signal,
      timedOut,
      durationMs: Date.now() - started,
      stdout: stdout(),
      stderr: stderr(),
    });
  });
});

/** Which Python the server will use, and whether the ML packages are there. */
export const probePython = async () => {
  const result = await runProcess(['-c', PROBE_SCRIPT], { cwd: os.tmpdir(), env: childEnv({}), timeoutMs: 20000 });
  if (result.spawnError) return { available: false, bin: PYTHON_BIN, message: result.spawnError };
  if (result.exitCode !== 0) {
    return { available: false, bin: PYTHON_BIN, message: result.stderr.text.trim() || result.stdout.text.trim() };
  }
  try {
    return { available: true, bin: PYTHON_BIN, timeoutMs: TIMEOUT_MS, ...JSON.parse(result.stdout.text) };
  } catch {
    return { available: false, bin: PYTHON_BIN, message: result.stdout.text.trim() };
  }
};

export class RunnerBusyError extends Error {
  constructor(message) {
    super(message);
    this.status = 429;
  }
}

/**
 * Run `code` with `dataset` written beside it as dataset.jsonl.
 * The working directory is a fresh temp folder, removed afterwards.
 */
export const runPythonScript = async ({ ownerId, code, dataset }) => {
  if (runningOwners.has(ownerId)) throw new RunnerBusyError('You already have a script running. Wait for it to finish.');
  if (running >= MAX_CONCURRENT) throw new RunnerBusyError('The server is already running as many scripts as it allows. Try again shortly.');

  running += 1;
  runningOwners.add(ownerId);
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ks-python-'));

  try {
    const datasetPath = path.join(workDir, 'dataset.jsonl');
    const lines = (dataset?.rows || []).map((row) => JSON.stringify({ translation: row.texts }));
    await Promise.all([
      fs.writeFile(datasetPath, lines.length ? `${lines.join('\n')}\n` : '', 'utf8'),
      fs.writeFile(path.join(workDir, 'ks_dataset.py'), HELPER_MODULE, 'utf8'),
      fs.writeFile(path.join(workDir, 'main.py'), code, 'utf8'),
    ]);

    const result = await runProcess(['main.py'], {
      cwd: workDir,
      timeoutMs: TIMEOUT_MS,
      env: childEnv({
        DATASET_PATH: dataset ? datasetPath : '',
        DATASET_NAME: dataset?.name || '',
        DATASET_LANGUAGES: (dataset?.languages || []).join(','),
      }),
    });

    if (result.spawnError) {
      const error = new Error(result.spawnError);
      error.status = 503;
      throw error;
    }
    return { ...result, timeoutMs: TIMEOUT_MS };
  } finally {
    running -= 1;
    runningOwners.delete(ownerId);
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
};
