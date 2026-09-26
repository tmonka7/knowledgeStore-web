import {
  addFiles, createDataset, deleteDataset, getDataset, listDatasets, saveTranscripts, saveYoloLabels,
} from '../helpers/mlDatasets.js';
import {
  startSpeechExport, startSpeechTraining, startYoloExport, startYoloTraining, transcribe, yoloPredict,
} from '../helpers/mlJobs.js';
import {
  JobError, cancelJob, createDownloadTicket, deleteModel, getJob, listJobs, listModels, probeDevices,
} from '../helpers/translationJobs.js';

/*
 * The YOLO and Speech to Text tools share one shape of API — datasets of
 * uploaded files, models, jobs, a test endpoint — differing only in which
 * scripts they run. `area` is "yolo" or "speech"; each maps to its dataset
 * folder and its model task.
 */
const AREAS = {
  yolo: {
    task: 'detection', startTraining: startYoloTraining, startExport: startYoloExport,
  },
  speech: {
    task: 'speech', startTraining: startSpeechTraining, startExport: startSpeechExport,
  },
};

const parsePaths = (value) => {
  try {
    const paths = JSON.parse(String(value || '[]'));
    return Array.isArray(paths) ? paths : null;
  } catch {
    return null;
  }
};

export const mlHandlers = (area) => {
  const { task, startTraining, startExport } = AREAS[area];

  return {
    listDatasets: async (req, res) => res.json({ datasets: await listDatasets(req.user.sub, area) }),
    createDataset: async (req, res) => res.status(201).json({ dataset: await createDataset(req.user.sub, area, req.body || {}) }),
    getDataset: async (req, res) => res.json({ dataset: await getDataset(req.user.sub, area, req.params.id) }),
    deleteDataset: async (req, res) => {
      await deleteDataset(req.user.sub, area, req.params.id);
      res.json({ ok: true });
    },

    /** POST …/datasets/:id/files — multipart "files" plus "paths", a JSON array in the same order. */
    addFiles: async (req, res) => {
      const paths = parsePaths(req.body?.paths);
      if (!paths) throw new JobError('"paths" must be a JSON array of file paths.');
      res.json(await addFiles(req.user.sub, area, req.params.id, req.files || [], paths));
    },

    /** PUT …/datasets/:id/labels (YOLO) or …/transcripts (speech) — the last step of an upload. */
    finishDataset: async (req, res) => {
      const dataset = area === 'yolo'
        ? await saveYoloLabels(req.user.sub, req.params.id, req.body || {})
        : await saveTranscripts(req.user.sub, req.params.id, req.body || {});
      res.json({ dataset });
    },

    listModels: async (req, res) => res.json({ models: await listModels(req.user.sub, task) }),
    deleteModel: async (req, res) => {
      await deleteModel(req.user.sub, req.params.id, task);
      res.json({ ok: true });
    },
    train: async (req, res) => {
      const job = await startTraining({
        ownerId: req.user.sub,
        datasetId: String(req.body?.datasetId || ''),
        baseModelId: String(req.body?.baseModelId || ''),
        name: req.body?.name,
        options: req.body?.options || {},
      });
      res.status(202).json({ job });
    },
    exportOnnx: async (req, res) => res.status(202).json({ job: await startExport({ ownerId: req.user.sub, modelId: req.params.id }) }),
    onnxLink: async (req, res) => {
      const ticket = await createDownloadTicket(req.user.sub, req.params.id, task);
      res.json({ path: `/tools/transformers/onnx-download/${ticket}` });
    },

    /** POST …/test — multipart "files" (images or WAVs) plus modelId. */
    test: async (req, res) => {
      const uploads = req.files || [];
      if (!uploads.length) throw new JobError(area === 'yolo' ? 'Choose an image.' : 'Choose a WAV file.');
      const modelId = String(req.body?.modelId || '');
      res.json(area === 'yolo'
        ? await yoloPredict({ ownerId: req.user.sub, modelId, uploads, confidence: req.body?.confidence })
        : await transcribe({ ownerId: req.user.sub, modelId, uploads, language: req.body?.language }));
    },

    devices: async (req, res) => res.json(await probeDevices({ refresh: req.query.refresh === '1' })),
    listJobs: (req, res) => res.json({ jobs: listJobs(req.user.sub, task) }),
    getJob: (req, res) => res.json({ job: getJob(req.user.sub, req.params.id, task) }),
    cancelJob: (req, res) => res.json({ job: cancelJob(req.user.sub, req.params.id, task) }),
  };
};
