import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Modal } from 'antd';
import { CameraOutlined, ReloadOutlined } from '@ant-design/icons';
import CameraPreview from './CameraPreview';
import FaceCropFrame from './FaceCropFrame';
import FacePositionGuide from './FacePositionGuide';
import FaceCaptureConfirmation from './FaceCaptureConfirmation';
import {
  DIAGNOSIS,
  FACE_RULES,
  cameraErrorFor,
  createFaceDetector,
  diagnose,
  sourceSize,
} from '../../lib/faceDetector';
import { canvasToDataUrl, cropToCanvas, padRect } from '../../lib/faceCrop';
import { descriptorFromImage } from '../../lib/faceRecognition';

const DEFAULT_RECT = { x: 0.28, y: 0.14, width: 0.44, height: 0.66 };
const DETECT_INTERVAL = 350;

/** Mirrors a normalised rect horizontally. */
const flipX = (rect) => ({ ...rect, x: 1 - rect.x - rect.width });

/**
 * Register Face dialog.
 *
 * `mode` is 'camera' for the live stream or 'image' for an uploaded file. The
 * crop rect is held in DISPLAY coordinates; because the camera preview is
 * mirrored, it is flipped before any pixel work so the saved crop matches what
 * the user framed.
 */
export default function CameraRegistrationModal({ open, mode, imageSrc, onCancel, onComplete }) {
  const videoRef = useRef(null);
  const imageRef = useRef(null);
  const streamRef = useRef(null);
  const detectorRef = useRef(null);
  const aliveRef = useRef(false);

  const [step, setStep] = useState('capture');
  const [starting, setStarting] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [rect, setRect] = useState(DEFAULT_RECT);
  const [diagnosis, setDiagnosis] = useState(DIAGNOSIS.NO_FACE);
  const [detecting, setDetecting] = useState(true);
  const [capture, setCapture] = useState(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  // The detection loop reads the rect through a ref: making it an effect
  // dependency would restart the interval on every drag frame.
  const rectRef = useRef(rect);
  rectRef.current = rect;

  const mirrored = mode === 'camera';
  const sourceEl = () => (mode === 'camera' ? videoRef.current : imageRef.current);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError({ code: 'UNSUPPORTED', title: 'Camera unavailable', hint: 'This browser cannot open a camera. Upload a photo instead.' });
      return;
    }

    setStarting(true);
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } },
      });
      if (!aliveRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      stopStream();
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch (caught) {
      setCameraError(cameraErrorFor(caught));
    } finally {
      if (aliveRef.current) setStarting(false);
    }
  }, [stopStream]);

  // Open / close lifecycle. The webcam must never outlive the dialog.
  useEffect(() => {
    if (!open) {
      aliveRef.current = false;
      stopStream();
      return undefined;
    }

    aliveRef.current = true;
    setStep('capture');
    setRect(DEFAULT_RECT);
    setCapture(null);
    setError('');
    setDiagnosis(DIAGNOSIS.NO_FACE);

    createFaceDetector().then((detector) => {
      if (!aliveRef.current) return;
      detectorRef.current = detector;
      setDetecting(detector.id !== 'unavailable');
      if (detector.id === 'unavailable') setDiagnosis(DIAGNOSIS.DETECTOR_OFF);
    });

    if (mode === 'camera') startCamera();

    return () => {
      aliveRef.current = false;
      stopStream();
    };
  }, [open, mode, startCamera, stopStream]);

  // The <video> is unmounted while an error or the confirm step is showing, so
  // re-attach the live stream whenever it comes back.
  useEffect(() => {
    if (videoRef.current && streamRef.current && !videoRef.current.srcObject) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [step, cameraError, starting]);

  // Live detection loop.
  useEffect(() => {
    if (!open || step !== 'capture' || cameraError) return undefined;

    let cancelled = false;
    let busy = false;

    const tick = async () => {
      const detector = detectorRef.current;
      const source = sourceEl();
      if (busy || !detector || !source) return;
      const { width, height } = sourceSize(source);
      if (!width || !height) return;

      busy = true;
      try {
        const detection = await detector.detectFace(source);
        if (cancelled) return;

        const currentRect = rectRef.current;
        // Detections come back in source space; compare them in display space.
        const displayBox = detection && mirrored
          ? flipX(detector.getFaceBoundingBox(detection))
          : detection?.box;

        const quality = detection
          ? detector.getFaceQuality(source, detector.getFaceBoundingBox(detection), currentRect)
          : null;

        setDiagnosis(diagnose({
          detector,
          detection: detection ? { ...detection, box: displayBox } : null,
          rect: currentRect,
          quality,
        }));
      } catch {
        // A transient detector failure should not break the loop.
      } finally {
        busy = false;
      }
    };

    const timer = setInterval(tick, DETECT_INTERVAL);
    tick();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [open, step, cameraError, mirrored]);

  const runCapture = async () => {
    const source = sourceEl();
    if (!source) return;

    setWorking(true);
    setError('');
    try {
      const { width, height } = sourceSize(source);
      if (!width || !height) throw new Error('The camera is still starting. Try again in a moment.');

      const sourceRect = mirrored ? flipX(rect) : rect;
      const cropCanvas = cropToCanvas(source, sourceRect);

      // The descriptor is read from a padded crop: detectors need margin around
      // the face, and this keeps it tied to the region the user selected.
      let descriptor;
      try {
        descriptor = await descriptorFromImage(cropToCanvas(source, padRect(sourceRect, 0.4), 640));
      } catch {
        descriptor = await descriptorFromImage(source);
      }

      const detector = detectorRef.current;
      const detection = detector ? await detector.detectFace(source) : null;
      const box = detection ? detector.getFaceBoundingBox(detection) : null;
      const quality = box ? detector.getFaceQuality(source, box, sourceRect) : null;
      const inside = box ? detector.isFaceInsideFrame(box, sourceRect) : null;
      const brightness = quality?.brightness;

      setCapture({
        image: canvasToDataUrl(cropCanvas),
        descriptor,
        checks: [
          { label: 'Face detected', passed: Boolean(descriptor) },
          { label: 'Good positioning', passed: inside === null ? true : inside },
          {
            label: 'Image quality good',
            passed: brightness === null || brightness === undefined
              ? true
              : brightness >= FACE_RULES.minBrightness && brightness <= FACE_RULES.maxBrightness,
          },
        ],
      });
      setStep('confirm');
    } catch (caught) {
      setError(caught.message || 'That face could not be captured. Please try again.');
    } finally {
      setWorking(false);
    }
  };

  const confirm = () => {
    onComplete({ descriptor: capture.descriptor, faceImage: capture.image });
  };

  const retake = () => {
    setCapture(null);
    setStep('capture');
    setError('');
  };

  const guideTone = diagnosis.code === 'OK' ? 'success' : diagnosis.tone === 'warning' ? 'warning' : 'idle';

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      footer={null}
      width={620}
      centered
      destroyOnClose
      maskClosable={false}
      className="face-modal"
      title={(
        <div className="face-modal-title">
          <h3>{step === 'confirm' ? 'Confirm Face' : 'Register Face'}</h3>
          <p>{step === 'confirm' ? 'Check the capture before you use it.' : 'Position your face inside the frame'}</p>
        </div>
      )}
    >
      {step === 'confirm' && capture ? (
        <FaceCaptureConfirmation
          image={capture.image}
          checks={capture.checks}
          saving={working}
          onRetake={retake}
          onConfirm={confirm}
        />
      ) : (
        <>
          <CameraPreview
            ref={videoRef}
            mode={mode}
            imageSrc={imageSrc}
            starting={starting}
            cameraError={cameraError}
            onAllowCamera={startCamera}
          >
            <FaceCropFrame rect={rect} onChange={setRect} tone={guideTone} />
          </CameraPreview>

          {mode === 'image' && (
            // Kept out of the DOM flow: the crop maths reads its natural size.
            <img ref={imageRef} src={imageSrc} alt="" className="face-source-probe" aria-hidden="true" />
          )}

          {!cameraError && <FacePositionGuide diagnosis={diagnosis} busy={starting} />}

          {!detecting && !cameraError && (
            <Alert
              type="info"
              showIcon
              className="face-modal-alert"
              message="Automatic face detection is unavailable, so position the frame yourself."
            />
          )}

          {error && <Alert type="error" showIcon className="face-modal-alert" message={error} />}

          <div className="face-modal-actions">
            <Button
              className="vision-btn-ghost"
              icon={<ReloadOutlined />}
              onClick={() => setRect(DEFAULT_RECT)}
              disabled={Boolean(cameraError)}
            >
              Reset Frame
            </Button>
            <Button
              type="primary"
              className="vision-btn-primary"
              icon={<CameraOutlined />}
              loading={working}
              disabled={Boolean(cameraError) || starting}
              onClick={runCapture}
            >
              Capture Face
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
