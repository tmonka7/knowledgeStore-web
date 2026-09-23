import { createHash, randomBytes } from 'node:crypto';

/*
 * HTTP Digest authentication, because cameras want it and fetch does not do it.
 *
 * Basic auth is one header you can compute up front. Digest is a conversation:
 * the first request goes out unauthenticated, the camera answers 401 with a
 * realm and a one-time nonce, and only then can the header be built. Node's
 * fetch has no notion of this, and there is no dependency installed to do it,
 * so it is here — it is about sixty lines and it is the difference between
 * "PTZ works" and "PTZ returns 401 forever" on Hikvision, Dahua and most of
 * the ONVIF devices that matter.
 *
 * Basic is supported too, and the camera chooses: whatever it asks for in
 * WWW-Authenticate is what it gets. We never volunteer credentials to a server
 * that did not ask, which also means a camera with no password set never has
 * one sent to it.
 */

const md5 = (value) => createHash('md5').update(value).digest('hex');

/** Splits `Digest realm="x", nonce="y"` into { realm, nonce, ... }. */
const parseChallenge = (header) => {
  const params = {};
  // Values may be quoted or bare (qop=auth, algorithm=MD5 usually are).
  const pattern = /([a-z0-9_-]+)\s*=\s*(?:"([^"]*)"|([^,\s]+))/gi;
  let found = pattern.exec(header);
  while (found) {
    params[found[1].toLowerCase()] = found[2] !== undefined ? found[2] : found[3];
    found = pattern.exec(header);
  }
  return params;
};

const digestHeader = ({ username, password, method, uri, challenge, nc = '00000001' }) => {
  const { realm = '', nonce = '', qop, opaque, algorithm = 'MD5' } = challenge;
  const cnonce = randomBytes(8).toString('hex');

  // MD5-sess folds the nonces into HA1; plain MD5 does not. Cameras that ask
  // for -sess are rare but they exist, and getting this wrong fails closed.
  const baseHa1 = md5(`${username}:${realm}:${password}`);
  const ha1 = /sess$/i.test(algorithm) ? md5(`${baseHa1}:${nonce}:${cnonce}`) : baseHa1;
  const ha2 = md5(`${method}:${uri}`);

  // qop may arrive as a list ("auth,auth-int"); we only implement auth.
  const useQop = String(qop || '').split(',').map((value) => value.trim()).includes('auth');
  const response = useQop
    ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:auth:${ha2}`)
    : md5(`${ha1}:${nonce}:${ha2}`);

  const parts = [
    `username="${username}"`,
    `realm="${realm}"`,
    `nonce="${nonce}"`,
    `uri="${uri}"`,
    `response="${response}"`,
    `algorithm=${algorithm}`,
  ];
  if (useQop) parts.push('qop=auth', `nc=${nc}`, `cnonce="${cnonce}"`);
  if (opaque) parts.push(`opaque="${opaque}"`);
  return `Digest ${parts.join(', ')}`;
};

/** The path+query a Digest `uri=` must cover — not the whole URL. */
const requestUri = (url) => {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
};

/**
 * fetch(), with one automatic retry carrying whatever credentials the server
 * asked for.
 *
 * Returns the final Response. A 401 that comes back a second time is returned
 * as-is rather than thrown, so the caller can report "the camera rejected
 * these credentials" separately from "the camera is unreachable".
 */
export const fetchWithAuth = async (url, { username, password, timeoutMs = 8000, ...options } = {}) => {
  const run = (headers) => {
    // AbortSignal.timeout keeps a camera that accepts the connection and then
    // says nothing from holding a request open until the client gives up.
    const signal = AbortSignal.timeout(timeoutMs);
    return fetch(url, { ...options, signal, headers: { ...options.headers, ...headers } });
  };

  const first = await run({});
  if (first.status !== 401 || !username) return first;

  const header = first.headers.get('www-authenticate') || '';
  // The body of the 401 is never read, so the socket must not be left holding
  // it; without this a camera that 401s on every poll leaks a connection each
  // time until the pool is exhausted and PTZ stops responding altogether.
  await first.arrayBuffer().catch(() => {});

  if (/^\s*basic/i.test(header)) {
    const basic = Buffer.from(`${username}:${password || ''}`).toString('base64');
    return run({ Authorization: `Basic ${basic}` });
  }

  if (!/^\s*digest/i.test(header)) return first;

  return run({
    Authorization: digestHeader({
      username,
      password: password || '',
      method: options.method || 'GET',
      uri: requestUri(url),
      challenge: parseChallenge(header),
    }),
  });
};
