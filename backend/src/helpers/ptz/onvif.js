import { createHash, randomBytes } from 'node:crypto';
import { fetchWithAuth } from './httpAuth.js';

/*
 * ONVIF PTZ, spoken directly.
 *
 * ONVIF is SOAP, and there is no SOAP client installed — nor should one be
 * pulled in for six calls. What is needed here is narrow and stable: find the
 * PTZ and Media services, list profiles, read the snapshot URL, move to an
 * absolute position, and ask where the head is pointing. Those envelopes have
 * not changed since ONVIF 2.0 and they are written out below verbatim.
 *
 * Two honest caveats about this file:
 *
 *   1. Responses are read with regular expressions, not an XML parser. That is
 *      normally a bad idea, and it is tolerable here only because every field
 *      read is a single well-known element or attribute in a machine-generated
 *      document. Anything richer belongs in a real parser.
 *   2. Authentication is WS-Security UsernameToken (PasswordDigest), which is
 *      what the specification requires. Some cameras additionally want HTTP
 *      Digest on the same request, so every call goes through fetchWithAuth
 *      and gets both.
 */

const NS = [
  'xmlns:s="http://www.w3.org/2003/05/soap-envelope"',
  'xmlns:tds="http://www.onvif.org/ver10/device/wsdl"',
  'xmlns:trt="http://www.onvif.org/ver10/media/wsdl"',
  'xmlns:tptz="http://www.onvif.org/ver20/ptz/wsdl"',
  'xmlns:tt="http://www.onvif.org/ver10/schema"',
].join(' ');

const WSSE = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd';
const WSU = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd';
const PASSWORD_DIGEST = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest';
const BASE64_BINARY = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary';

export const escapeXml = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/*
 * WS-Security UsernameToken.
 *
 * The digest is SHA1 over the raw nonce BYTES followed by the created
 * timestamp and the password as UTF-8 — not over the base64 text of the nonce.
 * Hashing the base64 instead is the classic way to get a permanent
 * "NotAuthorized" from a camera whose credentials are perfectly correct.
 */
const securityHeader = (username, password) => {
  if (!username) return '';
  const nonce = randomBytes(16);
  const created = new Date().toISOString();
  const digest = createHash('sha1')
    .update(Buffer.concat([nonce, Buffer.from(created, 'utf8'), Buffer.from(password || '', 'utf8')]))
    .digest('base64');

  return `<s:Header><Security s:mustUnderstand="1" xmlns="${WSSE}">`
    + '<UsernameToken>'
    + `<Username>${escapeXml(username)}</Username>`
    + `<Password Type="${PASSWORD_DIGEST}">${digest}</Password>`
    + `<Nonce EncodingType="${BASE64_BINARY}">${nonce.toString('base64')}</Nonce>`
    + `<Created xmlns="${WSU}">${created}</Created>`
    + '</UsernameToken></Security></s:Header>';
};

/** Text of the first element with this local name, ignoring any prefix. */
const tagText = (xml, localName) => {
  const found = new RegExp(`<(?:[a-z0-9_-]+:)?${localName}\\b[^>]*>([\\s\\S]*?)</(?:[a-z0-9_-]+:)?${localName}>`, 'i').exec(xml);
  return found ? found[1].trim() : '';
};

/** Value of one attribute on the first element with this local name. */
const tagAttr = (xml, localName, attribute) => {
  const element = new RegExp(`<(?:[a-z0-9_-]+:)?${localName}\\b([^>]*)`, 'i').exec(xml);
  if (!element) return '';
  const found = new RegExp(`${attribute}\\s*=\\s*"([^"]*)"`, 'i').exec(element[1]);
  return found ? found[1] : '';
};

/** The inner XML of the first element with this local name. */
const section = (xml, localName) => {
  const found = new RegExp(`<(?:[a-z0-9_-]+:)?${localName}\\b[^>]*>([\\s\\S]*?)</(?:[a-z0-9_-]+:)?${localName}>`, 'i').exec(xml);
  return found ? found[1] : '';
};

/** A SOAP Fault reason, in words, or '' when the response is not a fault. */
const faultReason = (xml) => {
  if (!/<(?:[a-z0-9_-]+:)?Fault\b/i.test(xml)) return '';
  return tagText(xml, 'Text') || tagText(xml, 'faultstring') || tagText(xml, 'Value') || 'the camera rejected the request';
};

export class PtzError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PtzError';
    this.code = code;
  }
}

/**
 * One SOAP call. `service` is a full URL, `body` the contents of s:Body.
 *
 * Every failure mode is turned into a PtzError with a code the controller can
 * map to a status, because "the camera is switched off", "the password is
 * wrong" and "this camera has no PTZ" are three different answers and an
 * operator who sees one string for all three cannot fix any of them.
 */
export const soapCall = async (service, body, { username, password, timeoutMs } = {}) => {
  const envelope = '<?xml version="1.0" encoding="UTF-8"?>'
    + `<s:Envelope ${NS}>${securityHeader(username, password)}<s:Body>${body}</s:Body></s:Envelope>`;

  let response;
  try {
    response = await fetchWithAuth(service, {
      method: 'POST',
      username,
      password,
      timeoutMs,
      headers: { 'Content-Type': 'application/soap+xml; charset=utf-8' },
      body: envelope,
    });
  } catch (error) {
    const unreachable = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    throw new PtzError(
      unreachable ? 'CAMERA_TIMEOUT' : 'CAMERA_UNREACHABLE',
      unreachable
        ? 'The camera did not answer in time. Check that it is powered on and on this network.'
        : `The camera could not be reached (${error?.cause?.code || error?.message || 'connection failed'}).`,
    );
  }

  const text = await response.text();

  if (response.status === 401) {
    throw new PtzError('CAMERA_UNAUTHORISED', 'The camera rejected the PTZ username or password.');
  }

  const reason = faultReason(text);
  if (reason) {
    // ONVIF reports "no such operation" as a fault rather than a 404, so the
    // most common real cause — a fixed camera with no PTZ head — arrives here.
    const code = /ActionNotSupported|NoPTZProfile|NotSupported|OptionalActionNotSupported/i.test(text)
      ? 'PTZ_UNSUPPORTED'
      : 'CAMERA_REFUSED';
    throw new PtzError(code, `The camera refused the request: ${reason}`);
  }

  if (!response.ok) {
    throw new PtzError('CAMERA_REFUSED', `The camera answered ${response.status} ${response.statusText}.`);
  }

  return text;
};

/*
 * The ONVIF service endpoints, derived from the device address.
 *
 * A device says where its services live via GetCapabilities, and some put them
 * on a different port or path. We ask — but we keep only the path, and reach
 * it at the host we are already talking to. Plenty of cameras report a
 * capability URL containing the IP they believe they have, which is wrong the
 * moment the camera is reached through a NAT, a port forward or a second
 * subnet; trusting it sends every subsequent call to an address that does not
 * answer, and the failure looks like the camera being offline.
 */
const serviceUrls = async (deviceUrl, credentials) => {
  const base = new URL(deviceUrl);
  const onHost = (reported, fallbackPath) => {
    if (!reported) return new URL(fallbackPath, base).toString();
    try {
      const url = new URL(reported);
      return new URL(`${url.pathname}${url.search}`, base).toString();
    } catch {
      return new URL(fallbackPath, base).toString();
    }
  };

  let xml = '';
  try {
    xml = await soapCall(
      deviceUrl,
      '<tds:GetCapabilities><tds:Category>All</tds:Category></tds:GetCapabilities>',
      credentials,
    );
  } catch (error) {
    // An unauthorised or unreachable device is fatal; anything else just means
    // we fall back to the standard paths, which most cameras serve anyway.
    const fatal = ['CAMERA_UNAUTHORISED', 'CAMERA_UNREACHABLE', 'CAMERA_TIMEOUT'];
    if (fatal.includes(error.code)) throw error;
  }

  // Each XAddr is taken from its own section rather than as the first XAddr in
  // the document, which belongs to whichever capability block came first.
  return {
    media: onHost(tagText(section(xml, 'Media'), 'XAddr'), '/onvif/media_service'),
    ptz: onHost(tagText(section(xml, 'PTZ'), 'XAddr'), '/onvif/ptz_service'),
  };
};

/** Every media profile, with whether each one can actually be moved. */
export const getProfiles = async (deviceUrl, credentials) => {
  const { media } = await serviceUrls(deviceUrl, credentials);
  const xml = await soapCall(media, '<trt:GetProfiles/>', credentials);

  const profiles = [];
  const pattern = /<(?:[a-z0-9_-]+:)?Profiles\b([^>]*)>([\s\S]*?)<\/(?:[a-z0-9_-]+:)?Profiles>/gi;
  let found = pattern.exec(xml);
  while (found) {
    const token = /token\s*=\s*"([^"]*)"/i.exec(found[1])?.[1] || '';
    if (token) {
      profiles.push({
        token,
        name: tagText(found[2], 'Name') || token,
        // Without a PTZConfiguration the profile cannot be moved, whatever the
        // camera's overall capabilities claim.
        hasPtz: /<(?:[a-z0-9_-]+:)?PTZConfiguration\b/i.test(found[2]),
      });
    }
    found = pattern.exec(xml);
  }
  return profiles;
};

/** The JPEG snapshot URL for a profile — the frame source for attendance. */
export const getSnapshotUri = async (deviceUrl, profileToken, credentials) => {
  const { media } = await serviceUrls(deviceUrl, credentials);
  const xml = await soapCall(
    media,
    `<trt:GetSnapshotUri><trt:ProfileToken>${escapeXml(profileToken)}</trt:ProfileToken></trt:GetSnapshotUri>`,
    credentials,
  );
  const uri = tagText(xml, 'Uri');
  if (!uri) throw new PtzError('NO_SNAPSHOT', 'The camera did not offer a snapshot URL for this profile.');
  return uri;
};

const clamp = (value, low, high) => Math.min(high, Math.max(low, Number(value) || 0));

/**
 * Move to an absolute position. pan/tilt/zoom are ONVIF's own normalised
 * units: pan and tilt run -1..1 across the head's full travel, zoom 0..1.
 */
export const absoluteMove = async (deviceUrl, profileToken, { pan, tilt = 0, zoom = 0, speed }, credentials) => {
  const { ptz } = await serviceUrls(deviceUrl, credentials);

  const speedNode = speed
    ? `<tptz:Speed><tt:PanTilt x="${clamp(speed, 0, 1)}" y="${clamp(speed, 0, 1)}"/><tt:Zoom x="${clamp(speed, 0, 1)}"/></tptz:Speed>`
    : '';

  await soapCall(
    ptz,
    '<tptz:AbsoluteMove>'
      + `<tptz:ProfileToken>${escapeXml(profileToken)}</tptz:ProfileToken>`
      + '<tptz:Position>'
      + `<tt:PanTilt x="${clamp(pan, -1, 1)}" y="${clamp(tilt, -1, 1)}"/>`
      + `<tt:Zoom x="${clamp(zoom, 0, 1)}"/>`
      + '</tptz:Position>'
      + speedNode
      + '</tptz:AbsoluteMove>',
    credentials,
  );
};

/** A nudge in a direction, for the manual pad. Velocities are -1..1. */
export const continuousMove = async (deviceUrl, profileToken, { pan = 0, tilt = 0, zoom = 0 }, credentials) => {
  const { ptz } = await serviceUrls(deviceUrl, credentials);
  await soapCall(
    ptz,
    '<tptz:ContinuousMove>'
      + `<tptz:ProfileToken>${escapeXml(profileToken)}</tptz:ProfileToken>`
      + `<tptz:Velocity><tt:PanTilt x="${clamp(pan, -1, 1)}" y="${clamp(tilt, -1, 1)}"/><tt:Zoom x="${clamp(zoom, -1, 1)}"/></tptz:Velocity>`
      + '</tptz:ContinuousMove>',
    credentials,
  );
};

export const stopMove = async (deviceUrl, profileToken, credentials) => {
  const { ptz } = await serviceUrls(deviceUrl, credentials);
  await soapCall(
    ptz,
    '<tptz:Stop>'
      + `<tptz:ProfileToken>${escapeXml(profileToken)}</tptz:ProfileToken>`
      + '<tptz:PanTilt>true</tptz:PanTilt><tptz:Zoom>true</tptz:Zoom>'
      + '</tptz:Stop>',
    credentials,
  );
};

/**
 * Where the head is now, and whether it is still moving.
 *
 * `moving` is what makes a sweep trustworthy: AbsoluteMove returns as soon as
 * the camera accepts the command, not when the head arrives, so a frame
 * grabbed immediately afterwards is of wherever the camera used to be
 * pointing. Cameras that omit MoveStatus read as not moving, which is why the
 * sweep also waits a fixed settle time rather than trusting this alone.
 */
export const getStatus = async (deviceUrl, profileToken, credentials) => {
  const { ptz } = await serviceUrls(deviceUrl, credentials);
  const xml = await soapCall(
    ptz,
    `<tptz:GetStatus><tptz:ProfileToken>${escapeXml(profileToken)}</tptz:ProfileToken></tptz:GetStatus>`,
    credentials,
  );

  const position = section(xml, 'Position') || xml;
  const moveStatus = section(xml, 'MoveStatus');

  return {
    pan: Number(tagAttr(position, 'PanTilt', 'x')) || 0,
    tilt: Number(tagAttr(position, 'PanTilt', 'y')) || 0,
    zoom: Number(tagAttr(position, 'Zoom', 'x')) || 0,
    moving: /MOVING/i.test(tagText(moveStatus, 'PanTilt')) || /MOVING/i.test(tagText(moveStatus, 'Zoom')),
  };
};
