/*
 * The frontend as a program: serves the built pages (frontend/dist) and passes
 * /api, /uploads and the /rtc meeting socket through to the backend — what the
 * Vite dev server does, without Node, node_modules or Vite on the machine.
 *
 * It runs two ways:
 *   - inside knowledgeStore-web.exe (see build-exe.mjs), with the pages built
 *     into the program;
 *   - as a plain script, `node exe/server.cjs`, serving frontend/dist.
 *
 * Only Node's own modules are used: a single-executable program cannot load
 * anything from node_modules.
 *
 * Settings, strongest first: command-line flags, environment variables, then
 * knowledgeStore-web.json next to the program (written with the defaults the
 * first time it runs). See DEFAULTS below.
 */

'use strict';

const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const zlib = require('node:zlib');
const { execFile } = require('node:child_process');

const EMBEDDED = globalThis.__KS_EMBEDDED__ || null; // { files: { '/path': { type, gz: base64 } }, builtAt }
const APP_NAME = 'knowledgeStore-web';

// Where the program lives: next to the .exe, or the frontend folder for the script.
const baseDir = EMBEDDED ? path.dirname(process.execPath) : path.resolve(__dirname, '..');
const configPath = path.join(baseDir, `${APP_NAME}.json`);

const DEFAULTS = {
  // Where browsers connect. 0.0.0.0 means every network interface of this PC.
  host: '0.0.0.0',
  port: 6173,
  // The next free port is taken when this one is in use (as Vite does).
  strictPort: false,
  // The backend. "auto" = https://127.0.0.1:4000 when https is on, else http.
  apiUrl: 'auto',
  // https is used when both files exist, unless "https" is false. Relative
  // paths are next to the program.
  https: true,
  certFile: 'server.crt',
  keyFile: 'server.key',
  // A frontend/dist folder to serve instead of the pages built into the
  // program: update the pages without rebuilding the .exe. Empty = built in.
  distDir: '',
  openBrowser: true,
};

const FLAGS = {
  '--host': 'host',
  '--port': 'port',
  '--api': 'apiUrl',
  '--cert': 'certFile',
  '--key': 'keyFile',
  '--dist': 'distDir',
};

const ENV = {
  KS_HOST: 'host',
  KS_PORT: 'port',
  KS_API_URL: 'apiUrl',
  KS_CERT_FILE: 'certFile',
  KS_KEY_FILE: 'keyFile',
  KS_DIST_DIR: 'distDir',
};

const HELP = `${APP_NAME} — serves the knowledgeStore web pages and forwards /api to the backend.

Options (also settable in ${APP_NAME}.json next to the program):
  --port <n>       port to listen on (default ${DEFAULTS.port})
  --host <ip>      address to listen on (default ${DEFAULTS.host})
  --api <url>      backend address, e.g. https://127.0.0.1:4000 (default: auto)
  --cert <file>    TLS certificate (default server.crt next to the program)
  --key <file>     TLS private key (default server.key next to the program)
  --http           serve plain http even if a certificate is present
  --dist <folder>  serve this built frontend instead of the built-in one
  --no-browser     do not open the browser on start
  --help           this text
`;

const readConfig = () => {
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`Ignoring ${configPath}: ${error.message}`);
      return {};
    }
    // First run: leave a file to edit, with every setting and its default.
    try {
      fs.writeFileSync(configPath, `${JSON.stringify(DEFAULTS, null, 2)}\n`);
      console.log(`Wrote the default settings to ${configPath}`);
    } catch {
      // A read-only folder: the defaults still apply.
    }
    return {};
  }
};

const loadSettings = () => {
  const settings = { ...DEFAULTS, ...readConfig() };
  for (const [name, key] of Object.entries(ENV)) {
    if (process.env[name]) settings[key] = process.env[name];
  }
  // Inside the .exe argv[1] is the program again, as argv[1] is the script for node.
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      console.log(HELP);
      process.exit(0);
    } else if (arg === '--http') settings.https = false;
    else if (arg === '--no-browser') settings.openBrowser = false;
    else if (FLAGS[arg] && i + 1 < args.length) {
      settings[FLAGS[arg]] = args[i + 1];
      i += 1;
    } else {
      console.warn(`Unknown option ${arg} (see --help)`);
    }
  }
  settings.port = Number(settings.port);
  if (!Number.isInteger(settings.port) || settings.port < 1 || settings.port > 65535) {
    throw new Error(`"port" must be a number from 1 to 65535, not ${settings.port}.`);
  }
  return settings;
};

const resolveFile = (file) => (file ? path.resolve(baseDir, file) : '');

/* --------------------------------------------------------------- the pages */

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.onnx': 'application/octet-stream',
  '.pdf': 'application/pdf',
};

const typeOf = (file) => TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';

/**
 * The pages, as { '/assets/x.js': { type, gz } } with each file gzipped once.
 * Built-in ones come compressed already; a folder is read and compressed at
 * start-up.
 */
const loadPages = (distDir) => {
  const pages = new Map();
  if (!distDir) {
    if (!EMBEDDED) throw new Error('No built frontend: run "npm run build" in frontend/, or pass --dist <folder>.');
    for (const [name, file] of Object.entries(EMBEDDED.files)) {
      pages.set(name, { type: file.type, gz: Buffer.from(file.gz, 'base64') });
    }
    return pages;
  }
  if (!fs.existsSync(path.join(distDir, 'index.html'))) {
    throw new Error(`${distDir} has no index.html: build the frontend first ("npm run build" in frontend/).`);
  }
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        const name = `/${path.relative(distDir, full).split(path.sep).join('/')}`;
        pages.set(name, { type: typeOf(name), gz: zlib.gzipSync(fs.readFileSync(full), { level: 9 }) });
      }
    }
  };
  walk(distDir);
  return pages;
};

const servePage = (pages, req, res) => {
  let name;
  try {
    name = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  if (name.endsWith('/')) name += 'index.html';
  let page = pages.get(name);
  // A route of the single-page app (/dashboard, …) gets index.html; a missing
  // file (/logo.png) gets a real 404 instead of a page of HTML.
  if (!page && !path.extname(name)) {
    name = '/index.html';
    page = pages.get(name);
  }
  if (!page) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    return;
  }

  const headers = {
    'Content-Type': page.type,
    Vary: 'Accept-Encoding',
    'X-Content-Type-Options': 'nosniff',
    // Vite names built assets by their content, so they never change; the
    // HTML (and the untouched public/ files) must be checked every time.
    'Cache-Control': name.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  };
  const gzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  const body = gzip ? page.gz : (page.raw ||= zlib.gunzipSync(page.gz));
  if (gzip) headers['Content-Encoding'] = 'gzip';
  headers['Content-Length'] = body.length;
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
};

/* ---------------------------------------------------------------- the proxy */

const PROXIED = /^\/(api|uploads|rtc)(\/|$|\?)/;

const proxyOptions = (target, req, secureFront) => ({
  protocol: target.protocol,
  hostname: target.hostname,
  port: target.port || (target.protocol === 'https:' ? 443 : 80),
  method: req.method,
  path: req.url,
  headers: {
    ...req.headers,
    // What Vite's changeOrigin does: the backend sees itself as the host.
    host: target.host,
    'x-forwarded-for': [req.headers['x-forwarded-for'], req.socket.remoteAddress].filter(Boolean).join(', '),
    'x-forwarded-proto': secureFront ? 'https' : 'http',
    'x-forwarded-host': req.headers.host || '',
  },
  // The backend's certificate is usually self-signed. This is this program
  // talking to your own backend; the browser still checks this server's.
  rejectUnauthorized: false,
});

const clientFor = (target) => (target.protocol === 'https:' ? https : http);

const proxyRequest = (target, secureFront, req, res) => {
  const upstream = clientFor(target).request(proxyOptions(target, req, secureFront), (answer) => {
    res.writeHead(answer.statusCode, answer.statusMessage, answer.headers);
    answer.pipe(res);
  });
  upstream.on('error', (error) => {
    console.error(`${req.method} ${req.url} → backend failed: ${error.message}`);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ message: `The backend at ${target.origin} is not reachable (${error.code || error.message}). Is it running?` }));
    } else {
      res.destroy();
    }
  });
  req.on('aborted', () => upstream.destroy());
  req.pipe(upstream);
};

/** The meeting socket: pass the upgrade through, then splice the two sockets. */
const proxyUpgrade = (target, secureFront, req, socket, head) => {
  if (!PROXIED.test(req.url)) {
    socket.destroy();
    return;
  }
  const upstream = clientFor(target).request(proxyOptions(target, req, secureFront));
  upstream.on('upgrade', (answer, upstreamSocket, upstreamHead) => {
    const lines = [`HTTP/1.1 ${answer.statusCode} ${answer.statusMessage}`];
    for (let i = 0; i < answer.rawHeaders.length; i += 2) lines.push(`${answer.rawHeaders[i]}: ${answer.rawHeaders[i + 1]}`);
    socket.write(`${lines.join('\r\n')}\r\n\r\n`);
    if (upstreamHead?.length) socket.write(upstreamHead);
    if (head?.length) upstreamSocket.write(head);
    upstreamSocket.pipe(socket).pipe(upstreamSocket);
    // One side gone (a closed tab, a restarted backend) ends the other too;
    // otherwise every meeting left behind would hold a backend socket open.
    const closeBoth = () => {
      socket.destroy();
      upstreamSocket.destroy();
    };
    for (const side of [socket, upstreamSocket]) {
      side.on('error', closeBoth);
      side.on('close', closeBoth);
    }
  });
  upstream.on('response', (answer) => {
    // The backend declined the upgrade: hand its answer back as it is.
    socket.end(`HTTP/1.1 ${answer.statusCode} ${answer.statusMessage}\r\n\r\n`);
  });
  upstream.on('error', (error) => {
    console.error(`WebSocket ${req.url} → backend failed: ${error.message}`);
    socket.destroy();
  });
  upstream.end();
};

/* ----------------------------------------------------------------- start-up */

const openBrowser = (url) => {
  const [command, args] = process.platform === 'win32'
    ? ['cmd', ['/c', 'start', '""', url]]
    : [process.platform === 'darwin' ? 'open' : 'xdg-open', [url]];
  execFile(command, args, { windowsHide: true }, () => {});
};

const lanAddresses = () => Object.values(require('node:os').networkInterfaces())
  .flat()
  .filter((item) => item && item.family === 'IPv4' && !item.internal)
  .map((item) => item.address);

const listen = (server, host, port, strict) => new Promise((resolve, reject) => {
  const attempt = (candidate) => {
    const onError = (error) => {
      server.off('listening', onListening);
      if (error.code === 'EADDRINUSE' && !strict && candidate < port + 20) {
        console.warn(`Port ${candidate} is in use, trying ${candidate + 1}…`);
        attempt(candidate + 1);
      } else {
        reject(error);
      }
    };
    const onListening = () => {
      server.off('error', onError);
      resolve(candidate);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(candidate, host);
  };
  attempt(port);
});

const main = async () => {
  const settings = loadSettings();

  const certFile = resolveFile(settings.certFile);
  const keyFile = resolveFile(settings.keyFile);
  const useHttps = settings.https !== false && String(settings.https) !== 'false'
    && fs.existsSync(certFile) && fs.existsSync(keyFile);

  const apiUrl = settings.apiUrl && settings.apiUrl !== 'auto'
    ? settings.apiUrl
    : `${useHttps ? 'https' : 'http'}://127.0.0.1:4000`;
  let target;
  try {
    target = new URL(apiUrl);
  } catch {
    throw new Error(`"apiUrl" is not a valid address: ${apiUrl}`);
  }

  const distDir = settings.distDir ? path.resolve(baseDir, settings.distDir) : (EMBEDDED ? '' : path.join(baseDir, 'dist'));
  const pages = loadPages(distDir);

  const handler = (req, res) => {
    if (PROXIED.test(req.url)) proxyRequest(target, useHttps, req, res);
    else if (req.method === 'GET' || req.method === 'HEAD') servePage(pages, req, res);
    else res.writeHead(405, { Allow: 'GET, HEAD' }).end();
  };

  const server = useHttps
    ? https.createServer({ cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) }, handler)
    : http.createServer(handler);
  server.on('upgrade', (req, socket, head) => proxyUpgrade(target, useHttps, req, socket, head));
  server.on('clientError', (error, socket) => socket.destroy());

  const port = await listen(server, settings.host, settings.port, settings.strictPort === true);
  const scheme = useHttps ? 'https' : 'http';
  const local = `${scheme}://localhost:${port}/`;

  console.log('');
  console.log(`  ${APP_NAME}${EMBEDDED?.builtAt ? ` (built ${EMBEDDED.builtAt})` : ''}`);
  console.log(`  Pages:    ${distDir || 'built into this program'} (${pages.size} files)`);
  console.log(`  Backend:  ${target.origin}`);
  console.log(`  Open:     ${local}`);
  if (settings.host === '0.0.0.0') {
    for (const address of lanAddresses()) console.log(`            ${scheme}://${address}:${port}/`);
  }
  if (!useHttps) {
    console.log('');
    console.log('  Plain http: cameras, screen sharing and face capture only work at');
    console.log(`  localhost. Put server.crt and server.key next to the program for https.`);
  }
  console.log('');
  console.log('  Close this window (or press Ctrl+C) to stop.');
  console.log('');

  if (settings.openBrowser !== false && String(settings.openBrowser) !== 'false') openBrowser(local);
};

main().catch((error) => {
  console.error('');
  console.error(`  ${APP_NAME} could not start: ${error.message}`);
  console.error('');
  // Double-clicked, the window would close before the message could be read.
  if (EMBEDDED && process.stdin.isTTY) {
    console.error('  Press Enter to close.');
    process.stdin.resume();
    process.stdin.once('data', () => process.exit(1));
  } else {
    process.exit(1);
  }
});
