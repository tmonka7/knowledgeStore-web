import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Empty, Form, Input, Modal, Switch, Tooltip, message } from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  NotificationOutlined,
  PlusOutlined,
  PushpinFilled,
  ReloadOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import api from '../api';
import { can } from '../permissions';
import FilterBar from '../components/ui/FilterBar';
import HtmlEditor from '../components/HtmlEditor';
import PageHeader from '../components/ui/PageHeader';
import StatCard from '../components/ui/StatCard';
import StatusBadge from '../components/ui/StatusBadge';

const formatMoment = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

/**
 * Posts — announcements written by administrators, read by everyone.
 *
 * Opening one records the view, which is what makes the notification count
 * fall: the bell counts posts this account has not opened, so reading is the
 * only thing that clears it.
 */
export default function PostsPage({ user, initialPostId = '', onPostOpened, onViewed }) {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [openPost, setOpenPost] = useState(null);
  const [viewersOf, setViewersOf] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingPost, setEditingPost] = useState(null);
  const [search, setSearch] = useState('');
  const [form] = Form.useForm();

  const canCreate = can(user, 'posts', 'create');
  const canEdit = can(user, 'posts', 'edit');
  const canDelete = can(user, 'posts', 'delete');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/posts');
      setPosts(data.posts || []);
    } catch (error) {
      message.error(error.response?.data?.message || 'Unable to load posts.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /**
   * Opening a post is a write, so it is its own request: the list carries the
   * body already, and marking everything read just because the page rendered
   * would make the notification count meaningless.
   */
  const open = useCallback(async (post) => {
    setOpenPost(post);
    if (post.viewedByMe) return;

    try {
      const { data } = await api.post(`/posts/${post.id}/view`);
      setOpenPost(data.post);
      setPosts((current) => current.map((item) => (item.id === data.post.id ? data.post : item)));
      // The bell is counting the same thing, so it is told to recount.
      onViewed?.();
    } catch (error) {
      /* Failing to record the view must not stop it being read. */
    }
  }, [onViewed]);

  // A post chosen from the notification menu opens once the list has arrived.
  useEffect(() => {
    if (!initialPostId || !posts.length) return;
    const wanted = posts.find((post) => post.id === initialPostId);
    if (wanted) open(wanted);
    onPostOpened?.();
  }, [initialPostId, posts, open, onPostOpened]);

  const visiblePosts = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return posts;
    return posts.filter((post) => [post.title, post.authorName, post.body]
      .some((field) => String(field || '').toLowerCase().includes(needle)));
  }, [posts, search]);

  const unreadCount = posts.filter((post) => !post.viewedByMe).length;
  const totalViews = posts.reduce((sum, post) => sum + post.viewCount, 0);

  const openForm = (post = null) => {
    setEditingPost(post);
    setFormOpen(true);
    form.setFieldsValue(post
      ? { title: post.title, body: post.body, pinned: post.pinned }
      : { title: '', body: '', pinned: false });
  };

  const savePost = async (values) => {
    setSaving(true);
    try {
      if (editingPost) {
        await api.put(`/posts/${editingPost.id}`, values);
        message.success('Post updated.');
      } else {
        await api.post('/posts', values);
        message.success('Post published.');
      }
      setFormOpen(false);
      setEditingPost(null);
      form.resetFields();
      await load();
    } catch (error) {
      message.error(error.response?.data?.message || 'Unable to save the post.');
    } finally {
      setSaving(false);
    }
  };

  const removePost = (post) => {
    Modal.confirm({
      title: `Delete "${post.title}"?`,
      content: 'The post and its record of who read it are deleted. This cannot be undone.',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api.delete(`/posts/${post.id}`);
          message.success('Post deleted.');
          if (openPost?.id === post.id) setOpenPost(null);
          await load();
        } catch (error) {
          message.error(error.response?.data?.message || 'Unable to delete the post.');
        }
      },
    });
  };

  return (
    <div className="vision-page vision-stack">
      <PageHeader
        title="Posts"
        subtitle="Announcements for everyone on this installation, and who has read them."
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
                onClick={() => openForm()}
              >
                New post
              </Button>
            )}
          </>
        )}
      />

      <div className="vision-stat-grid">
        <StatCard
          tone="blue"
          icon={<NotificationOutlined />}
          label="Posts"
          value={posts.length}
          meta={posts.filter((post) => post.pinned).length ? `${posts.filter((post) => post.pinned).length} pinned` : 'None pinned'}
        />
        <StatCard
          tone={unreadCount ? 'amber' : 'green'}
          icon={<EyeOutlined />}
          label="Unread by you"
          value={unreadCount}
          meta={unreadCount ? 'Open one to clear it' : 'You are up to date'}
        />
        <StatCard
          tone="violet"
          icon={<TeamOutlined />}
          label="Total reads"
          value={totalViews}
          meta="Across every post"
        />
      </div>

      <FilterBar
        actions={(
          <Button className="vision-btn-ghost" onClick={() => setSearch('')}>Clear</Button>
        )}
      >
        <Input.Search
          className="vision-filter-search"
          placeholder="Search posts by title, author or content"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          allowClear
        />
      </FilterBar>

      {!visiblePosts.length ? (
        <section className="vision-panel">
          <Empty
            description={posts.length ? 'No post matches that' : 'Nothing has been posted yet'}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        </section>
      ) : (
        <section className="vision-panel vision-panel-tight">
          <div className="vision-table-scroll">
            <table className="vision-data-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Author</th>
                  <th>Posted</th>
                  <th>Read by</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visiblePosts.map((post) => (
                  <tr key={post.id} className={post.viewedByMe ? undefined : 'post-row-unread'}>
                    <td>
                      <button type="button" className="post-title-link" onClick={() => open(post)}>
                        {post.pinned && <PushpinFilled className="post-pin" />}
                        {post.title}
                      </button>
                      {!post.viewedByMe && <StatusBadge tone="blue">New</StatusBadge>}
                    </td>
                    <td className="vision-cell-muted">{post.authorName || '—'}</td>
                    <td className="vision-cell-muted">{formatMoment(post.createdAt)}</td>
                    <td>
                      {/* The count is the link: the requirement is to see the
                          number and exactly who, so one leads to the other. */}
                      <Tooltip title="See who has read this">
                        <button
                          type="button"
                          className="post-viewer-count"
                          onClick={() => setViewersOf(post)}
                          aria-label={`See who has read ${post.title}`}
                        >
                          <EyeOutlined /> {post.viewCount}
                        </button>
                      </Tooltip>
                    </td>
                    <td>
                      <div className="vision-row-actions">
                        <Tooltip title="Open">
                          <Button size="small" icon={<EyeOutlined />} aria-label={`Open ${post.title}`} onClick={() => open(post)} />
                        </Tooltip>
                        {canEdit && (
                          <Tooltip title="Edit">
                            <Button size="small" icon={<EditOutlined />} aria-label={`Edit ${post.title}`} onClick={() => openForm(post)} />
                          </Tooltip>
                        )}
                        {canDelete && (
                          <Tooltip title="Delete">
                            <Button size="small" danger icon={<DeleteOutlined />} aria-label={`Delete ${post.title}`} onClick={() => removePost(post)} />
                          </Tooltip>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <Modal
        open={Boolean(openPost)}
        title={openPost?.title}
        onCancel={() => setOpenPost(null)}
        footer={[
          <Button key="viewers" icon={<TeamOutlined />} onClick={() => setViewersOf(openPost)}>
            Read by {openPost?.viewCount || 0}
          </Button>,
          <Button key="close" type="primary" className="vision-btn-primary" onClick={() => setOpenPost(null)}>
            Close
          </Button>,
        ]}
        width={760}
      >
        {openPost && (
          <>
            <p className="vision-cell-muted post-meta">
              {openPost.authorName || 'Someone'} · {formatMoment(openPost.createdAt)}
              {openPost.updatedAt && openPost.updatedAt !== openPost.createdAt
                ? ` · edited ${formatMoment(openPost.updatedAt)}`
                : ''}
            </p>
            {/* Written in the rich editor, so it is rendered as the markup it
                is — the same treatment a record's content gets. */}
            <div className="html-content detail-content" dangerouslySetInnerHTML={{ __html: openPost.body }} />
          </>
        )}
      </Modal>

      <Modal
        open={Boolean(viewersOf)}
        title={viewersOf ? `Read by ${viewersOf.viewCount} · ${viewersOf.title}` : ''}
        onCancel={() => setViewersOf(null)}
        footer={[<Button key="close" onClick={() => setViewersOf(null)}>Close</Button>]}
        width={520}
      >
        {!viewersOf?.viewers?.length ? (
          <Empty description="Nobody has opened this yet" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <ul className="post-viewer-list">
            {viewersOf.viewers.map((viewer) => (
              <li key={viewer.userId}>
                <span className="post-viewer-name">{viewer.userName || 'Unknown'}</span>
                <span className="vision-cell-muted">{formatMoment(viewer.viewedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Modal>

      {/* forceRender so the Form is mounted before the dialog is first opened:
          openForm fills it with setFieldsValue, and a form that does not exist
          yet silently drops those values — which is exactly how the camera
          edit dialog came to open empty. */}
      <Modal
        open={formOpen}
        title={editingPost ? 'Edit post' : 'New post'}
        okText={editingPost ? 'Save changes' : 'Publish'}
        confirmLoading={saving}
        onCancel={() => { setFormOpen(false); setEditingPost(null); form.resetFields(); }}
        onOk={async () => {
          const values = await form.validateFields().catch(() => null);
          if (values) savePost(values);
        }}
        width={760}
        forceRender
      >
        <Form form={form} layout="vertical">
          <Form.Item name="title" label="Title" rules={[{ required: true, message: 'A post needs a title.' }]}>
            <Input placeholder="Maintenance window this Saturday" maxLength={160} />
          </Form.Item>
          <Form.Item name="body" label="Content" rules={[{ required: true, message: 'A post needs some content.' }]}>
            <HtmlEditor />
          </Form.Item>
          <Form.Item name="pinned" label="Pin to the top" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
