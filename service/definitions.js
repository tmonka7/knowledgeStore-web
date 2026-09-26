'use strict';

/*
 * The two halves of `npm run dev`, described as Windows services.
 *
 * Wrapping the npm script itself would have put concurrently, npm and nodemon
 * between the Service Control Manager and the two processes that actually hold
 * the ports. Windows would then be supervising a launcher whose health says
 * nothing about whether the app is up, and "stop" would leave the real servers
 * running as orphans. Pointing node straight at each entry point instead means
 * each half is restarted on its own terms and genuinely stops when told to.
 */

const fs = require('node:fs');
const path = require('node:path');
const { Service } = require('node-windows');

const root = path.resolve(__dirname, '..');

// node-windows keeps the generated winsw .exe and .xml next to the *script* by
// default. For the frontend that would be inside node_modules, where the next
// npm install erases them and leaves a registered service pointing at nothing.
// Both services keep their daemon files here instead.
const daemonRoot = __dirname;

const common = {
  // Seconds to wait before the first restart attempt, growing by `grow` each
  // time. Mongo coming up late is the case this is really for.
  wait: 2,
  grow: 0.5,
  maxRestarts: 10,
  stoptimeout: 15,
};

const build = (config) => {
  const svc = new Service({ ...common, ...config });
  svc.directory(daemonRoot);
  return svc;
};

const api = build({
  name: 'Knowledge Store API',
  description:
    'Knowledge Store backend: the Express API and the meeting signalling socket, on the port set in backend/.env.',
  script: path.join(root, 'backend', 'src', 'server.js'),
  /*
   * The backend resolves uploads/ and backups/ against its own cwd, and those
   * directories already exist under backend/ from running it by hand. A service
   * inherits no shell and no cwd, so this has to be said out loud or the files
   * quietly start landing somewhere else.
   */
  workingDirectory: path.join(root, 'backend'),
});

const web = build({
  name: 'Knowledge Store Web',
  description:
    'Knowledge Store frontend: the Vite server on https://0.0.0.0:6173, which also proxies /api and /rtc to the backend.',
  // vite is hoisted to the workspace root by npm workspaces; frontend/ is only
  // its working directory, which is what tells vite where the project is.
  script: path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'),
  workingDirectory: path.join(root, 'frontend'),
});

/*
 * Service dependencies are not among the options node-windows forwards into the
 * winsw config, so install.js applies these with `sc config` afterwards. The
 * names are winsw's: it registers the service under <id>, which node-windows
 * builds as the squashed name plus ".exe".
 */
const services = [
  // The API calls process.exit(1) when Mongo is unreachable, which at boot is a
  // race with mongod rather than a fault.
  { svc: api, dependsOn: ['MongoDB'] },
  // Not required — Vite's proxy recovers on its own — but it keeps the start
  // order, and the stop order, in the sequence a person would expect.
  { svc: web, dependsOn: [api._exe] },
];

// Anything that has to exist before an install is worth attempting.
const preflight = () => {
  const required = [
    [path.join(root, 'backend', '.env'), 'backend configuration'],
    [api.script, 'backend entry point'],
    [web.script, 'vite (run npm install at the workspace root)'],
    [path.join(root, 'node_modules', 'node-windows'), 'node-windows'],
  ];

  return required
    .filter(([target]) => !fs.existsSync(target))
    .map(([target, label]) => `${label} is missing: ${target}`);
};

module.exports = { root, daemonRoot, services, preflight };
