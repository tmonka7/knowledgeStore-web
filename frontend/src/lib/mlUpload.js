import api from '../api';

/*
 * Saving a browser-side dataset (YOLO images, speech clips) to the server so
 * it can be trained on there.
 *
 * Incremental on purpose: the server says which files it already holds (path
 * and size), and only the rest are sent, so saving again after labelling a
 * few more images re-sends labels, not gigabytes. Files go in batches small
 * enough for the API's limits; the labels or transcripts go last, and that
 * final step also drops files the folder no longer has.
 */

const BATCH_FILES = 16;
const BATCH_BYTES = 32 * 1024 * 1024;

const batchesOf = (entries) => {
  const batches = [];
  let current = [];
  let bytes = 0;
  for (const entry of entries) {
    if (current.length && (current.length >= BATCH_FILES || bytes + entry.file.size > BATCH_BYTES)) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(entry);
    bytes += entry.file.size;
  }
  if (current.length) batches.push(current);
  return batches;
};

/**
 * @param area       'yolo' or 'speech'
 * @param datasetId  an existing server dataset to update, or null to create one named `name`
 * @param files      [{ path, file }] — path is the file's path relative to the folder
 * @param finish     { url suffix: 'labels' | 'transcripts', body } sent last
 * @param onProgress ({ phase, done, total, bytesDone, bytesTotal }) => void
 * @param signal     { cancelled } — set cancelled = true to stop between batches
 * @returns the saved dataset
 */
export const saveDatasetToServer = async ({ area, datasetId, name, files, finish, onProgress, signal = {} }) => {
  const base = `/tools/${area}/datasets`;
  const id = datasetId || (await api.post(base, { name })).data.dataset.id;

  onProgress?.({ phase: 'checking', done: 0, total: files.length, bytesDone: 0, bytesTotal: 0 });
  const { data } = await api.get(`${base}/${id}`);
  const held = new Map(data.dataset.files.map((file) => [file.path, file.size]));
  const missing = files.filter((entry) => held.get(entry.path) !== entry.file.size);

  const bytesTotal = missing.reduce((total, entry) => total + entry.file.size, 0);
  let done = 0;
  let bytesDone = 0;
  for (const batch of batchesOf(missing)) {
    if (signal.cancelled) throw new Error('cancelled');
    const form = new FormData();
    batch.forEach((entry) => form.append('files', entry.file, entry.file.name));
    form.append('paths', JSON.stringify(batch.map((entry) => entry.path)));
    const batchBytes = batch.reduce((total, entry) => total + entry.file.size, 0);
    await api.post(`${base}/${id}/files`, form, {
      timeout: 0,
      onUploadProgress: (event) => onProgress?.({
        phase: 'uploading',
        done,
        total: missing.length,
        bytesDone: bytesDone + Math.min(event.loaded, batchBytes),
        bytesTotal,
      }),
    });
    done += batch.length;
    bytesDone += batchBytes;
    onProgress?.({ phase: 'uploading', done, total: missing.length, bytesDone, bytesTotal });
  }

  onProgress?.({ phase: 'finishing', done, total: missing.length, bytesDone, bytesTotal });
  const saved = await api.put(`${base}/${id}/${finish.suffix}`, {
    ...finish.body,
    keep: files.map((entry) => entry.path),
  });
  return { dataset: saved.data.dataset, uploaded: missing.length, skipped: files.length - missing.length };
};

export const formatBytes = (bytes) => {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
};
