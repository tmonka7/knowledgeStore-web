import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const frontendRoot = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(frontendRoot, '..');

/*
 * The dev server speaks whatever the API speaks.
 *
 * This is not a preference. Cameras, screen sharing and face capture all need
 * a secure context, and "secure" means https or localhost — a plain http page
 * on a LAN address does not qualify, and the browser does not merely refuse
 * the camera there, it leaves navigator.mediaDevices undefined. So the moment
 * anyone but you is meant to open this app, it has to be served over https.
 *
 * The same certificate the API uses is reused here rather than a second one,
 * because the browser then has to trust exactly one origin: the page and its
 * /api and /rtc proxies all come from this dev server.
 */
const resolveCert = (configured, fallback) => {
  const candidate = configured || fallback;
  if (path.isAbsolute(candidate)) return candidate;

  const paths = [
    path.resolve(frontendRoot, candidate),
    path.resolve(workspaceRoot, candidate),
  ];
  return paths.find((option) => fs.existsSync(option)) || paths[1];
};

export default defineConfig(({ mode }) => {
  /*
   * The TLS settings are read from the backend's own .env, not just the shell.
   *
   * Both halves have to make the same decision or the pair is broken in a way
   * that reads as a network fault: a dev server still serving https while the
   * API has been switched back to http proxies to an origin that is no longer
   * there. One source for the answer is what keeps them from drifting.
   */
  const backendEnv = loadEnv(mode, path.resolve(workspaceRoot, 'backend'), '');
  const env = { ...backendEnv, ...process.env };

  const keyPath = resolveCert(env.SSL_KEY_PATH, 'server.key');
  const certPath = resolveCert(env.SSL_CERT_PATH, 'server.crt');

  // Matches how the backend decides: the certificate files being there is the
  // signal, and USE_HTTPS=false says "not today" without moving them.
  const useHttps = env.USE_HTTPS !== 'false'
    && fs.existsSync(keyPath)
    && fs.existsSync(certPath);

  const https = useHttps
    ? { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }
    : undefined;

  const apiHost = env.API_HOST || '127.0.0.1';
  const apiPort = Number(env.API_PORT || env.HTTPS_PORT || env.PORT || 4000);
  const apiOrigin = `${useHttps ? 'https' : 'http'}://${apiHost}:${apiPort}`;
  const socketOrigin = `${useHttps ? 'wss' : 'ws'}://${apiHost}:${apiPort}`;

  return {
    plugins: [react()],
    resolve: {
      dedupe: ['react', 'react-dom'],
    },
    server: {
      host: '0.0.0.0',
      port: 6173,
      strictPort: false,
      https,
      proxy: {
        '/api': {
          target: apiOrigin,
          changeOrigin: true,
          // This proxy is Node talking to your own backend, and a self-signed
          // certificate is one Node refuses. Turning the check off here is not
          // the browser trusting anything — the browser's connection is to
          // this dev server, and it still checks that one.
          secure: false,
        },
        // The meeting signalling socket. `ws: true` is what makes Vite forward
        // the upgrade rather than answering it as an ordinary request, which
        // is why the path needs its own entry instead of riding along with
        // /api.
        //
        // Proxying it matters more over https than it did over http: a browser
        // shows no certificate warning for a WebSocket, it just fails. Keeping
        // the socket on the page's own origin means the one exception made for
        // the page covers the meeting too.
        '/rtc': {
          target: socketOrigin,
          ws: true,
          secure: false,
        },
      },
    },
    preview: {
      host: '0.0.0.0',
      port: 4173,
      https,
    },
  };
});
