import { useCallback, useEffect, useRef, useState } from 'react';
import { message } from 'antd';
import api from '../../api';

const POLL_MS = 1000;

export const ACTIVE = new Set(['queued', 'running']);

/** Where the browser fetches a finished file: the player's src, or a download with ?download=1. */
export const fileUrl = (job, download = false) => (job.downloadPath
  ? `${api.defaults.baseURL.replace(/\/$/, '')}${job.downloadPath}${download ? '?download=1' : ''}`
  : '');

/**
 * The user's conversion jobs of one kind ("video" | "audio"), polled while any
 * is queued or running, plus the upload that creates a job. The upload is
 * shown as its own entry (`upload`) until the server answers with the job.
 */
export default function useConvertJobs(kind, t) {
  const [jobs, setJobs] = useState([]);
  const [upload, setUpload] = useState(null); // { fileName, bytes, percent }
  const abort = useRef(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/tools/convert/jobs', { params: { kind } });
      setJobs(data.jobs || []);
    } catch {
      // A missed poll is retried by the next one.
    }
  }, [kind]);

  useEffect(() => { load(); }, [load]);

  const active = jobs.some((job) => ACTIVE.has(job.status));
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [active, load]);

  // Leaving the page mid-upload abandons it rather than finishing in the background.
  useEffect(() => () => abort.current?.abort(), []);

  const start = async (file, settings) => {
    const controller = new AbortController();
    abort.current = controller;
    setUpload({ fileName: file.name, bytes: file.size, percent: 0 });
    try {
      const form = new FormData();
      form.append('kind', kind);
      form.append('settings', JSON.stringify(settings));
      form.append('file', file);
      const { data } = await api.post('/tools/convert/jobs', form, {
        timeout: 0,
        signal: controller.signal,
        onUploadProgress: (event) => {
          if (event.total) setUpload((current) => current && { ...current, percent: (event.loaded / event.total) * 100 });
        },
      });
      setJobs((current) => [data.job, ...current.filter((job) => job.id !== data.job.id)]);
      return data.job;
    } catch (error) {
      if (!controller.signal.aborted) message.error(error.response?.data?.message || t('convertUploadFailed'));
      return null;
    } finally {
      abort.current = null;
      setUpload(null);
    }
  };

  const cancelUpload = () => abort.current?.abort();

  const cancel = async (job) => {
    try {
      const { data } = await api.post(`/tools/convert/jobs/${job.id}/cancel`);
      setJobs((current) => current.map((item) => (item.id === job.id ? data.job : item)));
    } catch (error) {
      message.error(error.response?.data?.message || error.message);
    }
  };

  const remove = async (job) => {
    try {
      await api.delete(`/tools/convert/jobs/${job.id}`);
    } catch {
      // Already gone (expired): dropping it from the list is what was wanted.
    }
    setJobs((current) => current.filter((item) => item.id !== job.id));
  };

  return { jobs, upload, start, cancelUpload, cancel, remove, reload: load };
}
