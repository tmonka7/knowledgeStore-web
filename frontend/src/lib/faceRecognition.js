const MODEL_URL = '/face-api-model';

let modelsPromise;

const getFaceApi = () => window.faceapi;

export const loadFaceModels = async () => {
  const faceapi = getFaceApi();
  if (!faceapi) {
    throw new Error('Face recognition is unavailable. Reload the page and try again.');
  }

  if (!modelsPromise) {
    modelsPromise = Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]).catch((error) => {
      modelsPromise = undefined;
      throw error;
    });
  }

  await modelsPromise;
};

export const descriptorFromImage = async (image) => {
  const faceapi = getFaceApi();
  await loadFaceModels();
  const result = await faceapi
    .detectSingleFace(image, new faceapi.TinyFaceDetectorOptions())
    .withFaceLandmarks()
    .withFaceDescriptor();

  if (!result) {
    throw new Error('No clear face was found. Use a well-lit photo with one face visible.');
  }

  return Array.from(result.descriptor);
};

export const descriptorFromFile = async (file) => {
  const image = await faceapiImage(file);
  return descriptorFromImage(image);
};

const faceapiImage = (file) => new Promise((resolve, reject) => {
  const image = new Image();
  const url = URL.createObjectURL(file);
  image.onload = () => {
    URL.revokeObjectURL(url);
    resolve(image);
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    reject(new Error('Unable to read that image.'));
  };
  image.src = url;
});
