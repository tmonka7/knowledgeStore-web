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

const describeWhen = (meeting) => {
  if (meeting.live) return 'In progress';
  if (meeting.status === 'ended') return `Ended ${formatMoment(meeting.endedAt)}`;
  if (meeting.scheduledAt) return formatMoment(meeting.scheduledAt);
  return 'Open — start it whenever';
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

  const canCreate = can(user, 'meetings', 'create');
  const support = useMemo(() => mediaSupport(), []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/meetings');
      setMeetings(data.meetings || []);
    } catch (error) {
      message.error(error.response?.data?.message || 'Unable to load meetings.');
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
        message.success('Meeting updated.');
      } else {
        await api.post('/meetings', values);
        message.success('Meeting created.');
      }
      setModalOpen(false);
      setEditing(null);
      await load();
    } catch (error) {
      message.error(error.response?.data?.message || 'Unable to save the meeting.');
    } finally {
      setSaving(false);
    }
  };

  const endMeeting = (meeting) => {
    Modal.confirm({
      title: `End "${meeting.title}"?`,
      content: meeting.activeCount
        ? `${meeting.activeCount} person(s) are in the call and will be disconnected. The recordings and the attendance list are kept.`
        : 'The recordings and the attendance list are kept.',
      okText: 'End meeting',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api.post(`/meetings/${meeting.id}/end`);
          message.success('Meeting ended.');
          await load();
        } catch (error) {
          message.error(error.response?.data?.message || 'Unable to end the meeting.');
        }
      },
    });
  };

  const removeMeeting = (meeting) => {
    Modal.confirm({
      title: `Delete "${meeting.title}"?`,
      content: meeting.recordings?.length
        ? `Its ${meeting.recordings.length} recording(s) and the in-call messages are deleted too. This cannot be undone.`
        : 'The in-call messages are deleted too. This cannot be undone.',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api.delete(`/meetings/${meeting.id}`);
          message.success('Meeting deleted.');
          await load();
        } catch (error) {
          message.error(error.response?.data?.message || 'Unable to delete the meeting.');
        }
      },
    });
  };

  const removeRecording = (meeting, recording) => {
    Modal.confirm({
      title: `Delete "${recording.name}"?`,
      content: `${formatSize(recording.size)} recorded by ${recording.recordedByName || 'someone'}. The file is removed from the server and cannot be recovered.`,
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const { data } = await api.delete(`/meetings/${meeting.id}/recordings/${recording.id}`);
          setRecordingsFor(data.meeting);
          setMeetings((list) => list.map((row) => (row.id === data.meeting.id ? data.meeting : row)));
          message.success('Recording deleted.');
        } catch (error) {
          message.error(error.response?.data?.message || 'Unable to delete that recording.');
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
        title="Meetings"
        subtitle="Video calls between people in this workspace. Audio and video go directly between browsers."
        actions={(
          <>
            <Button className="vision-btn-ghost" icon={<ReloadOutlined />} loading={loading} onClick={load}>
              Refresh
            </Button>
            {canCreate && (
              <Button
                type="primary"
                className="vision-btn-primary"
                icon={<PlusOutlined />}
                onClick={() => { setEditing(null); setModalOpen(true); }}
              >
                New meeting
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
          <strong>Camera and microphone are unavailable on this address.</strong>
          <p className="vision-cell-muted">{support.reason}</p>
        </section>
      )}

      <div className="vision-stat-grid">
        <StatCard tone="green" icon={<VideoCameraOutlined />} label="In progress" value={totals.live} meta={`${totals.inCalls} people in calls`} />
        <StatCard tone="blue" icon={<TeamOutlined />} label="Upcoming" value={totals.upcoming} meta="Scheduled or open" />
        <StatCard tone="violet" icon={<PlayCircleOutlined />} label="Recordings" value={totals.recordings} meta="Saved to meetings" />
        <StatCard tone="amber" icon={<TeamOutlined />} label="Meetings" value={meetings.length} meta="You can see" />
      </div>

      <FilterBar
        actions={(
          <Button className="vision-btn-ghost" onClick={() => { setSearch(''); setStatusFilter('all'); }}>
            Clear
          </Button>
        )}
      >
        <Input.Search
          className="vision-filter-search"
          placeholder="Search by title, host or description"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          allowClear
        />
        <Select
          value={statusFilter}
          onChange={setStatusFilter}
          className="vision-filter-select"
          options={[
            { value: 'all', label: 'All meetings' },
            { value: 'live', label: 'In progress' },
            { value: 'upcoming', label: 'Upcoming' },
            { value: 'ended', label: 'Ended' },
          ]}
        />
      </FilterBar>

      {!visible.length ? (
        <section className="vision-panel">
          <Empty
            description={meetings.length ? 'No meeting matches these filters' : 'No meetings yet'}
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
                  {meeting.live ? 'Live' : (meeting.status === 'ended' ? 'Ended' : 'Scheduled')}
                </StatusBadge>
              </header>

              <p className="meeting-card-desc">{meeting.description || 'No description.'}</p>

              <dl className="meeting-card-facts">
                <div><dt>Host</dt><dd>{meeting.hostName || '—'}</dd></div>
                <div><dt>When</dt><dd>{describeWhen(meeting)}</dd></div>
                <div>
                  <dt>Who</dt>
                  <dd>{meeting.openToAll ? 'Everyone' : `${meeting.inviteeIds.length} invited`}</dd>
                </div>
              </dl>

              {meeting.live && (
                <p className="meeting-card-present">
                  In the call: {meeting.activePeople.map((person) => person.name).join(', ')}
                </p>
              )}

              <footer className="meeting-card-foot">
                <div className="meeting-card-links">
                  <Button type="link" size="small" onClick={() => setAttendance(meeting)}>
                    {meeting.attendedCount} attended
                  </Button>
                  {meeting.recordings.length > 0 && (
                    <Button type="link" size="small" onClick={() => setRecordingsFor(meeting)}>
                      {meeting.recordings.length} recording{meeting.recordings.length === 1 ? '' : 's'}
                    </Button>
                  )}
                </div>

                <div className="vision-row-actions">
                  {meeting.canManage && meeting.status !== 'ended' && (
                    <>
                      <Tooltip title="Edit">
                        <Button
                          size="small"
                          aria-label={`Edit ${meeting.title}`}
                          icon={<EditOutlined />}
                          onClick={() => { setEditing(meeting); setModalOpen(true); }}
                        />
                      </Tooltip>
                      <Tooltip title="End meeting">
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
                    <Tooltip title="Delete">
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
                    <Button
                      type="primary"
                      size="small"
                      className="vision-btn-primary"
                      icon={<VideoCameraOutlined />}
                      onClick={() => setJoined(meeting)}
                    >
                      Join
                    </Button>
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
        title={attendance ? `Who attended "${attendance.title}"` : ''}
        footer={null}
        onCancel={() => setAttendance(null)}
      >
        {!attendance?.participants?.length ? (
          <Empty description="Nobody has joined yet" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <List
            dataSource={attendance.participants}
            renderItem={(row, index) => (
              <List.Item key={`${row.userId}-${index}`}>
                <List.Item.Meta
                  title={row.name || 'Someone'}
                  description={`Joined ${formatMoment(row.joinedAt)}${row.leftAt ? ` · left ${formatMoment(row.leftAt)}` : ' · still in the call'}`}
                />
              </List.Item>
            )}
          />
        )}
      </Modal>

      <Modal
        open={Boolean(recordingsFor)}
        title={recordingsFor ? `Recordings of "${recordingsFor.title}"` : ''}
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
                <a key="open" href={recordingUrl(recording.path)} target="_blank" rel="noreferrer">Open</a>,
                <a key="save" href={recordingUrl(recording.path)} download={recording.name}>Download</a>,
                <Button
                  key="delete"
                  type="link"
                  danger
                  size="small"
                  onClick={() => removeRecording(recordingsFor, recording)}
                >
                  Delete
                </Button>,
              ]}
            >
              <List.Item.Meta
                title={recording.name}
                description={[
                  `Recorded by ${recording.recordedByName || 'someone'}`,
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
