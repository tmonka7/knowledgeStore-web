import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Empty, Input, Modal, Progress, Select, Tooltip, message } from 'antd';
import {
  BugOutlined,
  CheckCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ProjectOutlined,
  ReloadOutlined,
  RightOutlined,
} from '@ant-design/icons';
import api from '../api';
import { can } from '../permissions';
import FilterBar from '../components/ui/FilterBar';
import PageHeader from '../components/ui/PageHeader';
import StatCard from '../components/ui/StatCard';
import StatusBadge from '../components/ui/StatusBadge';
import ProjectFormModal from '../components/project/ProjectFormModal';
import ProjectDetailPage from './ProjectDetailPage';
import {
  PROJECT_STATUSES,
  PROJECT_STATUS_LABEL,
  PROJECT_STATUS_TONE,
} from '../components/project/workflow';

const formatDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString(undefined, { dateStyle: 'medium' });
};

/**
 * Project Management.
 *
 * The list owns the data; opening a project swaps in the detail page rather
 * than routing, which is how Cameras already works in this app.
 */
export default function ProjectsPage({ user }) {
  const [projects, setProjects] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState(null);
  const [openProjectId, setOpenProjectId] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const canCreate = can(user, 'projects', 'create');
  const canEdit = can(user, 'projects', 'edit');
  const canDelete = can(user, 'projects', 'delete');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/projects');
      setProjects(data.projects || []);
    } catch (error) {
      message.error(error.response?.data?.message || 'Unable to load projects.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    api.get('/projects/members')
      .then(({ data }) => setMembers(data.users || []))
      .catch(() => { /* The picker degrades to empty; the rest still works. */ });
  }, []);

  const visibleProjects = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return projects.filter((project) => {
      if (statusFilter !== 'all' && project.status !== statusFilter) return false;
      if (!needle) return true;
      return [project.name, project.key, project.description]
        .some((field) => String(field || '').toLowerCase().includes(needle));
    });
  }, [projects, search, statusFilter]);

  const totals = useMemo(() => projects.reduce((sum, project) => ({
    active: sum.active + (project.status === 'active' ? 1 : 0),
    tasks: sum.tasks + (project.taskTotal || 0),
    openBugs: sum.openBugs + (project.taskCounts?.open || 0) + (project.taskCounts?.reopened || 0),
    awaitingVerification: sum.awaitingVerification + (project.taskCounts?.resolved || 0),
  }), { active: 0, tasks: 0, openBugs: 0, awaitingVerification: 0 }), [projects]);

  const saveProject = async (values) => {
    setSaving(true);
    try {
      if (editingProject) {
        await api.put(`/projects/${editingProject.id}`, values);
        message.success('Project updated.');
      } else {
        await api.post('/projects', values);
        message.success('Project created.');
      }
      setModalOpen(false);
      setEditingProject(null);
      await load();
    } catch (error) {
      message.error(error.response?.data?.message || 'Unable to save the project.');
    } finally {
      setSaving(false);
    }
  };

  const removeProject = (project) => {
    Modal.confirm({
      title: `Delete ${project.key} — ${project.name}?`,
      content: project.taskTotal
        ? `Its ${project.taskTotal} task(s), with every comment and the whole history, are deleted too. This cannot be undone.`
        : 'This cannot be undone.',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api.delete(`/projects/${project.id}`);
          message.success('Project deleted.');
          await load();
        } catch (error) {
          message.error(error.response?.data?.message || 'Unable to delete the project.');
        }
      },
    });
  };

  if (openProjectId) {
    return (
      <ProjectDetailPage
        user={user}
        projectId={openProjectId}
        members={members}
        onBack={() => { setOpenProjectId(null); load(); }}
      />
    );
  }

  return (
    <div className="vision-page vision-stack">
      <PageHeader
        title="Project Management"
        subtitle="Track projects and work their bugs through report, resolution and verification."
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
                onClick={() => { setEditingProject(null); setModalOpen(true); }}
              >
                New project
              </Button>
            )}
          </>
        )}
      />

      <div className="vision-stat-grid">
        <StatCard
          tone="blue"
          icon={<ProjectOutlined />}
          label="Projects"
          value={projects.length}
          meta={`${totals.active} active`}
        />
        <StatCard
          tone="violet"
          icon={<CheckCircleOutlined />}
          label="Tasks"
          value={totals.tasks}
          meta="Across every project you can see"
        />
        <StatCard
          tone={totals.openBugs ? 'amber' : 'green'}
          icon={<BugOutlined />}
          label="Open"
          value={totals.openBugs}
          meta="Reported or reopened"
        />
        <StatCard
          tone={totals.awaitingVerification ? 'red' : 'green'}
          icon={<CheckCircleOutlined />}
          label="Awaiting verification"
          value={totals.awaitingVerification}
          meta="Resolved, not yet checked"
        />
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
          placeholder="Search by name, key or description"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          allowClear
        />
        <Select
          value={statusFilter}
          onChange={setStatusFilter}
          className="vision-filter-select"
          options={[
            { value: 'all', label: 'All statuses' },
            ...PROJECT_STATUSES.map((item) => ({ value: item.value, label: item.label })),
          ]}
        />
      </FilterBar>

      {!visibleProjects.length ? (
        <section className="vision-panel">
          <Empty
            description={projects.length ? 'No project matches these filters' : 'No projects yet'}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        </section>
      ) : (
        <div className="project-grid">
          {visibleProjects.map((project) => (
            <article key={project.id} className="project-card">
              <span className="project-card-accent" style={{ background: project.color }} />

              <header className="project-card-head">
                <div className="project-card-title">
                  <span className="project-card-key" style={{ color: project.color }}>{project.key}</span>
                  <h3>{project.name}</h3>
                </div>
                <StatusBadge tone={PROJECT_STATUS_TONE[project.status] || 'grey'}>
                  {PROJECT_STATUS_LABEL[project.status] || project.status}
                </StatusBadge>
              </header>

              <p className="project-card-desc">{project.description || 'No description yet.'}</p>

              <div className="project-card-progress">
                <div className="project-card-progress-head">
                  <span className="vision-cell-muted">
                    {project.isProgressManual ? 'Progress (manual)' : 'Progress'}
                  </span>
                  <strong>{project.progress}%</strong>
                </div>
                <Progress
                  percent={project.progress}
                  showInfo={false}
                  strokeColor={project.color}
                  size="small"
                />
                <span className="vision-cell-muted">
                  {project.taskDone} of {project.taskTotal} task{project.taskTotal === 1 ? '' : 's'} done
                </span>
              </div>

              <ul className="project-card-counts">
                <li><span>Open</span><strong>{project.taskCounts?.open || 0}</strong></li>
                <li><span>In progress</span><strong>{project.taskCounts?.in_progress || 0}</strong></li>
                <li><span>To verify</span><strong>{project.taskCounts?.resolved || 0}</strong></li>
                <li><span>Reopened</span><strong>{project.taskCounts?.reopened || 0}</strong></li>
              </ul>

              <footer className="project-card-foot">
                <span className="vision-cell-muted">Due {formatDate(project.dueDate)}</span>
                <div className="vision-row-actions">
                  {canEdit && (
                    <Tooltip title="Edit">
                      <Button
                        size="small"
                        icon={<EditOutlined />}
                        onClick={() => { setEditingProject(project); setModalOpen(true); }}
                      />
                    </Tooltip>
                  )}
                  {canDelete && (
                    <Tooltip title="Delete">
                      <Button size="small" danger icon={<DeleteOutlined />} onClick={() => removeProject(project)} />
                    </Tooltip>
                  )}
                  <Button
                    size="small"
                    type="primary"
                    className="vision-btn-primary"
                    onClick={() => setOpenProjectId(project.id)}
                  >
                    Open <RightOutlined />
                  </Button>
                </div>
              </footer>
            </article>
          ))}
        </div>
      )}

      <ProjectFormModal
        open={modalOpen}
        project={editingProject}
        members={members}
        saving={saving}
        onCancel={() => { setModalOpen(false); setEditingProject(null); }}
        onSubmit={saveProject}
      />
    </div>
  );
}
