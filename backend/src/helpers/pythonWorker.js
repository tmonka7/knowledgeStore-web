// A long-running Python worker that keeps a model loaded between requests —
// used by Voice recognition (whisper_cpp_worker.py) and Speaker recognition
// (speaker_worker.py).
//
// Protocol: one JSON object per line. The worker's first line is
// {"ready": true, ...} or {"fatal": "..."}; after that it answers each
// {"id", ...request} with {"id", "ok": true, ...} or {"id", "ok": false, "error"},
// and may send {"id", "progress": true, ...} lines before that answer.
//
// Requests are queued and sent one at a time: each model already uses every
// core for one. A worker that dies is started again on the next request, one
// that hangs past a request's time limit is killed, and one left idle is
// stopped to give the memory back.

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import readline from 'node:readline';
import { PYTHON_BIN } from './pythonRunner.js';
import { JobError, PYTHON_DIR, pythonEnv } from './translationJobs.js';

const START_TIMEOUT_MS = 90 * 1000;

/** The last lines the worker wrote to stderr, to say why it failed. */
const lastLines = (text, count = 3) => text.trim().split(/\r?\n/).filter(Boolean).slice(-count).join(' ');

/**
 * @param script    file in backend/python
 * @param label     how errors name it ("whisper.cpp", "speaker recognition")
 * @param env       extra environment variables for the child
 * @param idleMs    stop after this long without requests
 * @param maxWaiting turn requests away (429) past this many queued
 * @param startMs   how long the worker may take to say it is ready
 */
export const createPythonWorker = ({
  script, label, env = {}, idleMs = 600000, maxWaiting = 8, startMs = START_TIMEOUT_MS,
}) => {
  let worker = null; // { child, ready: Promise, pending: Map, stderr }
  let idleTimer = null;
  let queue = Promise.resolve();
  let waiting = 0;

  const stop = () => {
    clearTimeout(idleTimer);
    worker?.child.kill();
    worker = null;
  };

  const armIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (!waiting) stop();
    }, idleMs);
    idleTimer.unref?.();
  };

  const start = () => {
    const child = spawn(PYTHON_BIN, [path.join(PYTHON_DIR, script)], {
      cwd: PYTHON_DIR,
      env: { ...pythonEnv(), ...env },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const state = { child, pending: new Map(), stderr: '' };

    state.ready = new Promise((resolve, reject) => {
      // Killed, not left running: a new worker is started on the next
      // request, and one still loading beside it only slows both down.
      const timer = setTimeout(() => {
        const output = lastLines(state.stderr);
        child.kill();
        reject(new JobError(`The ${label} worker did not start within ${Math.round(startMs / 1000)} s.${
          output ? ` Its last output: ${output}` : ''}`, 503));
      }, startMs);
      // A worker that dies while starting (a missing DLL, a crash on import)
      // says why at once, rather than after the time limit. 'close', not
      // 'exit': it comes after the last of stderr has been read.
      child.on('close', (code) => {
        clearTimeout(timer);
        reject(new JobError(`The ${label} worker stopped while starting (${lastLines(state.stderr) || `exit code ${code}`}).`, 503));
      });
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
        } else if (message.progress && state.pending.has(message.id)) {
          state.pending.get(message.id).progress?.(message);
        } else if (state.pending.has(message.id)) {
          const { resolve: done, reject: failed } = state.pending.get(message.id);
          state.pending.delete(message.id);
          if (message.ok) {
            done(message);
          } else {
            const error = new JobError(message.error || `${label} failed.`);
            error.cancelled = Boolean(message.cancelled);
            failed(error);
          }
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
        reject(new JobError(`The ${label} worker stopped (${reason}).`, 500));
      }
      state.pending.clear();
    });
    return state;
  };

  const send = async (request, timeoutMs, { id = randomUUID(), onProgress, isCancelled } = {}) => {
    // Cancelled while it waited its turn: not sent at all.
    if (isCancelled?.()) {
      const error = new JobError('cancelled');
      error.cancelled = true;
      throw error;
    }
    if (!worker) worker = start();
    const current = worker;
    await current.ready;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        current.pending.delete(id);
        // A stuck model cannot be interrupted from here: restart the worker.
        if (worker === current) stop();
        reject(new JobError(`${label} took too long and was stopped.`, 504));
      }, timeoutMs);
      current.pending.set(id, {
        progress: onProgress,
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      current.child.stdin.write(`${JSON.stringify({ id, ...request })}\n`);
    });
  };

  return {
    /** Start the worker if needed; resolves to its ready message, or rejects with why it cannot run. */
    ready: async () => {
      if (!worker) worker = start();
      const info = await worker.ready;
      armIdle();
      return info;
    },

    /**
     * Queue one request; resolves to the worker's reply. `options.id` names
     * the request (to cancel it with notify), `options.onProgress` receives
     * its progress lines, and `options.isCancelled` is asked before it is
     * sent, so a request cancelled while it waits never reaches the worker.
     */
    request: async (payload, timeoutMs, busyMessage = `${label} is busy; try again in a moment.`, options = {}) => {
      if (waiting >= maxWaiting) throw new JobError(busyMessage, 429);
      waiting += 1;
      const turn = queue.then(() => send(payload, timeoutMs, options));
      queue = turn.catch(() => {});
      try {
        return await turn;
      } finally {
        waiting -= 1;
        armIdle();
      }
    },

    /** Send a line that expects no answer (such as a cancel) to a running worker; false if none. */
    notify: (payload) => {
      if (!worker?.child.stdin.writable) return false;
      worker.child.stdin.write(`${JSON.stringify(payload)}\n`);
      return true;
    },

    stop,
  };
};
