import { useState } from 'react';
import { Button, Drawer, Empty, Input, Space, Tooltip, message } from 'antd';
import {
  CheckCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  SendOutlined,
} from '@ant-design/icons';
import StatusBadge from '../ui/StatusBadge';
import TaskAttachments from './TaskAttachments';
import {
  PRIORITY_LABEL,
  PRIORITY_TONE,
  RESOLUTION_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
  TRANSITION_LABEL,
  TYPE_LABEL,
  nextStatuses,
} from './workflow';

const formatMoment = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

const Field = ({ label, children }) => (
  <div className="task-field">
    <span className="task-field-label">{label}</span>
    <div className="task-field-value">{children || <span className="vision-cell-muted">—</span>}</div>
  </div>
);

/**
 * Everything about one card: the report, where it is in the workflow, what was
 * said about it, and the trail of who moved it. The action row offers only the
 * moves the workflow allows from here, which is why there is no free status
 * dropdown anywhere on this page.
 */
export default function TaskDrawer({
  open,
  task,
  members = [],
  projectId,
  canEdit,
  canComment,
  canDelete,
  onClose,
  onEdit,
  onDelete,
  onTransition,
  onComment,
  onAttachmentsChange,
}) {
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);

  if (!task) return null;

  const memberById = new Map(members.map((member) => [member.id, member]));
  const nameOf = (id) => memberById.get(id)?.fullName || '';

  const submitComment = async () => {
    const body = comment.trim();
    if (!body) {
      message.error('Write something first.');
      return;
    }
    setSending(true);
    const ok = await onComment(body);
    setSending(false);
    if (ok) setComment('');
  };

  const timeline = [...(task.activity || [])].sort((a, b) => new Date(b.at) - new Date(a.at));

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={620}
      rootClassName="task-drawer"
      title={(
        <div className="task-drawer-title">
          <span className="task-card-key">{task.key}</span>
          <StatusBadge tone={STATUS_TONE[task.status] || 'grey'}>{STATUS_LABEL[task.status]}</StatusBadge>
        </div>
      )}
      extra={(
        <Space size="small">
          {canEdit && (
            <Tooltip title="Edit">
              <Button
                size="small"
                aria-label={`Edit ${task.key}`}
                icon={<EditOutlined />}
                onClick={() => onEdit(task)}
              />
            </Tooltip>
          )}
          {canDelete && (
            <Tooltip title="Delete">
              <Button
                size="small"
                danger
                aria-label={`Delete ${task.key}`}
                icon={<DeleteOutlined />}
                onClick={() => onDelete(task)}
              />
            </Tooltip>
          )}
        </Space>
      )}
    >
      <h3 className="task-drawer-heading">{task.title}</h3>

      {canEdit && (
        <div className="task-actions">
          {nextStatuses(task.status).map((status) => (
            <Button
              key={status}
              size="small"
              type={status === 'verified' ? 'primary' : 'default'}
              className={status === 'verified' ? 'vision-btn-primary' : undefined}
              danger={status === 'reopened'}
              icon={status === 'verified' ? <CheckCircleOutlined /> : undefined}
              onClick={() => onTransition(task, status)}
            >
              {TRANSITION_LABEL[status] || status}
            </Button>
          ))}
        </div>
      )}

      <div className="task-field-grid">
        <Field label="Type">{TYPE_LABEL[task.type]}</Field>
        <Field label="Priority">
          <StatusBadge tone={PRIORITY_TONE[task.priority] || 'grey'}>{PRIORITY_LABEL[task.priority]}</StatusBadge>
        </Field>
        <Field label="Assignee">{nameOf(task.assigneeId)}</Field>
        <Field label="Reported by">{nameOf(task.reporterId)}</Field>
        <Field label="Due">{task.dueDate}</Field>
        <Field label="Resolution">{RESOLUTION_LABEL[task.resolution] || ''}</Field>
        <Field label="Resolved">
          {task.resolvedAt ? `${nameOf(task.resolvedById) || 'someone'} · ${formatMoment(task.resolvedAt)}` : ''}
        </Field>
        <Field label="Verified">
          {task.verifiedAt ? `${nameOf(task.verifiedById) || 'someone'} · ${formatMoment(task.verifiedAt)}` : ''}
        </Field>
      </div>

      {task.description && (
        <section className="task-section">
          <h4>Description</h4>
          {/* Written in the rich editor, so it is rendered as the markup it is
              — the same treatment a record's content gets on the Data page. */}
          <div
            className="html-content detail-content"
            dangerouslySetInnerHTML={{ __html: task.description }}
          />
        </section>
      )}

      {task.type === 'bug' && (task.stepsToReproduce || task.expectedResult || task.actualResult || task.environment) && (
        <section className="task-section">
          <h4>Bug report</h4>
          {task.stepsToReproduce && (
            <>
              <span className="task-field-label">Steps to reproduce</span>
              <p className="task-text">{task.stepsToReproduce}</p>
            </>
          )}
          <div className="task-field-grid">
            <Field label="Expected">{task.expectedResult}</Field>
            <Field label="Actual">{task.actualResult}</Field>
          </div>
          {task.environment && <Field label="Environment">{task.environment}</Field>}
        </section>
      )}

      <section className="task-section">
        <h4>Attachments {task.attachments?.length ? `(${task.attachments.length})` : ''}</h4>
        <TaskAttachments
          projectId={projectId}
          task={task}
          canUpload={canComment}
          canDelete={canEdit}
          onChange={onAttachmentsChange}
        />
      </section>

      <section className="task-section">
        <h4>Comments {task.comments?.length ? `(${task.comments.length})` : ''}</h4>

        {!task.comments?.length ? (
          <Empty description="Nothing said yet" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <ul className="task-comments">
            {task.comments.map((entry) => (
              <li key={entry.id}>
                <div className="task-comment-head">
                  <strong>{entry.authorName || 'Someone'}</strong>
                  <span className="vision-cell-muted">{formatMoment(entry.createdAt)}</span>
                </div>
                <p className="task-text">{entry.body}</p>
              </li>
            ))}
          </ul>
        )}

        {canComment && (
          <div className="task-comment-composer">
            <Input.TextArea
              rows={2}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder="Add a comment"
            />
            <Button
              type="primary"
              className="vision-btn-primary"
              icon={<SendOutlined />}
              loading={sending}
              onClick={submitComment}
            >
              Comment
            </Button>
          </div>
        )}
      </section>

      <section className="task-section">
        <h4>History</h4>
        <ul className="task-timeline">
          {timeline.map((entry) => (
            <li key={entry.id}>
              <span className="task-timeline-dot" />
              <div>
                <p className="task-timeline-line">
                  <strong>{entry.actorName || 'Someone'}</strong>
                  {entry.action === 'created' && ' reported this'}
                  {entry.action === 'status' && ` moved it ${STATUS_LABEL[entry.from] || entry.from} → ${STATUS_LABEL[entry.to] || entry.to}`}
                  {entry.action === 'assigned' && ` assigned it to ${nameOf(entry.to) || 'nobody'}`}
                  {entry.action === 'attached' && ' attached a file'}
                  {entry.action === 'detached' && ' removed an attachment'}
                </p>
                {entry.note && <p className="task-text is-quiet">{entry.note}</p>}
                <span className="vision-cell-muted">{formatMoment(entry.at)}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </Drawer>
  );
}
