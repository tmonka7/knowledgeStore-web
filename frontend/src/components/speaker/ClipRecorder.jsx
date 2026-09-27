import { useEffect, useRef, useState } from 'react';
import {
  Button, Progress, Space, Typography, message,
} from 'antd';
import { AudioOutlined, StopOutlined, UploadOutlined } from '@ant-design/icons';
import { encodeWav16k, fileToWav16k, openMicrophone } from '../../lib/speechCapture';
import { useLanguage } from '../../i18n';

const { Text } = Typography;

/**
 * Record a clip from the microphone (stopping by itself after `maxSeconds`)
 * or, with `allowFile`, choose an audio file; either way
 * `onClip({ blob, seconds }, source)` receives a 16 kHz mono WAV. Enrolling
 * or signing in with a voice leaves `allowFile` off: a file could be anyone's
 * recording, so those take the microphone only.
 */
export default function ClipRecorder({
  onClip, disabled, busy, maxSeconds = 15, recordLabel, hint, allowFile = false,
}) {
  const { t } = useLanguage();
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const micRef = useRef(null);
  const startedRef = useRef(0);
  const inputId = useRef(`clip-${Math.random().toString(36).slice(2)}`).current;

  const stop = async () => {
    const mic = micRef.current;
    micRef.current = null;
    setRecording(false);
    if (!mic) return;
    const { samples, sampleRate } = await mic.stop();
    if (samples.length < sampleRate * 0.5) return;
    onClip(await encodeWav16k(samples, sampleRate), t('voiceMicrophone'));
  };

  useEffect(() => {
    if (!recording) return undefined;
    const timer = setInterval(() => {
      const seconds = (Date.now() - startedRef.current) / 1000;
      setElapsed(seconds);
      if (seconds >= maxSeconds) stop();
    }, 100);
    return () => clearInterval(timer);
  }, [recording]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { micRef.current?.stop(); }, []);

  const start = async () => {
    try {
      micRef.current = await openMicrophone({ onLevel: setLevel });
      startedRef.current = Date.now();
      setElapsed(0);
      setRecording(true);
    } catch (error) {
      message.error(error.message);
    }
  };

  const chooseFile = async (file) => {
    if (!file) return;
    try {
      onClip(await fileToWav16k(file), file.name);
    } catch (error) {
      message.error(error.message);
    }
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={6}>
      <Space wrap>
        {recording ? (
          <Button danger type="primary" icon={<StopOutlined />} onClick={stop}>
            {`${t('voiceStop')} · ${elapsed.toFixed(1)} / ${maxSeconds} s`}
          </Button>
        ) : (
          <Button type="primary" icon={<AudioOutlined />} disabled={disabled} loading={busy} onClick={start}>
            {recordLabel || t('speakerRecord')}
          </Button>
        )}
        {allowFile && (
          <>
            <Button icon={<UploadOutlined />} disabled={disabled || recording || busy} onClick={() => document.getElementById(inputId)?.click()}>
              {t('speakerChooseFile')}
            </Button>
            <input
              id={inputId}
              type="file"
              accept="audio/*,video/*"
              style={{ display: 'none' }}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                chooseFile(file);
              }}
            />
          </>
        )}
      </Space>
      {recording && (
        <Progress
          percent={Math.round(level * 100)}
          showInfo={false}
          status="active"
          strokeColor={level > 0.1 ? '#52c41a' : '#bfbfbf'}
        />
      )}
      {hint && <Text type="secondary" style={{ fontSize: 12 }}>{hint}</Text>}
    </Space>
  );
}
