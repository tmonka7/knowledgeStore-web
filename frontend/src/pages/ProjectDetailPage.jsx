import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Empty, Input, Modal, Progress, Select, Tabs, message } from 'antd';
import {
  ArrowLeftOutlined,
  BugOutlined,
  CheckCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  UnorderedListOutlined,
  AppstoreOutlined,
} from '@ant-design/icons';
import api from '../api';
import { can } from '../permissions';
import PageHeader from '../components/ui/PageHeader';
import StatCard from '../components/ui/StatCard';
import StatusBadge from '../components/ui/StatusBadge';
import TaskBoard from '../components/project/TaskBoard';
import TaskDrawer from '../components/project/TaskDrawer';
import TaskFormModal from '../components/project/TaskFormModal';
import TransitionModal from '../components/project/TransitionModal';
import {
  PRIORITY_LABEL,
  PRIORITY_TONE,
  PROJECT_STATUS_LABEL,
  PROJECT_STATUS_TONE,
  STATUS_COLUMNS,
  STATUS_LABEL,
  STATUS_TONE,
  TYPE_LABEL,
  transitionNeeds,
} from '../components/project/workflow';

/**
 * A project and its board.
 *
 * Tasks are held here rather than in each column so a move, a comment and an
 * edit all land in the same place: every write returns the updated task and
 * replaces its copy, which keeps the board, the drawer and the header counts
 * in step without a refetch.
 */
export default function ProjectDetailPage({ user, projectId, members = [], onRefreshMembers, onBack }) {
  const [project, setProject] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [openTaskId, setOpenTaskId] = useState(null);
  const [transition, setTransition] = useState(null);
  const [search, setSearch] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');

  const canCreate = can(user, 'projects', 'create');
  const canEdit = can(user, 'projects', 'edit');
  const canDelete = can(user, 'projects', 'delete');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [projectResponse, taskResponse] = await Promise.all([
        api.get(`/projects/${projectId}`),
        api.get(`/projects/${projectId}/tasks`),
      ]);
      setProject(projectResponse.data.project);
      setTasks(taskResponse.data.tasks || []);
    } catch (error) {
      message.error(error.response?.data?.message || 'Unable to load the project.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const replaceTask = (updated) => {
    setTasks((current) => current.map((task) => (task.id === updated.id ? updated : task)));
  };

  const visibleTasks = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return tasks.filter((task) => {
      if (assigneeFilter === 'unassigned' && task.assigneeId) return false;
      if (assigneeFilter !== 'all' && assigneeFilter !== 'unassigned' && task.assigneeId !== assigneeFilter) return false;
      if (typeFilter !== 'all' && task.type !== typeFilter) return false;
      if (!needle) return true;
      // The description is markup now, so its tags are stripped before
      // matching — otherwise searching for "table" would hit every report
      // that merely contains one.
      const plainDescription = String(task.description || '').replace(/<[^>]+>/g, ' ');
      return [task.key, task.title, plainDescription]
        .some((field) => String(field || '').toLowerCase().includes(needle));
    });
  }, [tasks, search, assigneeFilter, typeFilter]);

  const counts = useMemo(() => tasks.reduce((all, task) => ({
    ...all,
    [task.status]: (all[task.status] || 0) + 1,
  }), {}), [tasks]);

  const doneCount = (counts.verified || 0) + (counts.closed || 0);
  const computedProgress = tasks.length ? Math.round((doneCount / tasks.length) * 100) : 0;
  const progress = project?.isProgressManual ? project.progressOverride : computedProgress;

  const openTask = tasks.find((task) => task.id === openTaskId) || null;

  const saveTask = async (values) => {
    setSaving(true);
    try {
      if (editingTask) {
        const { data } = await api.put(`/projects/${projectId}/tasks/${editingTask.id}`, values);
        replaceTask(data.task);
        message.success('Task updated.');
      } else {
        const { data } = await api.post(`/projects/${projectId}/tasks`, values);
        setTasks((current) => [data.task, ...current]);
        message.success(`${data.task.key} created.`);
      }
      setFormOpen(false);
      setEditingTask(null);
    } catch (error) {
      message.error(error.response?.data?.message || 'Unable to save the task.');
    } finally {
      setSaving(false);
    }
  };

  const applyTransition = async (task, payload) => {
    setSaving(true);
    try {
      const { data } = await api.post(`/projects/${projectId}/tasks/${task.id}/transition`, payload);
      replaceTask(data.task);
      message.success(`${task.key} is now ${STATUS_LABEL[payload.status].toLowerCase()}.`);
      setTransition(null);
    } catch (error) {
      // 409 means the board was stale — reload rather than leave it wrong.
      if (error.response?.status === 409) await load();
      message.error(error.response?.data?.message || 'That move was refused.');
    } finally {
      setSaving(false);
    }
  };

  /** A move that needs a resolution or a reason asks for it first. */
  const startTransition = (task, status) => {
    if (transitionNeeds(status)) {
      setTransition({ task, to: status });
      return;
    }
    applyTransition(task, { status });
  };

  const removeTask = (task) => {
    Modal.confirm({
      title: `Delete ${task.key}?`,
      content: 'Its comments and history go with it. This cannot be undone.',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api.delete(`/projects/${projectId}/tasks/${task.id}`);
          setTasks((current) => current.filter((item) => item.id !== task.id));
          setOpenTaskId(null);
          message.success('Task deleted.');
        } catch (error) {
          message.error(error.response?.data?.message || 'Unable to delete the task.');
        }
      },
    });
  };

  // Refreshed on the way in, so an account created since this page loaded can
  // still be assigned the task being written.
  const openTaskForm = (task = null) => {
    onRefreshMembers?.();
    setEditingTask(task);
    setFormOpen(true);
  };

  const addComment = async (body) => {
    try {
      const { data } = await api.post(`/projects/${projectId}/tasks/${openTaskId}/comments`, { body });
      replaceTask(data.task);
      return true;
    } catch (error) {
      message.error(error.response?.data?.message || 'Unable to add that comment.');
      return false;
    }
  };

  if (!project) {
    return (
      <div className="vision-page vision-stack">
        <PageHeader
          title="Project"
          subtitle="Loading…"
          actions={<Button icon={<ArrowLeftOutlined />} onClick={onBack}>Back</Button>}
        />
        {!loading && <section className="vision-panel"><Empty description="Project not found" /></section>}
      </div>
    );
  }

  return (
    <div className="vision-page vision-stack">
      <PageHeader
        title={`${project.key} — ${project.name}`}
        subtitle={project.description || 'Report, resolve and verify work on this project.'}
        actions={(
          <>
            <StatusBadge tone={PROJECT_STATUS_TONE[project.status] || 'grey'}>
              {PROJECT_STATUS_LABEL[project.status]}
            </StatusBadge>
            <Button className="vision-btn-ghost" icon={<ReloadOutlined />} loading={loading} onClick={load}>
              Refresh
            </Button>
            {canCreate && (
              <Button
                type="primary"
                className="vision-btn-primary"
                icon={<PlusOutlined />}
                onClick={() => openTaskForm()}
              >
                New task
              </Button>
            )}
            <Button icon={<ArrowLeftOutlined />} onClick={onBack}>Back</Button>
          </>
        )}
      />

      <div className="vision-stat-grid">
        <StatCard
          tone="blue"
          icon={<AppstoreOutlined />}
          label="Tasks"
          value={tasks.length}
          meta={`${doneCount} verified or closed`}
        />
        <StatCard
          tone={counts.open || counts.reopened ? 'amber' : 'green'}
          icon={<BugOutlined />}
          label="Open"
          value={(counts.open || 0) + (counts.reopened || 0)}
          meta={`${counts.reopened || 0} reopened after verification`}
        />
        <StatCard
          tone={counts.resolved ? 'red' : 'green'}
          icon={<CheckCircleOutlined />}
          label="Awaiting verification"
          value={counts.resolved || 0}
          meta="Resolved, waiting to be checked"
        />
        <StatCard
          tone="violet"
          icon={<CheckCircleOutlined />}
          label="Progress"
          value={`${progress}%`}
          meta={project.isProgressManual ? 'Tracked manually' : 'Counted from the board'}
        />
      </div>

      <section className="vision-panel vision-panel-tight">
        <div className="vision-panel-head">
          <h3 className="vision-section-title">Progress</h3>
          <span className="vision-cell-muted">
            {doneCount} of {tasks.length} done{project.isProgressManual ? ' · progress is set manually' : ''}
          </span>
        </div>
        <Progress percent={progress} strokeColor={project.color} />
        <div className="project-progress-legend">
          {STATUS_COLUMNS.map((column) => (
            <span key={column.key}>
              <StatusBadge tone={column.tone}>{column.label}</StatusBadge>
              <strong>{counts[column.key] || 0}</strong>
            </span>
          ))}
        </div>
      </section>

      <div className="vision-filter-bar">
        <Input.Search
          className="vision-filter-search"
          placeholder="Search tasks by key, title or description"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          allowClear
        />
        <Select
          value={assigneeFilter}
          onChange={setAssigneeFilter}
          className="vision-filter-select"
          options={[
            { value: 'all', label: 'Everyone' },
            { value: 'unassigned', label: 'Unassigned' },
            ...members.map((member) => ({ value: member.id, label: member.fullName })),
          ]}
        />
        <Select
          value={typeFilter}
          onChange={setTypeFilter}
          className="vision-filter-select"
          options={[
            { value: 'all', label: 'All types' },
            { value: 'bug', label: 'Bugs' },
            { value: 'task', label: 'Tasks' },
            { value: 'feature', label: 'Features' },
          ]}
        />
      </div>

      <Tabs
        defaultActiveKey="board"
        items={[
          {
            key: 'board',
            label: <span><AppstoreOutlined /> Board</span>,
            children: (
              <TaskBoard
                tasks={visibleTasks}
                members={members}
                canEdit={canEdit}
                onOpenTask={(task) => setOpenTaskId(task.id)}
                onMove={startTransition}
              />
            ),
          },
          {
            key: 'list',
            label: <span><UnorderedListOutlined /> List</span>,
            children: (
              <section className="vision-panel vision-panel-tight">
                {!visibleTasks.length ? (
                  <Empty description="No tasks match these filters" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                ) : (
                  <div className="vision-table-scroll">
                    <table className="vision-data-table">
                      <thead>
                        <tr>
                          <th>Key</th><th>Title</th><th>Type</th><th>Status</th>
                          <th>Priority</th><th>Assignee</th><th>Due</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleTasks.map((task) => (
                          <tr key={task.id} onClick={() => setOpenTaskId(task.id)} style={{ cursor: 'pointer' }}>
                            <td><span className="task-card-key">{task.key}</span></td>
                            <td>{task.title}</td>
                            <td className="vision-cell-muted">{TYPE_LABEL[task.type]}</td>
                            <td>
                              <StatusBadge tone={STATUS_TONE[task.status] || 'grey'}>
                                {STATUS_LABEL[task.status]}
                              </StatusBadge>
                            </td>
                            <td>
                              <StatusBadge tone={PRIORITY_TONE[task.priority] || 'grey'}>
                                {PRIORITY_LABEL[task.priority]}
                              </StatusBadge>
                            </td>
                            <td className="vision-cell-muted">
                              {members.find((member) => member.id === task.assigneeId)?.fullName || '—'}
                            </td>
                            <td className="vision-cell-muted">{task.dueDate || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            ),
          },
        ]}
      />

      <TaskDrawer
        open={Boolean(openTask)}
        task={openTask}
        members={members}
        projectId={projectId}
        canEdit={canEdit}
        canComment={canCreate}
        canDelete={canDelete}
        onClose={() => setOpenTaskId(null)}
        onEdit={openTaskForm}
        onDelete={removeTask}
        onTransition={startTransition}
        onComment={addComment}
        onAttachmentsChange={replaceTask}
      />

      <TaskFormModal
        open={formOpen}
        task={editingTask}
        members={members}
        projectId={projectId}
        canAttach={canCreate}
        saving={saving}
        onCancel={() => { setFormOpen(false); setEditingTask(null); }}
        onSubmit={saveTask}
        // An upload lands on the task straight away, so the dialog's copy has
        // to be refreshed too, not just the board's.
        onAttachmentsChange={(updated) => { replaceTask(updated); setEditingTask(updated); }}
      />

      <TransitionModal
        open={Boolean(transition)}
        task={transition?.task}
        to={transition?.to}
        saving={saving}
        onCancel={() => setTransition(null)}
        onSubmit={(payload) => applyTransition(transition.task, payload)}
      />
    </div>
  );
}
