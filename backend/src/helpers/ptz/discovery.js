import { randomUUID } from 'node:crypto';
import dgram from 'node:dgram';
import net from 'node:net';
import { networkInterfaces } from 'node:os';

/*
 * Finding cameras nobody has typed an address for yet.
 *
 * Two ways, because one of them is not enough in a real building:
 *
 *   1. WS-Discovery. Every ONVIF camera listens on the multicast group
 *      239.255.255.250:3702 and answers a Probe with its service address and
 *      its name. It is fast and needs no credentials — but multicast is the
 *      first thing a managed switch drops, and it never crosses a subnet, so a
 *      silent network does not mean an empty one.
 *   2. A subnet sweep, opt-in. Every address on the subnet is tried for an
 *      open HTTP port and then asked one unauthenticated ONVIF question. It is
 *      slower and noisier, and it finds the cameras the first pass misses.
 *
 * Neither one adds anything or logs into anything. Discovery reports what
 * answered; a person decides what becomes a camera.
 */

const DISCOVERY_ADDRESS = '239.255.255.250';
const DISCOVERY_PORT = 3702;

/* The ports a camera's ONVIF service actually turns up on, in order. */
const SWEEP_PORTS = [80, 8000, 8080];
const SWEEP_PATH = '/onvif/device_service';

/** Non-internal IPv4 interfaces, which is where the cameras are. */
const localInterfaces = () => Object.values(networkInterfaces())
  .flat()
  .filter((entry) => entry && entry.family === 'IPv4' && !entry.internal);

/*
 * Sweeping is restricted to the private ranges.
 *
 * The subnet arrives from the browser, and without this an operator — or
 * anything that reaches this endpoint — could aim a few hundred HTTP requests
 * at an arbitrary public network from the server's address. Cameras live on
 * RFC1918 and link-local; that is the whole of what this is for.
 */
const isPrivatePrefix = (prefix) => {
  const parts = String(prefix).split('.').map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return false;
};

/** The /24 the server itself sits on, as a default for the sweep. */
export const localSubnet = () => {
  const found = localInterfaces()
    .map((entry) => entry.address.split('.').slice(0, 3).join('.'))
    .find(isPrivatePrefix);
  return found || '';
};

/*
 * ---------------------------------------------------------------------------
 * WS-Discovery
 * ---------------------------------------------------------------------------
 */

const probeMessage = () => '<?xml version="1.0" encoding="UTF-8"?>'
  + '<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope"'
  + ' xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing"'
  + ' xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"'
  + ' xmlns:dn="http://www.onvif.org/ver10/network/wsdl">'
  + `<e:Header><w:MessageID>urn:uuid:${randomUUID()}</w:MessageID>`
  + '<w:To e:mustUnderstand="true">urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To>'
  + '<w:Action e:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action>'
  + '</e:Header>'
  + '<e:Body><d:Probe><d:Types>dn:NetworkVideoTransmitter</d:Types></d:Probe></e:Body>'
  + '</e:Envelope>';

/** Text of the first element with this local name, ignoring any prefix. */
const tagText = (xml, localName) => {
  const found = new RegExp(`<(?:[a-z0-9_-]+:)?${localName}\\b[^>]*>([\\s\\S]*?)</(?:[a-z0-9_-]+:)?${localName}>`, 'i').exec(xml);
  return found ? found[1].trim() : '';
};

/*
 * ONVIF puts a device's name, model and location in its scopes, as URIs:
 *
 *   onvif://www.onvif.org/name/Front_Entrance onvif://www.onvif.org/location/Lobby
 *
 * They are percent-encoded and underscores stand in for spaces, so a raw scope
 * makes a poor label and a decoded one makes a good default camera name.
 */
const scopeValue = (scopes, kind) => {
  const found = new RegExp(`onvif://www\\.onvif\\.org/${kind}/([^\\s<]+)`, 'i').exec(scopes);
  if (!found) return '';
  try {
    return decodeURIComponent(found[1]).replace(/_/g, ' ').trim();
  } catch {
    return found[1].replace(/_/g, ' ').trim();
  }
};

/**
 * One ProbeMatches datagram, or null when it is not one we can use.
 *
 * XAddrs may list several addresses, one per interface on the camera. The one
 * kept is the one matching the address the reply came from, because the others
 * are addresses this server may have no route to at all.
 */
const readProbeMatch = (xml, fromAddress) => {
  const addresses = tagText(xml, 'XAddrs').split(/\s+/).filter(Boolean);
  if (!addresses.length) return null;

  const preferred = addresses.find((url) => {
    try {
      return new URL(url).hostname === fromAddress;
    } catch {
      return false;
    }
  }) || addresses[0];

  let host = '';
  try {
    host = new URL(preferred).hostname;
  } catch {
    return null;
  }
  if (!host) return null;

  const scopes = tagText(xml, 'Scopes');
  return {
    address: host,
    deviceUrl: preferred,
    name: scopeValue(scopes, 'name'),
    location: scopeValue(scopes, 'location'),
    hardware: scopeValue(scopes, 'hardware'),
    source: 'discovery',
    needsCredentials: false,
  };
};

/**
 * Asks the network for cameras and collects what answers within `timeoutMs`.
 *
 * The probe goes out once per local interface rather than once in total: a
 * multicast datagram leaves by a single interface, and on a server with a
 * second NIC — which is how camera networks are usually wired — the default
 * one is often the wrong one. It is also sent twice per interface, spaced out,
 * because this is UDP and a lost probe is a camera that silently does not
 * exist.
 */
export const probeNetwork = ({ timeoutMs = 4000 } = {}) => new Promise((resolve) => {
  const found = new Map();
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  let settled = false;

  const finish = () => {
    if (settled) return;
    settled = true;
    try { socket.close(); } catch { /* already closed */ }
    resolve([...found.values()]);
  };

  // A socket that cannot even be opened is an empty result, not a crash: the
  // sweep is still available and the page says nothing answered.
  socket.on('error', finish);

  socket.on('message', (buffer, remote) => {
    const xml = buffer.toString('utf8');
    if (!/ProbeMatch/i.test(xml)) return;
    const match = readProbeMatch(xml, remote.address);
    // Keyed by address: a camera that answers both probes, or answers on two
    // interfaces, is one camera.
    if (match && !found.has(match.address)) found.set(match.address, match);
  });

  socket.bind(() => {
    try {
      socket.setMulticastTTL(1);
    } catch { /* the default TTL still reaches the local segment */ }

    const interfaces = localInterfaces();
    const send = () => {
      if (settled) return;
      const message = Buffer.from(probeMessage());
      // No usable interface still gets one probe, by the default route.
      const targets = interfaces.length ? interfaces : [null];
      for (const entry of targets) {
        try {
          if (entry) socket.setMulticastInterface(entry.address);
          socket.send(message, DISCOVERY_PORT, DISCOVERY_ADDRESS, () => {});
        } catch { /* an interface that refuses the send is skipped */ }
      }
    };

    send();
    const retry = setTimeout(send, Math.min(800, timeoutMs / 2));
    setTimeout(() => {
      clearTimeout(retry);
      finish();
    }, timeoutMs);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Subnet sweep
 * ---------------------------------------------------------------------------
 */

/** Whether anything is listening, without saying a word to it. */
const portOpen = (host, port, timeoutMs) => new Promise((resolve) => {
  const socket = new net.Socket();
  const done = (open) => {
    socket.destroy();
    resolve(open);
  };
  socket.setTimeout(timeoutMs);
  socket.once('connect', () => done(true));
  socket.once('timeout', () => done(false));
  socket.once('error', () => done(false));
  socket.connect(port, host);
});

/*
 * GetSystemDateAndTime, which ONVIF requires devices to answer without
 * credentials — it is how a client reads the clock it needs in order to build
 * an authenticated request in the first place. That makes it the one question
 * worth asking a stranger: an ONVIF device answers it, and the printer or the
 * NAS sharing the subnet does not.
 *
 * A 401 still counts as a find. Plenty of firmware demands authentication here
 * anyway, and "something at this address speaks ONVIF and wants a password" is
 * exactly what an operator adding a camera needs to be told.
 */
const askOnvif = async (host, port, timeoutMs) => {
  const deviceUrl = `http://${host}${port === 80 ? '' : `:${port}`}${SWEEP_PATH}`;
  const envelope = '<?xml version="1.0" encoding="UTF-8"?>'
    + '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"'
    + ' xmlns:tds="http://www.onvif.org/ver10/device/wsdl">'
    + '<s:Body><tds:GetSystemDateAndTime/></s:Body></s:Envelope>';

  let response;
  try {
    response = await fetch(deviceUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/soap+xml; charset=utf-8' },
      body: envelope,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return null;
  }

  const base = { address: host, deviceUrl, name: '', location: '', hardware: '', source: 'sweep' };

  if (response.status === 401) return { ...base, needsCredentials: true };

  const text = await response.text().catch(() => '');
  if (!/SystemDateAndTime/i.test(text)) return null;

  return { ...base, needsCredentials: false };
};

/** Runs `worker` over `items`, `limit` at a time, keeping the truthy results. */
const pooled = async (items, limit, worker) => {
  const results = [];
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let index = next; index < items.length; index = next) {
      next += 1;
      // eslint-disable-next-line no-await-in-loop
      const result = await worker(items[index]);
      if (result) results.push(result);
    }
  });
  await Promise.all(runners);
  return results;
};

/**
 * Every address on a /24, checked for an ONVIF service.
 *
 * The cheap test comes first: a TCP connect to a dead address fails in
 * milliseconds, so the SOAP request — the expensive part — is only ever sent
 * to something that answered the door. Without that ordering this is several
 * hundred HTTP requests against mostly empty addresses, and it takes minutes
 * rather than seconds.
 */
export const sweepSubnet = async (prefix, { connectTimeoutMs = 400, onvifTimeoutMs = 2500, concurrency = 64 } = {}) => {
  if (!isPrivatePrefix(prefix)) {
    throw new Error('Only private networks (10.x, 172.16-31.x, 192.168.x, 169.254.x) can be swept.');
  }

  const hosts = Array.from({ length: 254 }, (unused, index) => `${prefix}.${index + 1}`);

  return pooled(hosts, concurrency, async (host) => {
    for (const port of SWEEP_PORTS) {
      // eslint-disable-next-line no-await-in-loop
      const open = await portOpen(host, port, connectTimeoutMs);
      if (!open) continue;
      // eslint-disable-next-line no-await-in-loop
      const found = await askOnvif(host, port, onvifTimeoutMs);
      // The first ONVIF port wins: one camera, not one entry per open port.
      if (found) return found;
    }
    return null;
  });
};

/**
 * Both passes, merged.
 *
 * A camera that answers the multicast probe and is also found by the sweep is
 * reported once, keeping the discovery entry — that is the one carrying the
 * camera's own name and its real service URL, which the sweep can only assume.
 */
export const discoverCameras = async ({ sweep = false, subnet = '', timeoutMs = 4000 } = {}) => {
  const discovered = await probeNetwork({ timeoutMs });
  const byAddress = new Map(discovered.map((camera) => [camera.address, camera]));

  const prefix = sweep ? (String(subnet || '').trim() || localSubnet()) : '';
  if (sweep && !prefix) {
    throw new Error('No private subnet to sweep. Enter one, for example 192.168.1.');
  }

  if (prefix) {
    for (const camera of await sweepSubnet(prefix)) {
      if (!byAddress.has(camera.address)) byAddress.set(camera.address, camera);
    }
  }

  // Ordered by last octet, so the list reads like the network rather than like
  // the order the datagrams happened to arrive in.
  const lastOctet = (address) => Number(address.split('.').pop()) || 0;
  return {
    cameras: [...byAddress.values()].sort((left, right) => lastOctet(left.address) - lastOctet(right.address)),
    sweptSubnet: prefix,
  };
};
