import { useCallback, useEffect, useState } from 'react';
import { Button, Empty, Input, Modal, Select, Table, Tabs, Tag, message } from 'antd';
import {
  DeleteOutlined,
  QuestionCircleFilled,
  ReloadOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import api from '../api';
import { can } from '../permissions';
import PageHeader from '../components/ui/PageHeader';
import StatCard from '../components/ui/StatCard';
import { useLanguage } from '../i18n';

/*
 * Attendance sweeps, and the faces they could not name.
 *
 * Two tabs, because they are two jobs. The sweep list is a record — what
 * happened, when, and how much of the room was actually covered. The faces tab
 * is the part that needs a person: a sweep can tell you somebody was there, it
 * cannot tell you who they are unless they are enrolled, and giving them a
 * name is a decision rather than a computation.
 */
export default function AttendancePage({ user }) {
  const { t } = useLanguage();
  const [sessions, setSessions] = useState([]);
  const [visitors, setVisitors] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [openSession, setOpenSession] = useState(null);
  const [entries, setEntries] = useState([]);

  const canEdit = can(user, 'attendance', 'edit');
  const canDelete = can(user, 'attendance', 'delete');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sessionList, visitorList] = await Promise.all([
        api.get('/attendance/sessions'),
        api.get('/attendance/visitors'),
      ]);
      setSessions(sessionList.data.sessions || []);
      setVisitors(visitorList.data.visitors || []);
    } catch (error) {
      message.error(error.response?.data?.message || t('attendanceLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();

    /*
     * The account list is only needed to offer "this visitor is that person",
     * and reading it needs users:view — a permission somebody who runs
     * attendance sweeps may well not have. So it is fetched separately and a
     * refusal is not an error: the naming box still works, only the link
     * dropdown is absent.
     */
    if (can(user, 'users')) {
      api.get('/users')
        .then(({ data }) => setUsers(data.users || []))
        .catch(() => setUsers([]));
    }
  }, [load, user]);

  const openDetail = async (session) => {
    try {
      const { data } = await api.get(`/attendance/sessions/${session.id}`);
      setOpenSession(data.session);
      setEntries(data.entries || []);
    } catch (error) {
      message.error(error.response?.data?.message || t('attendanceLoadFailed'));
    }
  };

  const saveVisitor = async (visitor, changes) => {
    try {
      const { data } = await api.put(`/attendance/visitors/${visitor.id}`, changes);
      setVisitors((current) => current.map((item) => (item.id === visitor.id ? data.visitor : item)));
      message.success(t('saved'));
    } catch (error) {
      message.error(error.response?.data?.message || t('attendanceSaveFailed'));
    }
  };

  const removeVisitor = (visitor) => {
    Modal.confirm({
      title: t('attendanceForgetFaceQuestion'),
      content: t('attendanceForgetFaceHint'),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api.delete(`/attendance/visitors/${visitor.id}`);
          setVisitors((current) => current.filter((item) => item.id !== visitor.id));
          message.success(t('attendanceFaceForgotten'));
        } catch (error) {
          message.error(error.response?.data?.message || t('attendanceDeleteFailed'));
        }
      },
    });
  };

  const named = visitors.filter((visitor) => visitor.label || visitor.linkedUserId).length;

  const sessionColumns = [
    {
      title: t('date'),
      dataIndex: 'startedAt',
      render: (value) => new Date(value).toLocaleString(),
    },
    { title: t('camera'), dataIndex: 'cameraName' },
    { title: t('startedBy'), dataIndex: 'startedByName' },
    {
      title: t('attendanceRecognised'),
      dataIndex: 'knownCount',
      render: (value) => <Tag color="green">{value}</Tag>,
    },
    {
      title: t('attendanceUnknownFaces'),
      dataIndex: 'visitorCount',
      render: (value) => <Tag color={value ? 'orange' : 'default'}>{value}</Tag>,
    },
    {
      title: t('attendanceCoverage'),
      dataIndex: 'coverageDegrees',
      // A sweep that covered less than it was asked to is flagged here rather
      // than only inside the dialog that is long gone: the shortfall is the
      // single most useful thing to know when a list looks short.
      render: (value, row) => (
        <Tag color={row.completeCoverage ? 'default' : 'orange'}>
          {Math.round(value)}° {row.completeCoverage ? '' : t('attendancePartial')}
        </Tag>
      ),
    },
    {
      title: t('status'),
      dataIndex: 'status',
      render: (value) => <Tag color={value === 'complete' ? 'green' : value === 'running' ? 'blue' : 'red'}>{value}</Tag>,
    },
  ];

  return (
    <div className="vision-page">
      <PageHeader
        title={t('attendanceTitle')}
        subtitle={t('attendanceSubtitle')}
        actions={(
          <Button className="vision-btn-ghost" icon={<ReloadOutlined />} onClick={load} loading={loading}>
            {t('refresh')}
          </Button>
        )}
      />

      <div className="vision-stat-grid">
        <StatCard tone="blue" icon={<TeamOutlined />} label={t('attendanceSweeps')} value={sessions.length} />
        <StatCard
          tone="green"
          icon={<UserOutlined />}
          label={t('attendanceLastRecognised')}
          value={sessions[0]?.knownCount ?? 0}
          meta={sessions[0] ? new Date(sessions[0].startedAt).toLocaleDateString() : ''}
        />
        <StatCard
          tone="violet"
          icon={<QuestionCircleFilled />}
          label={t('attendanceFacesOnFile')}
          value={visitors.length}
          meta={t('attendanceNamedCount', { count: named })}
        />
      </div>

      <Tabs
        className="vision-tabs"
        items={[
          {
            key: 'sessions',
            label: t('attendanceSweeps'),
            children: (
              <Table
                rowKey="id"
                loading={loading}
                dataSource={sessions}
                columns={sessionColumns}
                onRow={(row) => ({ onClick: () => openDetail(row) })}
                pagination={{ pageSize: 12 }}
              />
            ),
          },
          {
            key: 'visitors',
            label: t('attendanceFacesOnFile'),
            children: visitors.length ? (
              <div className="attendance-visitor-grid">
                {visitors.map((visitor) => (
                  <div key={visitor.id} className="attendance-visitor">
                    {visitor.faceImage
                      ? <img src={visitor.faceImage} alt={visitor.label || t('attendanceUnknownPerson')} />
                      : <span className="attendance-person-blank"><QuestionCircleFilled /></span>}

                    <Input
                      size="small"
                      disabled={!canEdit}
                      defaultValue={visitor.label}
                      placeholder={t('attendanceNamePlaceholder')}
                      onBlur={(event) => {
                        const label = event.target.value.trim();
                        if (label !== (visitor.label || '')) saveVisitor(visitor, { label });
                      }}
                    />

                    {users.length > 0 && (
                      <Select
                        size="small"
                        allowClear
                        showSearch
                        disabled={!canEdit}
                        value={visitor.linkedUserId || undefined}
                        placeholder={t('attendanceLinkToUser')}
                        optionFilterProp="label"
                        options={users.map((account) => ({
                          value: account.id,
                          label: account.fullName || account.username,
                        }))}
                        onChange={(value) => saveVisitor(visitor, { linkedUserId: value || null })}
                      />
                    )}

                    <small>
                      {t('attendanceSeenTimes', { count: visitor.seenCount })}
                      {' · '}
                      {new Date(visitor.lastSeenAt).toLocaleDateString()}
                    </small>

                    {canDelete && (
                      <Button
                        size="small"
                        danger
                        type="text"
                        icon={<DeleteOutlined />}
                        onClick={() => removeVisitor(visitor)}
                      >
                        {t('attendanceForget')}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            ) : <Empty description={t('attendanceNoFaces')} />,
          },
        ]}
      />

      <Modal
        open={Boolean(openSession)}
        onCancel={() => setOpenSession(null)}
        footer={null}
        width={760}
        title={openSession ? t('attendanceSweepAt', {
          camera: openSession.cameraName,
          when: new Date(openSession.startedAt).toLocaleString(),
        }) : ''}
      >
        {entries.length ? (
          <div className="attendance-people">
            {entries.map((entry) => (
              <div key={entry.id} className={`attendance-person is-${entry.subjectType}`}>
                {entry.faceImage
                  ? <img src={entry.faceImage} alt={entry.name || t('attendanceUnknownPerson')} />
                  : <span className="attendance-person-blank"><QuestionCircleFilled /></span>}
                <strong>{entry.name || t('attendanceUnknownPerson')}</strong>
                <small>{t('attendanceSeenTimes', { count: entry.sightings })}</small>
              </div>
            ))}
          </div>
        ) : <Empty description={t('attendanceNobodyFound')} />}
      </Modal>
    </div>
  );
}
