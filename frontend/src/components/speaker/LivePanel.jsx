import { useEffect, useRef, useState } from 'react';
import {
  Alert, Button, Card, Empty, List, Progress, Space, Statistic, Tag, Typography, message,
} from 'antd';
import { AudioOutlined, ClearOutlined, LoadingOutlined, StopOutlined } from '@ant-design/icons';
import { encodeWav16k, openMicrophone } from '../../lib/speechCapture';
import { speakerColor } from './useSpeakers';
import { useLanguage } from '../../i18n';

const { Text } = Typography;
const MAX_ENTRIES = 200;

const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

/**
 * Listen continuously; each stretch of speech (cut at pauses) is identified
 * as it ends, building a "who spoke when" timeline and a per-speaker total.
 */
export default function LivePanel({ area }) {
  const { t } = useLanguage();
  const [listening, setListening] = useState(null); // { startedAt }
  const [level, setLevel] = useState(0);
  const [pending, setPending] = useState(0);
  const [entries, setEntries] = useState([]);
  const micRef = useRef(null);
  const chain = useRef(Promise.resolve());
  const startedAt = useRef(0);

  useEffect(() => () => { micRef.current?.stop(); }, []);

  const handlePhrase = async (samples, rate) => {
    const at = (Date.now() - startedAt.current) / 1000 - samples.length / rate;
    const clip = await encodeWav16k(samples, rate);
    setPending((count) => count + 1);
    // In order, one at a time: the timeline reads top to bottom as spoken.
    chain.current = chain.current.then(async () => {
      const result = await area.identify(clip);
      if (result) {
        setEntries((current) => [{
          id: `${Date.now()}-${Math.random()}`,
          at,
          seconds: clip.seconds,
          match: result.match,
          top: result.results[0] || null,
        }, ...current].slice(0, MAX_ENTRIES));
      }
    }).finally(() => setPending((count) => count - 1));
  };

  const start = async () => {
    try {
      micRef.current = await openMicrophone({
        live: true,
        pauseSeconds: 0.6,
        maxPhraseSeconds: 8,
        onLevel: setLevel,
        onPhrase: handlePhrase,
      });
      startedAt.current = Date.now();
      setListening({ startedAt: startedAt.current });
    } catch (error) {
      message.error(error.message);
    }
  };

  const stop = async () => {
    const mic = micRef.current;
    micRef.current = null;
    setListening(null);
    if (!mic) return;
    const { samples, sampleRate } = await mic.stop();
    if (samples.length > sampleRate) handlePhrase(samples, sampleRate);
  };

  // Talking time per speaker, most first.
  const totals = Object.values(entries.reduce((sum, entry) => {
    const key = entry.match?.speakerId || 'unknown';
    sum[key] = sum[key] || { key, name: entry.match?.name || t('speakerUnknown'), seconds: 0 };
    sum[key].seconds += entry.seconds;
    return sum;
  }, {})).sort((a, b) => b.seconds - a.seconds);
  const talked = totals.reduce((sum, row) => sum + row.seconds, 0) || 1;
  const now = entries[0];

  return (
    <Card
      bordered={false}
      title={t('speakerLiveTitle')}
      extra={(
        <Button icon={<ClearOutlined />} disabled={!entries.length} onClick={() => setEntries([])}>{t('voiceClear')}</Button>
      )}
    >
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {!area.enrolled.length && <Alert type="warning" showIcon message={t('speakerEnrollFirst')} />}
        <Space wrap align="center" size={16}>
          {listening ? (
            <Button danger type="primary" size="large" icon={<StopOutlined />} onClick={stop}>{t('voiceStop')}</Button>
          ) : (
            <Button type="primary" size="large" icon={<AudioOutlined />} disabled={!area.ready || !area.enrolled.length} onClick={start}>
              {t('speakerLiveStart')}
            </Button>
          )}
          {pending > 0 && <Tag icon={<LoadingOutlined />} color="processing">{t('speakerIdentifying', { count: pending })}</Tag>}
          {now && (
            <Statistic
              title={t('speakerLastHeard')}
              value={now.match?.name || t('speakerUnknown')}
              valueStyle={{ color: now.match ? speakerColor(now.match.speakerId) : '#8c8c8c', fontSize: 22 }}
            />
          )}
        </Space>
        {listening && <Progress percent={Math.round(level * 100)} showInfo={false} status="active" strokeColor={level > 0.1 ? '#52c41a' : '#bfbfbf'} />}
        <Text type="secondary" style={{ fontSize: 12 }}>{t('speakerLiveHelp')}</Text>

        {totals.length > 0 && (
          <Space wrap>
            {totals.map((row) => (
              <Tag key={row.key} color={row.key === 'unknown' ? 'default' : speakerColor(row.key)}>
                {`${row.name} · ${clock(row.seconds)} · ${Math.round((row.seconds / talked) * 100)}%`}
              </Tag>
            ))}
          </Space>
        )}

        {entries.length ? (
          <List
            size="small"
            dataSource={entries}
            renderItem={(entry) => (
              <List.Item>
                <Space wrap size={8}>
                  <Text type="secondary" style={{ fontFamily: 'monospace' }}>{clock(Math.max(0, entry.at))}</Text>
                  <Tag color={entry.match ? speakerColor(entry.match.speakerId) : 'default'}>
                    {entry.match?.name || t('speakerUnknown')}
                  </Tag>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {entry.match
                      ? t('speakerScoreShort', { score: entry.match.score.toFixed(2) })
                      : entry.top ? t('speakerClosest', { name: entry.top.name, score: entry.top.score.toFixed(2) }) : ''}
                    {` · ${entry.seconds.toFixed(1)} s`}
                  </Text>
                </Space>
              </List.Item>
            )}
          />
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('speakerLiveEmpty')} />
        )}
      </Space>
    </Card>
  );
}
