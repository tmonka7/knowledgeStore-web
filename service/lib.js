'use strict';

// Shared plumbing for install.js / uninstall.js / status.js.

const { execFile } = require('node:child_process');

/*
 * Installing, removing or configuring a service all need an elevated token.
 * node-windows will raise its own UAC prompt, but that prompt runs the command
 * in a window that closes on failure, so the error is never seen. Refusing up
 * front and asking for an elevated terminal keeps the output where it is read.
 */
const isElevated = () =>
  new Promise((resolve) => {
    // fltmc needs administrator rights and changes nothing when merely listed.
    execFile('fltmc.exe', ['filters'], (err) => resolve(!err));
  });

const sc = (args) =>
  new Promise((resolve, reject) => {
    execFile('sc.exe', args, (err, stdout, stderr) => {
      if (err) {
        reject(new Error((stderr || stdout || err.message).trim()));
        return;
      }
      resolve(stdout);
    });
  });

/*
 * node-windows reports through events rather than callbacks, and reports the
 * uninteresting outcomes ("already installed", "already stopped") through their
 * own events rather than as errors. This turns one such exchange into a promise
 * that resolves with whichever event arrived.
 */
const settle = (svc, outcomes, action, timeoutMs = 90000) =>
  new Promise((resolve, reject) => {
    const names = [...Object.keys(outcomes), 'error'];
    // winsw is driven through a detached elevated command, and node-windows has
    // no event for "that command did nothing". Without a deadline a failure
    // there reads as a script that simply never returns.
    const timer = setTimeout(
      () => done(new Error(`${svc.name}: no response after ${timeoutMs / 1000}s`)),
      timeoutMs,
    );

    const done = (result) => {
      clearTimeout(timer);
      names.forEach((name) => svc.removeListener(name, handlers[name]));
      if (result instanceof Error) reject(result);
      else resolve(result);
    };

    const handlers = { error: (err) => done(err instanceof Error ? err : new Error(String(err))) };
    Object.entries(outcomes).forEach(([name, label]) => {
      handlers[name] = () => done(label);
    });
    names.forEach((name) => svc.on(name, handlers[name]));

    try {
      action();
    } catch (err) {
      done(err);
    }
  });

// winsw registers each service under node-windows' id, which carries an ".exe"
// suffix. Everything a person types at sc.exe or the Services console uses it.
const serviceName = (svc) => svc._exe;

const state = async (svc) => {
  try {
    const out = await sc(['query', serviceName(svc)]);
    const match = out.match(/STATE\s+:\s+\d+\s+(\w+)/);
    return match ? match[1] : 'UNKNOWN';
  } catch {
    return 'NOT INSTALLED';
  }
};

module.exports = { isElevated, sc, settle, serviceName, state };
