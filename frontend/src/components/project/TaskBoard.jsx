import { useState } from 'react';
import { Empty, Tooltip } from 'antd';
import {
  BugOutlined,
  BulbOutlined,
  CheckSquareOutlined,
  MessageOutlined,
  PaperClipOutlined,
} from '@ant-design/icons';
import StatusBadge from '../ui/StatusBadge';
import {
  PRIORITY_LABEL,
  PRIORITY_TONE,
  STATUS_COLUMNS,
  canTransition,
} from './workflow';

const TYPE_ICON = {
  bug: <BugOutlined />,
  task: <CheckSquareOutlined />,
  feature: <BulbOutlined />,
};

const initials = (name = '') => name
  .split(' ')
  .filter(Boolean)
  .slice(0, 2)
  .map((part) => part[0].toUpperCase())
  .join('') || '?';

function TaskCard({ task, assignee, onOpen, onDragStart, onDragEnd, draggable }) {
  return (
    <article
      className={`task-card is-${task.type}`}
      draggable={draggable}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        // Some browsers refuse to start a drag without payload on the event.
        event.dataTransfer.setData('text/plain', task.id);
        onDragStart(task);
      }}
      onDragEnd={onDragEnd}
      onClick={() => onOpen(task)}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen(task);
        }
      }}
    >
      <header className="task-card-head">
        <span className="task-card-key">
          <span className="task-card-type">{TYPE_ICON[task.type]}</span>
          {task.key}
        </span>
        <StatusBadge tone={PRIORITY_TONE[task.priority] || 'grey'}>{PRIORITY_LABEL[task.priority]}</StatusBadge>
      </header>

      <p className="task-card-title">{task.title}</p>

      {task.tags?.length > 0 && (
        <div className="task-card-tags">
          {task.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="vision-badge is-grey">{tag}</span>
          ))}
        </div>
      )}

      <footer className="task-card-foot">
        <div className="task-card-meta">
          {task.comments?.length > 0 && (
            <span className="task-card-count"><MessageOutlined /> {task.comments.length}</span>
          )}
          {task.attachments?.length > 0 && (
            <span className="task-card-count"><PaperClipOutlined /> {task.attachments.length}</span>
          )}
          {task.reopenCount > 0 && (
            <Tooltip title={`Sent back ${task.reopenCount} time(s)`}>
              <span className="task-card-count is-warn">↺ {task.reopenCount}</span>
            </Tooltip>
          )}
          {task.dueDate && <span className="task-card-count">{task.dueDate}</span>}
        </div>
        <Tooltip title={assignee ? assignee.fullName : 'Unassigned'}>
          <span className={`task-card-avatar${assignee ? '' : ' is-empty'}`}>
            {assignee ? initials(assignee.fullName) : '–'}
          </span>
        </Tooltip>
      </footer>
    </article>
  );
}

/**
 * The board.
 *
 * Dragging is gated by the same transition table the API enforces: while a
 * card is held, columns it cannot legally reach stop accepting the drop and
 * dim, so the workflow is visible rather than discovered through an error.
 */
export default function TaskBoard({ tasks, members = [], canEdit, onOpenTask, onMove }) {
  const [draggingTask, setDraggingTask] = useState(null);
  const [hoverColumn, setHoverColumn] = useState('');

  const memberById = new Map(members.map((member) => [member.id, member]));

  const columnTasks = (status) => tasks
    .filter((task) => task.status === status)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  return (
    <div className="task-board">
      {STATUS_COLUMNS.map((column) => {
        const items = columnTasks(column.key);
        const isTarget = Boolean(draggingTask) && draggingTask.status !== column.key;
        const accepts = isTarget && canTransition(draggingTask.status, column.key);
        const blocked = isTarget && !accepts;

        return (
          <section
            key={column.key}
            className={[
              'task-column',
              accepts && 'is-target',
              blocked && 'is-blocked',
              hoverColumn === column.key && accepts && 'is-over',
            ].filter(Boolean).join(' ')}
            onDragOver={(event) => {
              if (!accepts) return;
              // Without preventDefault the browser refuses the drop outright.
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              setHoverColumn(column.key);
            }}
            onDragLeave={() => setHoverColumn((current) => (current === column.key ? '' : current))}
            onDrop={(event) => {
              event.preventDefault();
              setHoverColumn('');
              if (accepts && draggingTask) onMove(draggingTask, column.key);
              setDraggingTask(null);
            }}
          >
            <header className="task-column-head">
              <div className="task-column-title">
                <StatusBadge tone={column.tone} dot={column.key === 'in_progress'}>{column.label}</StatusBadge>
                <span className="task-column-count">{items.length}</span>
              </div>
              <p className="task-column-hint">{column.hint}</p>
            </header>

            <div className="task-column-body">
              {items.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  assignee={memberById.get(task.assigneeId)}
                  draggable={canEdit}
                  onOpen={onOpenTask}
                  onDragStart={setDraggingTask}
                  onDragEnd={() => { setDraggingTask(null); setHoverColumn(''); }}
                />
              ))}

              {!items.length && (
                <Empty
                  className="task-column-empty"
                  description={blocked ? 'Not from here' : 'Nothing here'}
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
