// Voice sign-in: the voice counterpart of face sign-in.
//
// At registration (or when an administrator edits the account) a few clips of
// the person talking are turned into ECAPA-TDNN voiceprints on the server
// (speaker_worker.py, the model Speaker recognition uses) and stored on the
// account: voiceEmbeddings, one per clip, and voiceModel. The clips themselves
// are not kept.
//
// Signing in is a search, like face sign-in: the clip's voiceprint is compared
// by cosine similarity with the centroid of every approved account's, and the
// best one is let in only when it clears VOICE_LOGIN_THRESHOLD and beats the
// runner-up by VOICE_LOGIN_MARGIN. Both are stricter than the Speaker
// recognition page's default, because here a wrong answer signs someone in.
//
// What that does not protect against: a recording of the person. There is no
// liveness check, exactly as with a photograph for face sign-in, so voice is
// an alternative way in, not a second factor.

import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { baseSpeakerModel, baseVoiceprint, voiceSimilarity } from './speakerRecognition.js';

export const VOICE_LOGIN_THRESHOLD = Number(process.env.VOICE_LOGIN_THRESHOLD) || 0.6;
export const VOICE_LOGIN_MARGIN = Number(process.env.VOICE_LOGIN_MARGIN) || 0.1;

const MIN_CLIPS = 2;
const MAX_CLIPS = 5;
const MAX_CLIP_SECONDS = 12;
// A 16 kHz mono 16-bit WAV of MAX_CLIP_SECONDS, plus its header.
const MAX_CLIP_BYTES = 16000 * 2 * MAX_CLIP_SECONDS + 1024;
const MIN_ENROL_SPEECH = 1.5;
const MIN_LOGIN_SPEECH = 1;

export class VoiceError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Whether the server can make voiceprints at all (the model is downloaded). */
export const voiceAvailable = async () => Boolean(await baseSpeakerModel());

/** "data:audio/wav;base64,…" to its bytes, or a VoiceError. */
const wavFromDataUrl = (value) => {
  const match = /^data:audio\/(?:wav|x-wav|wave);base64,([A-Za-z0-9+/=]+)$/.exec(String(value || ''));
  if (!match) throw new VoiceError('A voice clip is not a WAV recording. Record it again.');
  const bytes = Buffer.from(match[1], 'base64');
  if (bytes.length > MAX_CLIP_BYTES) throw new VoiceError(`Each voice clip may be at most ${MAX_CLIP_SECONDS} seconds long.`);
  if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') {
    throw new VoiceError('A voice clip is not a WAV recording. Record it again.');
  }
  return bytes;
};

const withTempFile = async (bytes, work) => {
  const file = path.join(os.tmpdir(), `ks-voice-${randomUUID()}.wav`);
  await fs.writeFile(file, bytes);
  try {
    return await work(file);
  } finally {
    await fs.rm(file, { force: true });
  }
};

/** A worker or model failure, as a VoiceError the caller can answer with. */
const asVoiceError = (error) => (error instanceof VoiceError ? error
  : new VoiceError(error?.message?.replace(/^[^:]*: /, '') || 'The voice could not be analysed.', error?.status || 400));

/**
 * The account fields for a set of enrolment clips (WAV data URLs):
 * { voiceEmbeddings, voiceModel, voiceEnrolledAt }. Every clip must hold at
 * least MIN_ENROL_SPEECH seconds of speech.
 */
export const voiceprintFromClips = async (clips) => {
  if (!Array.isArray(clips) || clips.length < MIN_CLIPS) {
    throw new VoiceError(`Record at least ${MIN_CLIPS} voice clips, or leave voice sign-in out.`);
  }
  if (clips.length > MAX_CLIPS) throw new VoiceError(`At most ${MAX_CLIPS} voice clips.`);
  const wavs = clips.map(wavFromDataUrl);

  const embeddings = [];
  let model = '';
  for (const [index, wav] of wavs.entries()) {
    let print;
    try {
      print = await withTempFile(wav, baseVoiceprint);
    } catch (error) {
      throw asVoiceError(error);
    }
    if (print.speechSeconds < MIN_ENROL_SPEECH) {
      throw new VoiceError(`Voice clip ${index + 1} has only ${print.speechSeconds.toFixed(1)} s of speech. Record it again, talking for a few seconds.`);
    }
    embeddings.push(print.embedding);
    model = print.model;
  }
  return { voiceEmbeddings: embeddings, voiceModel: model, voiceEnrolledAt: new Date() };
};

/** The fields that clear an account's voice sign-in. */
export const noVoice = () => ({ voiceEmbeddings: undefined, voiceModel: '', voiceEnrolledAt: null });

/**
 * Who is speaking in a sign-in clip (a WAV file on disk), among `candidates`
 * of the model it returns: { user, score, runnerUp } or a VoiceError.
 * `candidatesFor(model)` supplies the accounts enrolled with that model.
 */
export const identifyVoice = async (filePath, candidatesFor) => {
  let print;
  try {
    print = await baseVoiceprint(filePath);
  } catch (error) {
    throw asVoiceError(error);
  }
  if (print.speechSeconds < MIN_LOGIN_SPEECH) {
    throw new VoiceError('Too little speech was heard. Say a full sentence and try again.');
  }

  let best = null;
  let runnerUp = -1;
  for (const user of await candidatesFor(print.model)) {
    if (!user.voiceEmbeddings?.length) continue;
    const score = voiceSimilarity(print.embedding, user.voiceEmbeddings);
    if (!best || score > best.score) {
      runnerUp = best ? best.score : runnerUp;
      best = { user, score };
    } else if (score > runnerUp) {
      runnerUp = score;
    }
  }
  const refuse = new VoiceError('That voice was not recognised. Sign in with your username and password instead.', 401);
  if (!best || best.score < VOICE_LOGIN_THRESHOLD) throw refuse;
  if (best.score - runnerUp < VOICE_LOGIN_MARGIN) {
    console.warn(`Voice sign-in refused as ambiguous: best ${best.score.toFixed(3)}, runner-up ${runnerUp.toFixed(3)}.`);
    throw refuse;
  }
  return { user: best.user, score: best.score, runnerUp };
};

/*
 * Sign-in attempts per address. Voice sign-in costs the server a model run
 * and, unlike a password, can be tried with any recording at hand, so it is
 * rationed: VOICE_LOGIN_ATTEMPTS per ten minutes per client address.
 */
const ATTEMPTS = Math.max(1, Number(process.env.VOICE_LOGIN_ATTEMPTS) || 10);
const WINDOW_MS = 10 * 60 * 1000;
const attempts = new Map(); // ip -> [timestamps]

export const takeAttempt = (ip) => {
  const now = Date.now();
  const recent = (attempts.get(ip) || []).filter((time) => now - time < WINDOW_MS);
  if (recent.length >= ATTEMPTS) {
    attempts.set(ip, recent);
    return false;
  }
  recent.push(now);
  attempts.set(ip, recent);
  if (attempts.size > 10000) attempts.delete(attempts.keys().next().value);
  return true;
};
