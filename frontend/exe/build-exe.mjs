/*
 * Builds release/knowledgeStore-web.exe: the built frontend (dist/) and
 * exe/server.cjs joined into one program with Node's "single executable
 * application" feature. The result runs on a PC without Node.
 *
 *   npm run build:exe        (in frontend/: vite build, then this)
 *
 * Steps: gzip every file of dist/ into one script next to server.cjs; turn
 * that into a SEA blob with `node --experimental-sea-config`; copy that node
 * program; inject the blob with postject.
 *
 * The .exe is for the platform this is run on (build on Windows for Windows)
 * and carries a Node runtime inside it. Node 18 cannot make one, so when this
 * runs on Node older than 20 it downloads the current LTS Node once (checked
 * against nodejs.org's SHA-256 list) into release/.node and builds with that.
 * KS_EXE_NODE_VERSION=v24.21.0 picks the version instead.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const here = path.dirname(fileURLToPath(import.meta.url));
const frontend = path.resolve(here, '..');
const dist = path.join(frontend, 'dist');
const release = path.join(frontend, 'release');
const work = path.join(release, '.build');
const exeName = process.platform === 'win32' ? 'knowledgeStore-web.exe' : 'knowledgeStore-web';
const exe = path.join(release, exeName);

const fail = (message) => {
  console.error(`\nbuild-exe: ${message}\n`);
  process.exit(1);
};

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

if (!fs.existsSync(path.join(dist, 'index.html'))) {
  fail('frontend/dist/index.html is missing: run "npm run build" first (or use "npm run build:exe").');
}

/**
 * The node program to build with, and to put inside the .exe: this one when it
 * can make single executables (20+), otherwise a downloaded LTS release.
 */
const seaNode = async () => {
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 20 && !process.env.KS_EXE_NODE_VERSION) return process.execPath;

  const platform = { win32: 'win', linux: 'linux', darwin: 'darwin' }[process.platform];
  if (!platform) fail(`No Node download for ${process.platform}; build with Node 20 or later instead.`);
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const archive = platform === 'win' ? 'zip' : platform === 'linux' ? 'tar.xz' : 'tar.gz';

  let version = process.env.KS_EXE_NODE_VERSION;
  if (!version) {
    try {
      const releases = await (await fetch('https://nodejs.org/dist/index.json')).json();
      version = releases.find((item) => item.lts).version;
    } catch (error) {
      fail(`Node ${process.versions.node} cannot build single executables, and a newer one could not be looked up (${error.message}). Install Node 20 or later, or set KS_EXE_NODE_VERSION.`);
    }
  }

  const name = `node-${version}-${platform}-${arch}`;
  const folder = path.join(release, '.node');
  const binary = path.join(folder, name, platform === 'win' ? 'node.exe' : path.join('bin', 'node'));
  if (fs.existsSync(binary)) return binary;

  console.log(`Node ${process.versions.node} cannot build single executables: downloading Node ${version} …`);
  const file = `${name}.${archive}`;
  const base = `https://nodejs.org/dist/${version}`;
  try {
    const sums = await (await fetch(`${base}/SHASUMS256.txt`)).text();
    const expected = sums.split('\n').find((line) => line.trim().endsWith(`  ${file}`))?.split(' ')[0];
    if (!expected) throw new Error(`${file} is not listed in SHASUMS256.txt`);
    const response = await fetch(`${base}/${file}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = Buffer.from(await response.arrayBuffer());
    const actual = createHash('sha256').update(data).digest('hex');
    if (actual !== expected) throw new Error(`checksum mismatch (${actual} is not ${expected})`);
    fs.mkdirSync(folder, { recursive: true });
    const saved = path.join(folder, file);
    fs.writeFileSync(saved, data);
    // tar reads .zip too on Windows 10 and later.
    execFileSync('tar', ['-xf', file, '-C', '.'], { cwd: folder, stdio: 'inherit' });
    fs.rmSync(saved);
  } catch (error) {
    fail(`Could not download Node ${version}: ${error.message}. Install Node 20 or later and build with it instead.`);
  }
  if (!fs.existsSync(binary)) fail(`${binary} is missing after unpacking.`);
  return binary;
};

// Content types, as server.cjs knows them: read from there so the two cannot
// disagree.
const serverSource = fs.readFileSync(path.join(here, 'server.cjs'), 'utf8');
const TYPES = Object.fromEntries(
  [...serverSource.matchAll(/^\s+'(\.[a-z0-9]+)': '([^']+)',$/gm)].map(([, ext, type]) => [ext, type]),
);

console.log('Packing dist/ …');
const files = {};
let rawBytes = 0;
let packedBytes = 0;
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    const name = `/${path.relative(dist, full).split(path.sep).join('/')}`;
    const raw = fs.readFileSync(full);
    const gz = zlib.gzipSync(raw, { level: 9 });
    rawBytes += raw.length;
    packedBytes += gz.length;
    files[name] = { type: TYPES[path.extname(name).toLowerCase()] || 'application/octet-stream', gz: gz.toString('base64') };
  }
};
walk(dist);
console.log(`  ${Object.keys(files).length} files, ${mb(rawBytes)} → ${mb(packedBytes)} gzipped`);

fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });

const builtAt = new Date().toISOString().replace('T', ' ').slice(0, 16);
const bundle = path.join(work, 'bundle.cjs');
fs.writeFileSync(
  bundle,
  `globalThis.__KS_EMBEDDED__ = ${JSON.stringify({ builtAt, files })};\n${serverSource}`,
);

const blob = path.join(work, 'sea-prep.blob');
const seaConfig = path.join(work, 'sea-config.json');
fs.writeFileSync(seaConfig, JSON.stringify({ main: bundle, output: blob, disableExperimentalSEAWarning: true }, null, 2));

const node = await seaNode();
const nodeVersion = execFileSync(node, ['--version']).toString().trim();

console.log(`Making the SEA blob (Node ${nodeVersion}) …`);
execFileSync(node, ['--experimental-sea-config', seaConfig], { stdio: 'inherit' });

console.log(`Copying ${node} …`);
try {
  fs.rmSync(exe, { force: true });
} catch (error) {
  fail(`${exe} is in use (is it running?): ${error.message}`);
}
fs.copyFileSync(node, exe);

// node.exe is signed by the Node.js project; injecting invalidates that
// signature. Removing it first (when signtool is installed) keeps Windows from
// reporting a damaged signature — the program runs either way.
if (process.platform === 'win32') {
  try {
    execFileSync('signtool', ['remove', '/s', exe], { stdio: 'ignore' });
    console.log('  removed the Node.js signature');
  } catch {
    // No Windows SDK: fine.
  }
}

console.log('Injecting (postject) …');
const postjectArgs = [
  '--yes', 'postject', exe, 'NODE_SEA_BLOB', blob,
  '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ...(process.platform === 'darwin' ? ['--macho-segment-name', 'NODE_SEA'] : []),
];
// npm's npx script, run by this node: no shell, so paths with spaces are safe.
const npxCli = [
  path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js'),
  path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js'),
].find((file) => fs.existsSync(file));
// npx starts postject with whatever "node" is on the PATH: make it this one.
const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === 'PATH') || 'PATH';
const env = { ...process.env, [pathKey]: `${path.dirname(process.execPath)}${path.delimiter}${process.env[pathKey] || ''}` };
try {
  if (npxCli) {
    execFileSync(process.execPath, [npxCli, ...postjectArgs], { stdio: 'inherit', env });
  } else {
    const quoted = postjectArgs.map((arg) => (/[\s"]/.test(arg) ? `"${arg}"` : arg));
    execFileSync('npx', quoted, { stdio: 'inherit', shell: true, env });
  }
} catch {
  fail('postject failed. It is fetched by npx the first time, so that needs the internet (or "npm i -D postject" once).');
}

fs.rmSync(work, { recursive: true, force: true });

// A settings file to go with it, when there is none yet.
const settingsFile = path.join(release, 'knowledgeStore-web.json');
if (!fs.existsSync(settingsFile)) {
  const defaults = serverSource.match(/const DEFAULTS = (\{[\s\S]*?\n\});/)[1]
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/(\w+):/g, '"$1":')
    .replace(/'/g, '"')
    .replace(/,(\s*\})/g, '$1');
  fs.writeFileSync(settingsFile, `${JSON.stringify(JSON.parse(defaults), null, 2)}\n`);
}

console.log(`\nDone: ${exe} (${mb(fs.statSync(exe).size)}, Node ${nodeVersion} inside)`);
console.log('Copy it (with server.crt and server.key for https, and knowledgeStore-web.json to change settings) to any folder and run it.\n');
