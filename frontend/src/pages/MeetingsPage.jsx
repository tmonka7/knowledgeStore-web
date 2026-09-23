import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Empty, Input, List, Modal, Select, Tooltip, message } from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  StopOutlined,
  TeamOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import api from '../api';
import { can } from '../permissions';
import FilterBar from '../components/ui/FilterBar';
import PageHeader from '../components/ui/PageHeader';
import StatCard from '../components/ui/StatCard';
import StatusBadge from '../components/ui/StatusBadge';
import MeetingFormModal from '../components/meeting/MeetingFormModal';
import MeetingRoom from '../components/meeting/MeetingRoom';
import { mediaSupport } from '../components/meeting/useMeetingRoom';
import { useLanguage } from '../i18n';

const apiOrigin = () => (import.meta.env.VITE_API_URL || 'http://127.0.0.1:4000/api').replace(/\/api$/, '');

const recordingUrl = (path) => {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  return `${apiOrigin()}${path.startsWith('/') ? '' : '/'}${path}`;
};

const formatMoment = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

const formatSize = (bytes) => {
  if (!bytes) return '';
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
};

const formatDuration = (ms) => {
  if (!ms) return '';
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
};

const describeWhen = (meeting, t) => {
  if (meeting.live) return t('inProgress');
  if (meeting.status === 'ended') return `${t('ended')} ${formatMoment(meeting.endedAt)}`;
  if (meeting.scheduledAt) return formatMoment(meeting.scheduledAt);
  return t('openStartWhenever');
};

/**
 * Meetings.
 *
 * The list owns the data and swaps in the room when you join, rather than
 * routing to it — the same shape Cameras and Projects already use here. It also
 * means leaving a call puts you back on a list that is still in the state you
 * left it in.
 */
export default function MeetingsPage({ user, directory = [] }) {
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [joined, setJoined] = useState(null);
  const [attendance, setAttendance] = useState(null);
  const [recordingsFor, setRecordingsFor] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const { t } = useLanguage();
  const canCreate = can(user, 'meetings', 'create');
  const support = useMemo(() => mediaSupport(), []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/meetings');
      setMeetings(data.meetings || []);
    } catch (error) {
      message.error(error.response?.data?.message || t('unableToLoadMeetings'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /*
   * Who is in a room changes without anything on this page doing it, so the
   * list refreshes on a timer. It stops while you are in a call: the room has
   * its own live roster, and a background reload would be pure noise.
   */
  useEffect(() => {
    if (joined) return undefined;
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, [joined, load]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return meetings.filter((meeting) => {
      if (statusFilter === 'live' && !meeting.live) return false;
      if (statusFilter === 'upcoming' && (meeting.live || meeting.status === 'ended')) return false;
      if (statusFilter === 'ended' && meeting.status !== 'ended') return false;
      if (!needle) return true;
      return [meeting.title, meeting.description, meeting.hostName]
        .some((field) => String(field || '').toLowerCase().includes(needle));
    });
  }, [meetings, search, statusFilter]);

  const totals = useMemo(() => ({
    live: meetings.filter((meeting) => meeting.live).length,
    upcoming: meetings.filter((meeting) => !meeting.live && meeting.status !== 'ended').length,
    inCalls: meetings.reduce((sum, meeting) => sum + (meeting.activeCount || 0), 0),
    recordings: meetings.reduce((sum, meeting) => sum + (meeting.recordings?.length || 0), 0),
  }), [meetings]);

  const save = async (values) => {
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/meetings/${editing.id}`, values);
        message.success(t('meetingUpdated'));
      } else {
        await api.post('/meetings', values);
        message.success(t('meetingCreated'));
      }
      setModalOpen(false);
      setEditing(null);
      await load();
    } catch (error) {
      message.error(error.response?.data?.message || t('unableToSaveMeeting'));
    } finally {
      setSaving(false);
    }
  };

  const endMeeting = (meeting) => {
    Modal.confirm({
      title: t('endMeetingQuestion', { title: meeting.title }),
      content: meeting.activeCount
        ? t('meetingEndWarningPeople', { count: meeting.activeCount })
        : t('meetingEndWarningSaved'),
      okText: t('endMeeting'),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api.post(`/meetings/${meeting.id}/end`);
          message.success(t('meetingEnded'));
          await load();
        } catch (error) {
          message.error(error.response?.data?.message || t('unableToEndMeeting'));
        }
      },
    });
  };

  const removeMeeting = (meeting) => {
    Modal.confirm({
      title: t('deleteMeetingQuestion', { title: meeting.title }),
      content: meeting.recordings?.length
        ? t('deleteMeetingWarningRecordings', { count: meeting.recordings.length })
        : t('deleteMeetingWarningMessages'),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api.delete(`/meetings/${meeting.id}`);
          message.success(t('meetingDeleted'));
          await load();
        } catch (error) {
          message.error(error.response?.data?.message || t('unableToDeleteMeeting'));
        }
      },
    });
  };

  const removeRecording = (meeting, recording) => {
    Modal.confirm({
      title: t('deleteRecordingQuestion', { name: recording.name }),
      content: t('deleteRecordingWarning', { size: formatSize(recording.size), name: recording.recordedByName || t('someone') }),
      okText: t('delete'),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const { data } = await api.delete(`/meetings/${meeting.id}/recordings/${recording.id}`);
          setRecordingsFor(data.meeting);
          setMeetings((list) => list.map((row) => (row.id === data.meeting.id ? data.meeting : row)));
          message.success(t('recordingDeleted'));
        } catch (error) {
          message.error(error.response?.data?.message || t('unableToDeleteRecording'));
        }
      },
    });
  };

  if (joined) {
    return (
      <MeetingRoom
        user={user}
        meeting={joined}
        onLeave={() => { setJoined(null); load(); }}
        onMeetingChanged={(updated) => {
          if (!updated) return;
          setMeetings((list) => list.map((row) => (row.id === updated.id ? updated : row)));
        }}
      />
    );
  }

  return (
    <div className="vision-page vision-stack">
      <PageHeader
        title={t('meetings')}
        subtitle={t('meetingsSubtitle')}
        actions={(
          <>
            <Button className="vision-btn-ghost" icon={<ReloadOutlined />} loading={loading} onClick={load}>
              {t('refresh')}
            </Button>
            {canCreate && (
              <Button
                type="primary"
                className="vision-btn-primary"
                icon={<PlusOutlined />}
                onClick={() => { setEditing(null); setModalOpen(true); }}
              >
                {t('newMeeting')}
              </Button>
            )}
          </>
        )}
      />

      {/* Said here rather than at the moment of joining: finding out the
          browser will not give up the camera after clicking Join, in front of
          everyone already in the call, is the wrong time to learn it. */}
      {!support.ok && (
        <section className="vision-panel meeting-warning">
          <strong>{t('cameraAndMicrophoneUnavailable')}</strong>
          <p className="vision-cell-muted">{support.reason}</p>
        </section>
      )}

      <div className="vision-stat-grid">
        <StatCard tone="green" icon={<VideoCameraOutlined />} label={t('inProgress')} value={totals.live} meta={t('peopleInCalls', { count: totals.inCalls })} />
        <StatCard tone="blue" icon={<TeamOutlined />} label={t('upcoming')} value={totals.upcoming} meta={t('scheduledOrOpen')} />
        <StatCard tone="violet" icon={<PlayCircleOutlined />} label={t('recordings')} value={totals.recordings} meta={t('savedToMeetings')} />
        <StatCard tone="amber" icon={<TeamOutlined />} label={t('meetings')} value={meetings.length} meta={t('youCanSee')} />
      </div>

      <FilterBar
        actions={(
          <Button className="vision-btn-ghost" onClick={() => { setSearch(''); setStatusFilter('all'); }}>
            {t('clear')}
          </Button>
        )}
      >
        <Input.Search
          className="vision-filter-search"
          placeholder={t('searchMeetings')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          allowClear
        />
        <Select
          value={statusFilter}
          onChange={setStatusFilter}
          className="vision-filter-select"
          options={[
            { value: 'all', label: t('allMeetings') },
            { value: 'live', label: t('inProgress') },
            { value: 'upcoming', label: t('upcoming') },
            { value: 'ended', label: t('ended') },
          ]}
        />
      </FilterBar>

      {!visible.length ? (
        <section className="vision-panel">
          <Empty
            description={meetings.length ? t('noMeetingMatches') : t('noMeetingsYet')}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        </section>
      ) : (
        <div className="meeting-grid-list">
          {visible.map((meeting) => (
            <article key={meeting.id} className={`meeting-card${meeting.live ? ' is-live' : ''}`}>
              <header className="meeting-card-head">
                <h3>{meeting.title}</h3>
                <StatusBadge
                  tone={meeting.live ? 'green' : (meeting.status === 'ended' ? 'grey' : 'blue')}
                  dot={meeting.live}
                >
                  {meeting.live ? t('live') : (meeting.status === 'ended' ? t('ended') : t('scheduled'))}
                </StatusBadge>
              </header>

              <p className="meeting-card-desc">{meeting.description || t('noDescription')}</p>

              <dl className="meeting-card-facts">
                <div><dt>{t('host')}</dt><dd>{meeting.hostName || '—'}</dd></div>
                <div><dt>{t('when')}</dt><dd>{describeWhen(meeting, t)}</dd></div>
                <div>
                  <dt>{t('who')}</dt>
                  <dd>{meeting.openToAll ? t('everyone') : t('invitedCount', { count: meeting.inviteeIds.length })}</dd>
                </div>
              </dl>

              {meeting.live && (
                <p className="meeting-card-present">
                  {t('peopleInCall', { names: meeting.activePeople.map((person) => person.name).join(', ') || '—' })}
                </p>
              )}

              <footer className="meeting-card-foot">
                <div className="meeting-card-links">
                  <Button type="link" size="small" onClick={() => setAttendance(meeting)}>
                    {t('attendedCount', { count: meeting.attendedCount })}
                  </Button>
                  {meeting.recordings.length > 0 && (
                    <Button type="link" size="small" onClick={() => setRecordingsFor(meeting)}>
                      {t('recordingsCount', { count: meeting.recordings.length })}
                    </Button>
                  )}
                </div>

                <div className="vision-row-actions">
                  {meeting.canManage && meeting.status !== 'ended' && (
                    <>
                      <Tooltip title={t('edit')}>
                        <Button
                          size="small"
                          aria-label={`Edit ${meeting.title}`}
                          icon={<EditOutlined />}
                          onClick={() => { setEditing(meeting); setModalOpen(true); }}
                        />
                      </Tooltip>
                      <Tooltip title={t('endMeeting')}>
                        <Button
                          size="small"
                          aria-label={`End ${meeting.title}`}
                          icon={<StopOutlined />}
                          onClick={() => endMeeting(meeting)}
                        />
                      </Tooltip>
                    </>
                  )}
                  {meeting.canManage && (
                    <Tooltip title={t('delete')}>
                      <Button
                        size="small"
                        danger
                        aria-label={`Delete ${meeting.title}`}
                        icon={<DeleteOutlined />}
                        onClick={() => removeMeeting(meeting)}
                      />
                    </Tooltip>
                  )}
                  {meeting.status !== 'ended' && (
                    <Tooltip title={t('joinMeeting')}>
                      <Button
                        type="primary"
                        size="small"
                        className="vision-btn-primary vision-meeting-join-button"
                        icon={<VideoCameraOutlined />}
                        onClick={() => setJoined(meeting)}
                        aria-label={`Join ${meeting.title}`}
                      />
                    </Tooltip>
                  )}
                </div>
              </footer>
            </article>
          ))}
        </div>
      )}

      <MeetingFormModal
        open={modalOpen}
        meeting={editing}
        directory={directory}
        saving={saving}
        onCancel={() => { setModalOpen(false); setEditing(null); }}
        onSubmit={save}
      />

      <Modal
        open={Boolean(attendance)}
        title={attendance ? t('whoAttendedTitle', { title: attendance.title }) : ''}
        footer={null}
        onCancel={() => setAttendance(null)}
      >
        {!attendance?.participants?.length ? (
          <Empty description={t('nobodyHasJoinedYet')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <List
            dataSource={attendance.participants}
            renderItem={(row, index) => (
              <List.Item key={`${row.userId}-${index}`}>
                <List.Item.Meta
                  title={row.name || 'Someone'}
                  description={t('joinedPresence', { joinedAt: formatMoment(row.joinedAt), leftAt: row.leftAt ? ` · ${t('leftAt', { leftAt: formatMoment(row.leftAt) })}` : ` · ${t('stillInCall')}` })}
                />
              </List.Item>
            )}
          />
        )}
      </Modal>

      <Modal
        open={Boolean(recordingsFor)}
        title={recordingsFor ? t('recordingsOfTitle', { title: recordingsFor.title }) : ''}
        footer={null}
        width={720}
        onCancel={() => setRecordingsFor(null)}
      >
        <List
          dataSource={recordingsFor?.recordings || []}
          renderItem={(recording) => (
            <List.Item
              key={recording.id}
              actions={[
                <a key="open" href={recordingUrl(recording.path)} target="_blank" rel="noreferrer">{t('open')}</a>,
                <a key="save" href={recordingUrl(recording.path)} download={recording.name}>{t('download')}</a>,
                <Button
                  key="delete"
                  type="link"
                  danger
                  size="small"
                  onClick={() => removeRecording(recordingsFor, recording)}
                >
                  {t('delete')}
                </Button>,
              ]}
            >
              <List.Item.Meta
                title={recording.name}
                description={[
                  t('recordedBy', { name: recording.recordedByName || t('someone') }),
                  formatMoment(recording.createdAt),
                  formatDuration(recording.durationMs),
                  formatSize(recording.size),
                ].filter(Boolean).join(' · ')}
              />
            </List.Item>
          )}
        />
      </Modal>
    </div>
  );
}
