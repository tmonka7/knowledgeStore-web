import { useCallback, useEffect, useState } from 'react';
import { message } from 'antd';
import api from '../../api';

const THRESHOLD_KEY = 'speaker-threshold';

/** Speakers, the model's status, and the calls that change them. */
export default function useSpeakers(t) {
  const [status, setStatus] = useState(null);
  const [speakers, setSpeakers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [threshold, setThresholdState] = useState(() => {
    try {
      const stored = Number(window.localStorage.getItem(THRESHOLD_KEY));
      return stored > 0 && stored < 1 ? stored : null;
    } catch {
      return null;
    }
  });

  const setThreshold = (value) => {
    setThresholdState(value);
    try {
      window.localStorage.setItem(THRESHOLD_KEY, String(value));
    } catch {
      // Not remembered; nothing depends on it.
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: info }, { data: list }] = await Promise.all([
        api.get('/tools/speaker/status', { timeout: 0 }),
        api.get('/tools/speaker/speakers'),
      ]);
      setStatus(info);
      setSpeakers(list.speakers || []);
    } catch (error) {
      setStatus({ model: null, engine: { ok: false, message: error.response?.data?.message || error.message } });
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const replace = (speaker) => setSpeakers((current) => {
    const next = current.some((item) => item.id === speaker.id)
      ? current.map((item) => (item.id === speaker.id ? speaker : item))
      : [...current, speaker];
    return next.sort((a, b) => a.name.localeCompare(b.name));
  });

  const fail = (error, fallback) => message.error(error.response?.data?.message || error.message || fallback);

  const create = async (fields) => {
    try {
      const { data } = await api.post('/tools/speaker/speakers', fields);
      replace(data.speaker);
      return data.speaker;
    } catch (error) {
      fail(error);
      return null;
    }
  };

  const update = async (speaker, fields) => {
    try {
      const { data } = await api.patch(`/tools/speaker/speakers/${speaker.id}`, fields);
      replace(data.speaker);
    } catch (error) {
      fail(error);
    }
  };

  const remove = async (speaker) => {
    try {
      await api.delete(`/tools/speaker/speakers/${speaker.id}`);
      setSpeakers((current) => current.filter((item) => item.id !== speaker.id));
    } catch (error) {
      fail(error);
    }
  };

  /** Enroll a clip ({ blob, seconds }) as a sample of `speaker`; resolves to true when it was kept. */
  const addSample = async (speaker, clip, source) => {
    const form = new FormData();
    form.append('audio', clip.blob, 'sample.wav');
    form.append('source', source || '');
    try {
      const { data } = await api.post(`/tools/speaker/speakers/${speaker.id}/samples`, form, { timeout: 0 });
      replace(data.speaker);
      return true;
    } catch (error) {
      fail(error);
      return false;
    }
  };

  const removeSample = async (speaker, sample) => {
    try {
      const { data } = await api.delete(`/tools/speaker/speakers/${speaker.id}/samples/${sample.id}`);
      replace(data.speaker);
    } catch (error) {
      fail(error);
    }
  };

  /** A sample's audio as an object URL (the caller revokes it). */
  const sampleUrl = async (sample) => {
    const { data } = await api.get(`/tools/speaker/samples/${sample.id}/audio`, { responseType: 'blob' });
    return URL.createObjectURL(data);
  };

  /** Who is speaking in a clip; `speakerId` checks one speaker only. Null on failure. */
  const identify = async (clip, { speakerId } = {}) => {
    const form = new FormData();
    form.append('audio', clip.blob, 'clip.wav');
    form.append('threshold', String(threshold ?? status?.defaultThreshold ?? 0.35));
    if (speakerId) form.append('speakerId', speakerId);
    try {
      const { data } = await api.post('/tools/speaker/identify', form, { timeout: 0 });
      return data;
    } catch (error) {
      fail(error);
      return null;
    }
  };

  const ready = Boolean(status?.model && status?.engine?.ok);
  const enrolled = speakers.filter((speaker) => speaker.samples.some((sample) => sample.current));

  return {
    status, speakers, enrolled, loading, ready, load,
    threshold: threshold ?? status?.defaultThreshold ?? 0.35, setThreshold,
    create, update, remove, addSample, removeSample, sampleUrl, identify,
  };
}

/** A steady colour per speaker, for tags and the live timeline. */
const PALETTE = ['#1677ff', '#52c41a', '#fa8c16', '#eb2f96', '#722ed1', '#13c2c2', '#faad14', '#2f54eb', '#a0d911', '#f5222d'];
export const speakerColor = (id) => {
  let hash = 0;
  for (const char of String(id || '')) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length];
};
