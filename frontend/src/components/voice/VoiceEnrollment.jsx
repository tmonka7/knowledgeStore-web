import { useEffect, useRef, useState } from 'react';
import {
  Button, List, Space, Tag, Typography, message,
} from 'antd';
import { CheckCircleFilled, DeleteOutlined, SoundOutlined } from '@ant-design/icons';
import ClipRecorder from '../speaker/ClipRecorder';
import { useLanguage } from '../../i18n';

const { Text } = Typography;

export const VOICE_CLIPS = 3;
export const MAX_CLIP_SECONDS = 10;

/** The clips as the API takes them: WAV data URLs. */
export const clipsToDataUrls = (clips) => Promise.all(clips.map((clip) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).replace(/^data:[^;]*;/, 'data:audio/wav;'));
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(clip.blob);
})));

/**
 * Enrol a voice for signing in: VOICE_CLIPS short recordings of the person
 * reading a sentence each, from the microphone only. The server turns
 * them into voiceprints; the page only collects them. `onChange(clips, done)`
 * hears every change; `done` once all VOICE_CLIPS are recorded.
 */
export default function VoiceEnrollment({ onChange, optional = false }) {
  const { t } = useLanguage();
  const [clips, setClips] = useState([]); // [{ blob, seconds, url, source }]
  const sentences = [t('voiceEnrollSentence1'), t('voiceEnrollSentence2'), t('voiceEnrollSentence3')];
  const done = clips.length >= VOICE_CLIPS;

  const clipsRef = useRef(clips);
  clipsRef.current = clips;
  useEffect(() => { onChange?.(clips, done); }, [clips]); // eslint-disable-line react-hooks/exhaustive-deps
  // The players' object URLs, released when the section goes.
  useEffect(() => () => clipsRef.current.forEach((clip) => URL.revokeObjectURL(clip.url)), []);

  const add = (clip, source) => {
    if (clip.seconds > MAX_CLIP_SECONDS + 0.5) {
      // Recording stops at MAX_CLIP_SECONDS; this only guards the server's limit.
      message.warning(t('voiceEnrollTooLong', { seconds: MAX_CLIP_SECONDS }));
      return;
    }
    setClips((current) => [...current, { ...clip, source, url: URL.createObjectURL(clip.blob) }].slice(0, VOICE_CLIPS));
  };

  const remove = (index) => setClips((current) => {
    URL.revokeObjectURL(current[index].url);
    return current.filter((_, position) => position !== index);
  });

  return (
    <div className="voice-enrollment">
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        <Space wrap size={6}>
          <SoundOutlined />
          <Text strong>{t('voiceEnrollTitle')}</Text>
          {optional && <Tag>{t('optional')}</Tag>}
          {done && <Tag color="green" icon={<CheckCircleFilled />}>{t('voiceEnrollDone')}</Tag>}
        </Space>
        <Text type="secondary" style={{ fontSize: 12 }}>{t('voiceEnrollHelp', { count: VOICE_CLIPS })}</Text>

        {clips.length > 0 && (
          <List
            size="small"
            dataSource={clips}
            renderItem={(clip, index) => (
              <List.Item
                actions={[<Button key="remove" size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => remove(index)} aria-label={t('voiceEnrollRemove')} />]}
              >
                <Space wrap size={8}>
                  <Text>{`${index + 1}.`}</Text>
                  <audio controls src={clip.url} style={{ height: 30 }} />
                  <Text type="secondary" style={{ fontSize: 12 }}>{`${clip.seconds.toFixed(1)} s`}</Text>
                </Space>
              </List.Item>
            )}
          />
        )}

        {!done && (
          <>
            <Text>{t('voiceEnrollRead', { number: clips.length + 1, count: VOICE_CLIPS })}</Text>
            <blockquote className="voice-enrollment-sentence">{sentences[clips.length % sentences.length]}</blockquote>
            <ClipRecorder onClip={add} maxSeconds={MAX_CLIP_SECONDS} hint={t('voiceEnrollHint', { seconds: MAX_CLIP_SECONDS })} />
          </>
        )}
      </Space>
    </div>
  );
}
