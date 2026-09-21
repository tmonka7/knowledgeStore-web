import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Badge, Button, Calendar, Card, DatePicker, Empty, Form, Input, Modal,
  Popconfirm, Radio, Select, Space, Tag, TimePicker, Typography, message,
} from 'antd';
import {
  BellOutlined, DeleteOutlined, EditOutlined, LeftOutlined, PlusOutlined, RightOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../api';
import { localDateKey } from '../components/schedule/useScheduleReminders';

const { Text, Title } = Typography;

const DATE_FORMAT = 'YYYY-MM-DD';
const TIME_FORMAT = 'HH:mm';

const REPEAT_OPTIONS = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekly', label: 'Every week' },
  { value: 'monthly', label: 'Every month' },
];

const REPEAT_LABEL = {
  none: '', daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly',
};

/** The date window a view covers. Day and week both render as lists. */
const rangeFor = (mode, anchor) => {
  if (mode === 'day') return [anchor.format(DATE_FORMAT), anchor.format(DATE_FORMAT)];
  if (mode === 'week') {
    // startOf('week') is locale-dependent; fixing on Monday keeps the header,
    // the grid and the query in agreement whatever the browser locale is.
    const monday = anchor.subtract((anchor.day() + 6) % 7, 'day');
    return [monday.format(DATE_FORMAT), monday.add(6, 'day').format(DATE_FORMAT)];
  }
  return [
    anchor.startOf('month').format(DATE_FORMAT),
    anchor.endOf('month').format(DATE_FORMAT),
  ];
};

const stepFor = (mode) => (mode === 'day' ? 'day' : mode === 'week' ? 'week' : 'month');

/** One occurrence row, shared by the day and week views. */
function OccurrenceRow({ occurrence, schedule, onEdit, onDelete }) {
  return (
    <div className="schedule-item">
      <span className="schedule-item-time">{occurrence.time}</span>
      <div className="schedule-item-body">
        <div className="schedule-item-title">{occurrence.title}</div>
        {occurrence.notes && <div className="schedule-item-notes">{occurrence.notes}</div>}
      </div>
      {REPEAT_LABEL[occurrence.repeat] && (
        <Tag color="blue">{REPEAT_LABEL[occurrence.repeat]}</Tag>
      )}
      <Space size={4}>
        <Button type="text" size="small" icon={<EditOutlined />} onClick={() => onEdit(schedule)} aria-label={`Edit ${occurrence.title}`} />
        <Popconfirm title="Delete this schedule?" onConfirm={() => onDelete(occurrence.scheduleId)} okText="Delete" okButtonProps={{ danger: true }}>
          <Button type="text" size="small" danger icon={<DeleteOutlined />} aria-label={`Delete ${occurrence.title}`} />
        </Popconfirm>
      </Space>
    </div>
  );
}

export default function SchedulePage({ reminders = [], notificationPermission, onRequestNotifications }) {
  const [mode, setMode] = useState('month');
  const [anchor, setAnchor] = useState(() => dayjs());
  const [schedules, setSchedules] = useState([]);
  const [occurrences, setOccurrences] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // schedule being edited, or {} for new
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const [from, to] = useMemo(() => rangeFor(mode, anchor), [mode, anchor]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/schedules', { params: { from, to } });
      setSchedules(data.schedules || []);
      setOccurrences(data.occurrences || []);
    } catch (caught) {
      setError(caught?.response?.data?.message || 'Schedules could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  const scheduleById = useMemo(
    () => new Map(schedules.map((item) => [item.id, item])),
    [schedules],
  );

  const byDate = useMemo(() => {
    const grouped = new Map();
    for (const occurrence of occurrences) {
      if (!grouped.has(occurrence.date)) grouped.set(occurrence.date, []);
      grouped.get(occurrence.date).push(occurrence);
    }
    return grouped;
  }, [occurrences]);

  const openNew = (date) => {
    setEditing({});
    form.setFieldsValue({
      title: '',
      notes: '',
      date: date ? dayjs(date) : anchor,
      time: dayjs('09:00', TIME_FORMAT),
      repeat: 'none',
      repeatUntil: null,
    });
  };

  const openEdit = (schedule) => {
    if (!schedule) return;
    setEditing(schedule);
    form.setFieldsValue({
      title: schedule.title,
      notes: schedule.notes,
      date: dayjs(schedule.date),
      time: dayjs(schedule.time, TIME_FORMAT),
      repeat: schedule.repeat,
      repeatUntil: schedule.repeatUntil ? dayjs(schedule.repeatUntil) : null,
    });
  };

  const save = async (values) => {
    setSaving(true);
    try {
      const payload = {
        title: values.title,
        notes: values.notes || '',
        date: values.date.format(DATE_FORMAT),
        time: values.time.format(TIME_FORMAT),
        repeat: values.repeat,
        repeatUntil: values.repeat === 'none' || !values.repeatUntil
          ? null
          : values.repeatUntil.format(DATE_FORMAT),
      };

      if (editing?.id) {
        await api.put(`/schedules/${editing.id}`, payload);
        message.success('Schedule updated.');
      } else {
        await api.post('/schedules', payload);
        message.success('Schedule created.');
      }

      setEditing(null);
      await load();
    } catch (caught) {
      message.error(caught?.response?.data?.message || 'The schedule could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    try {
      await api.delete(`/schedules/${id}`);
      message.success('Schedule deleted.');
      await load();
    } catch (caught) {
      message.error(caught?.response?.data?.message || 'The schedule could not be deleted.');
    }
  };

  const headingFor = () => {
    if (mode === 'day') return anchor.format('dddd, D MMMM YYYY');
    if (mode === 'week') return `${dayjs(from).format('D MMM')} – ${dayjs(to).format('D MMM YYYY')}`;
    return anchor.format('MMMM YYYY');
  };

  const repeatMode = Form.useWatch('repeat', form);
  const today = localDateKey();

  return (
    <div className="vision-page vision-stack">
      <div className="vision-page-header">
        <div>
          <h1 className="vision-page-title">Schedule</h1>
          <p className="vision-page-subtitle">
            Plan by day, week or month. Anything due tomorrow is flagged here and in the header bell.
          </p>
        </div>
        <Space>
          {notificationPermission !== 'granted' && notificationPermission !== 'unsupported' && (
            <Button icon={<BellOutlined />} onClick={onRequestNotifications}>
              Enable desktop reminders
            </Button>
          )}
          <Button type="primary" className="vision-btn-primary" icon={<PlusOutlined />} onClick={() => openNew()}>
            New schedule
          </Button>
        </Space>
      </div>

      {reminders.length > 0 && (
        <Alert
          type="info"
          showIcon
          icon={<BellOutlined />}
          className="schedule-reminder-alert"
          message={`${reminders.length} schedule${reminders.length === 1 ? '' : 's'} due tomorrow`}
          description={(
            <ul className="schedule-reminder-list">
              {reminders.map((item) => (
                <li key={`${item.scheduleId}:${item.date}`}>
                  <strong>{item.time}</strong> {item.title}
                </li>
              ))}
            </ul>
          )}
        />
      )}

      {notificationPermission === 'denied' && (
        <Alert
          type="warning"
          showIcon
          message="Desktop reminders are blocked"
          description="This site is blocked from showing notifications, so reminders appear in the app only. Re-allow notifications in your browser's site settings to get desktop alerts."
        />
      )}

      <Card bordered={false} className="schedule-card">
        <div className="schedule-toolbar">
          <Space>
            <Button icon={<LeftOutlined />} onClick={() => setAnchor(anchor.subtract(1, stepFor(mode)))} aria-label="Previous" />
            <Button onClick={() => setAnchor(dayjs())}>Today</Button>
            <Button icon={<RightOutlined />} onClick={() => setAnchor(anchor.add(1, stepFor(mode)))} aria-label="Next" />
            <Title level={4} className="schedule-heading">{headingFor()}</Title>
          </Space>

          <Radio.Group value={mode} onChange={(event) => setMode(event.target.value)} optionType="button" buttonStyle="solid">
            <Radio.Button value="day">Day</Radio.Button>
            <Radio.Button value="week">Week</Radio.Button>
            <Radio.Button value="month">Month</Radio.Button>
          </Radio.Group>
        </div>

        {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}

        {mode === 'month' && (
          <Calendar
            value={anchor}
            onSelect={(value, info) => {
              setAnchor(value);
              // A click on a cell opens a new entry; changing month must not.
              if (info?.source === 'date') openNew(value.format(DATE_FORMAT));
            }}
            cellRender={(value, info) => {
              // cellRender also fires for the month/year panels; only day cells
              // hold occurrences.
              if (info?.type !== 'date') return info?.originNode ?? null;
              const items = byDate.get(value.format(DATE_FORMAT)) || [];
              if (!items.length) return null;
              return (
                <ul className="schedule-cell">
                  {items.slice(0, 3).map((item) => (
                    <li key={`${item.scheduleId}:${item.time}`}>
                      <Badge status="processing" text={`${item.time} ${item.title}`} />
                    </li>
                  ))}
                  {items.length > 3 && <li className="schedule-cell-more">+{items.length - 3} more</li>}
                </ul>
              );
            }}
          />
        )}

        {mode === 'week' && (
          <div className="schedule-week">
            {Array.from({ length: 7 }, (_, offset) => dayjs(from).add(offset, 'day')).map((day) => {
              const key = day.format(DATE_FORMAT);
              const items = byDate.get(key) || [];
              return (
                <div key={key} className={`schedule-week-day${key === today ? ' is-today' : ''}`}>
                  <button type="button" className="schedule-week-head" onClick={() => openNew(key)}>
                    <span className="schedule-week-name">{day.format('ddd')}</span>
                    <span className="schedule-week-date">{day.format('D')}</span>
                  </button>
                  <div className="schedule-week-items">
                    {items.length === 0
                      ? <span className="schedule-week-empty">—</span>
                      : items.map((item) => (
                        <button
                          type="button"
                          key={`${item.scheduleId}:${item.time}`}
                          className="schedule-chip"
                          onClick={() => openEdit(scheduleById.get(item.scheduleId))}
                        >
                          <strong>{item.time}</strong> {item.title}
                        </button>
                      ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {mode === 'day' && (
          <div className="schedule-day">
            {(byDate.get(from) || []).length === 0 ? (
              <Empty
                description={loading ? 'Loading...' : 'Nothing scheduled for this day'}
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              >
                <Button type="primary" className="vision-btn-primary" onClick={() => openNew(from)}>
                  Add one
                </Button>
              </Empty>
            ) : (
              (byDate.get(from) || []).map((item) => (
                <OccurrenceRow
                  key={`${item.scheduleId}:${item.time}`}
                  occurrence={item}
                  schedule={scheduleById.get(item.scheduleId)}
                  onEdit={openEdit}
                  onDelete={remove}
                />
              ))
            )}
          </div>
        )}
      </Card>

      <Modal
        open={Boolean(editing)}
        title={editing?.id ? 'Edit schedule' : 'New schedule'}
        onCancel={() => setEditing(null)}
        onOk={() => form.submit()}
        confirmLoading={saving}
        okText={editing?.id ? 'Save' : 'Create'}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={save} preserve={false}>
          <Form.Item name="title" label="Title" rules={[{ required: true, message: 'A title is required.' }]}>
            <Input placeholder="e.g. Site inspection" />
          </Form.Item>

          <Space style={{ width: '100%' }} size="middle">
            <Form.Item name="date" label="Date" rules={[{ required: true, message: 'Pick a date.' }]}>
              <DatePicker format={DATE_FORMAT} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="time" label="Time" rules={[{ required: true, message: 'Pick a time.' }]}>
              <TimePicker format={TIME_FORMAT} minuteStep={5} style={{ width: '100%' }} />
            </Form.Item>
          </Space>

          <Form.Item name="repeat" label="Repeat">
            <Select options={REPEAT_OPTIONS} />
          </Form.Item>

          {repeatMode && repeatMode !== 'none' && (
            <Form.Item
              name="repeatUntil"
              label="Repeat until"
              extra="Leave empty to repeat indefinitely. A monthly schedule on the 31st skips months that are too short."
            >
              <DatePicker format={DATE_FORMAT} style={{ width: '100%' }} />
            </Form.Item>
          )}

          <Form.Item name="notes" label="Notes">
            <Input.TextArea rows={3} placeholder="Optional details" />
          </Form.Item>

          <Text type="secondary">A reminder appears one day before each occurrence.</Text>
        </Form>
      </Modal>
    </div>
  );
}
