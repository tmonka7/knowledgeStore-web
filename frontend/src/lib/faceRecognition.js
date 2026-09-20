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
  // The tiny detector is sensitive to how large the face is in the frame, so
  // retry at several input sizes before giving up on the photo.
  let result;
  for (const inputSize of [416, 320, 512, 608, 224]) {
    result = await faceapi
      .detectSingleFace(image, new faceapi.TinyFaceDetectorOptions({ inputSize, scoreThreshold: 0.4 }))
      .withFaceLandmarks()
      .withFaceDescriptor();
    if (result) break;
  }

  if (!result) {
    throw new Error('No clear face was found. Use a well-lit photo with one face visible.');
  }

  return Array.from(result.descriptor);
};

export const descriptorFromFile = async (file) => {
  const image = await faceapiImage(file);
  return descriptorFromImage(image);
};

export const imageDataFromFile = async (file) => imageDataFromElement(await faceapiImage(file));
export const imageDataFromCanvas = (canvas) => imageDataFromElement(canvas);

const imageDataFromElement = (element) => {
  const scale = Math.min(1, 640 / Math.max(element.naturalWidth || element.width, element.naturalHeight || element.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round((element.naturalWidth || element.width) * scale);
  canvas.height = Math.round((element.naturalHeight || element.height) * scale);
  canvas.getContext('2d').drawImage(element, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.82);
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
