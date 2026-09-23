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

/**
 * Every face in one frame, with a descriptor for each.
 *
 * descriptorFromImage above answers "whose face is this", which is the
 * question a sign-in or an enrolment asks. Attendance asks a different one —
 * "who is in this room" — and needs detectAllFaces, plus the position and
 * confidence of each detection so the caller can crop a thumbnail and throw
 * away the ones too small to trust.
 *
 * inputSize matters more here than it does for a portrait. The tiny detector
 * works on a square of this many pixels, so a face occupying 4% of a wide
 * frame is about twelve pixels across at 320 and misses entirely; 512 is the
 * smallest size that reliably finds people standing across a room, and the
 * cost is a slower pass over each frame — paid once per sweep stop, which is
 * a bargain compared with missing half the room.
 *
 * Boxes come back NORMALISED to 0..1, like everything else in faceDetector.
 */
export const descriptorsFromImage = async (image, { inputSize = 512, scoreThreshold = 0.45 } = {}) => {
  const faceapi = getFaceApi();
  await loadFaceModels();

  const results = await faceapi
    .detectAllFaces(image, new faceapi.TinyFaceDetectorOptions({ inputSize, scoreThreshold }))
    .withFaceLandmarks()
    .withFaceDescriptors();

  const width = image?.naturalWidth || image?.videoWidth || image?.width || 0;
  const height = image?.naturalHeight || image?.videoHeight || image?.height || 0;
  if (!width || !height) return [];

  return results.map((result) => {
    const box = result.detection.box;
    return {
      descriptor: Array.from(result.descriptor),
      score: Number(result.detection.score) || 0,
      box: {
        x: box.x / width,
        y: box.y / height,
        width: box.width / width,
        height: box.height / height,
      },
      // Face width as a fraction of the frame. This is the honest measure of
      // "how far away were they", and the server uses it to refuse sightings
      // too small to have produced a meaningful descriptor.
      ratio: box.width / width,
    };
  });
};
