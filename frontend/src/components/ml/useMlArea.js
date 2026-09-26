import { useCallback, useEffect, useRef, useState } from 'react';
import { message } from 'antd';
import api from '../../api';

const POLL_MS = 2000;

/**
 * Models, jobs and datasets for one training area ('yolo' or 'speech'), and
 * the actions on them — the API under /tools/<area>/.
 *
 * Jobs are polled only while one is running, and the model list is reloaded
 * when a job finishes, since that is when a new model or export appears.
 */
export default function useMlArea(area, t) {
  const base = `/tools/${area}`;
  const [models, setModels] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [datasets, setDatasets] = useState([]);
  const [loading, setLoading] = useState(false);

  const loadModels = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`${base}/models`);
      setModels(data.models || []);
    } catch (error) {
      message.error(error.response?.data?.message || t('trainModelsLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [base, t]);

  const loadJobs = useCallback(async () => {
    try {
      const { data } = await api.get(`${base}/jobs`);
      setJobs(data.jobs || []);
    } catch {
      /* The next poll or reload tries again. */
    }
  }, [base]);

  const loadDatasets = useCallback(async () => {
    try {
      const { data } = await api.get(`${base}/datasets`);
      setDatasets(data.datasets || []);
    } catch (error) {
      message.error(error.response?.data?.message || t('mlDatasetsLoadFailed'));
    }
  }, [base, t]);

  const reload = useCallback(() => {
    loadModels();
    loadJobs();
    loadDatasets();
  }, [loadModels, loadJobs, loadDatasets]);

  useEffect(() => { reload(); }, [reload]);

  const running = jobs.some((job) => job.status === 'running');
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running) loadModels();
    wasRunning.current = running;
    if (!running) return undefined;
    const timer = setInterval(loadJobs, POLL_MS);
    return () => clearInterval(timer);
  }, [running, loadJobs, loadModels]);

  const addJob = (job) => setJobs((current) => [job, ...current]);

  const train = async (body) => {
    try {
      const { data } = await api.post(`${base}/train`, body);
      addJob(data.job);
      message.success(t('trainStarted'));
      return true;
    } catch (error) {
      message.error(error.response?.data?.message || t('trainFailedToStart'));
      return false;
    }
  };

  const exportOnnx = async (model) => {
    try {
      const { data } = await api.post(`${base}/models/${model.id}/onnx`);
      addJob(data.job);
    } catch (error) {
      message.error(error.response?.data?.message || t('onnxFailedToStart'));
    }
  };

  // A one-use link, downloaded natively: the zip can be large.
  const downloadOnnx = async (model) => {
    try {
      const { data } = await api.post(`${base}/models/${model.id}/onnx/link`);
      const link = document.createElement('a');
      link.href = `${api.defaults.baseURL.replace(/\/$/, '')}${data.path}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      message.error(error.response?.data?.message || t('onnxDownloadFailed'));
    }
  };

  const removeModel = async (model) => {
    try {
      await api.delete(`${base}/models/${model.id}`);
      loadModels();
    } catch (error) {
      message.error(error.response?.data?.message || error.message);
    }
  };

  const removeDataset = async (dataset) => {
    try {
      await api.delete(`${base}/datasets/${dataset.id}`);
      loadDatasets();
    } catch (error) {
      message.error(error.response?.data?.message || error.message);
    }
  };

  const cancel = async (job) => {
    try {
      await api.post(`${base}/jobs/${job.id}/cancel`);
      loadJobs();
    } catch (error) {
      message.error(error.response?.data?.message || error.message);
    }
  };

  /** POST …/test with files; resolves to the script's result, or null on failure. */
  const test = async (files, fields = {}) => {
    const form = new FormData();
    files.forEach((file) => form.append('files', file, file.name));
    Object.entries(fields).forEach(([key, value]) => {
      if (value != null && value !== '') form.append(key, String(value));
    });
    try {
      const { data } = await api.post(`${base}/test`, form, { timeout: 0 });
      return data;
    } catch (error) {
      message.error(error.response?.data?.message || t('mlTestFailed'));
      return null;
    }
  };

  return {
    models, jobs, datasets, loading, running, reload, loadDatasets,
    train, exportOnnx, downloadOnnx, removeModel, removeDataset, cancel, test,
  };
}
