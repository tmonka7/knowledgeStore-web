import {
  Button,
  Card,
  Col,
  Form,
  Input,
  Modal,
  Row,
  Space,
  Tag,
  TreeSelect,
  Typography,
  message,
} from 'antd';
import {
  AppstoreOutlined,
  BarChartOutlined,
  CalendarOutlined,
  CopyOutlined,
  DatabaseOutlined,
  CameraOutlined,
  CloudServerOutlined,
  DashboardOutlined,
  MailOutlined,
  MessageOutlined,
  NotificationOutlined,
  PaperClipOutlined,
  ProjectOutlined,
  ShareAltOutlined,
  TeamOutlined,
  ToolOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { asBlob } from 'html-docx-js-typescript';
import { useCallback, useEffect, useState } from 'react';
import api from '../api';
import AppLayout from '../components/AppLayout';
import HtmlEditor from '../components/HtmlEditor';
import ShareWithField, { describeSharing } from '../components/records/ShareWithField';
import { can } from '../permissions';
import OverviewPage from './OverviewPage';
import RecordsPage from './RecordsPage';
import CategoriesPage from './CategoriesPage';
import UsersPage from './UsersPage';
import SystemMonitorPage from './SystemMonitorPage';
import ChatPage from './ChatPage';
import MailPage from './MailPage';
import { useLanguage } from '../i18n';
import CamerasPage from './CamerasPage';
import SchedulePage from './SchedulePage';
import useScheduleReminders from '../components/schedule/useScheduleReminders';
import LvglToolPage from './LvglToolPage';
import ConvertToolPage from './ConvertToolPage';
import YoloToolPage from './YoloToolPage';
import TransformersToolPage from './TransformersToolPage';
import KerasToolPage from './KerasToolPage';
import MyPage from './MyPage';
import PostsPage from './PostsPage';
import MeetingsPage from './MeetingsPage';
import DatabasePage from './DatabasePage';
import ProjectsPage from './ProjectsPage';

const { Title, Text } = Typography;

const copyHtmlWithStyles = (htmlContent, t) => {
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = htmlContent;

  const html = tempDiv.innerHTML;
  const blob = new Blob([html], { type: 'text/html' });
  const data = [new ClipboardItem({ 'text/html': blob })];

  navigator.clipboard.write(data).then(() => {
    message.success(t('contentCopiedWithStyles'));
  }).catch(() => {
    const plainText = tempDiv.innerText;
    navigator.clipboard.writeText(plainText).then(() => {
      message.success(t('contentCopied'));
    });
  });
};

const getApiOrigin = () => {
  return (import.meta.env.VITE_API_URL || 'http://127.0.0.1:4000/api').replace(/\/api$/, '');
};

const resolveAttachmentUrl = (attachment) => {
  if (!attachment) return '';
  if (/^https?:\/\//i.test(attachment)) return attachment;
  const apiOrigin = getApiOrigin();
  return `${apiOrigin}${attachment.startsWith('/') ? '' : '/'}${attachment}`;
};

const categoryTreeData = (items = []) => items.map((item) => ({
  title: item.name,
  value: item.id,
  key: item.id,
  children: categoryTreeData(item.children || []),
}));

export default function DashboardPage({
  user,
  users,
  records,
  categories,
  cameras,
  setCameras,
  activeKey,
  setActiveKey,
  logout,
  selectedRecord,
  setSelectedRecord,
  editingRecord,
  setEditingRecord,
  overviewChartData,
  systemStatus,
  handleDeleteRecord,
  handleDeleteRecords,
  recordForm,
  addForm,
  categoryForm,
  handleSaveRecord,
  handleUpdateRecord,
  handleEditRecord,
  handleCreateCategory,
  handleDeleteCategory,
  handleUpdatePassword,
  handleUpdateProfile,
  handleUpdateUser,
  handleSetUserStatus,
  handleDeleteUser,
  onRefreshUsers,
  permissionCatalog,
  directory = [],
  loading,
  isAddModalOpen,
  setIsAddModalOpen,
  userTableColumns,
  attachmentName,
  setAttachmentName,
  searchText,
  categoryFilter,
  searchMode,
  dateSearchEnabled,
  searchDateFrom,
  searchDateTo,
  onDateSearchEnabledChange,
  onSearchDateFromChange,
  onSearchDateToChange,
  onSearchRecords,
  onSearchInputChange,
  onCategoryFilterChange,
  onAiSearch,
}) {
  const { t } = useLanguage();

  // Polls for anything due tomorrow. Gated on the permission so a user without
  // Schedule access never triggers the request (the API would 403 anyway).
  const canUseSchedule = can(user, 'schedule');
  const { reminders, permission, requestPermission } = useScheduleReminders({ enabled: canUseSchedule });

  // Unread direct messages and the newest few, so both the sidebar count and
  // the header's message menu work from anywhere in the app rather than only
  // once Chat is already open. One request serves both.
  const [chatUnread, setChatUnread] = useState(0);
  const [recentMessages, setRecentMessages] = useState([]);
  // The conversation the header asked Chat to open, if any.
  const [chatThreadId, setChatThreadId] = useState('');
  const canUseChat = can(user, 'chat');

  useEffect(() => {
    if (!canUseChat) return undefined;

    let cancelled = false;
    const checkMessages = async () => {
      try {
        const { data } = await api.get('/chat/recent', { params: { limit: 5 } });
        if (cancelled) return;
        setChatUnread(data.unread || 0);
        setRecentMessages(data.messages || []);
      } catch (error) {
        /* The badge is a nicety; a failed poll should not raise anything. */
      }
    };

    checkMessages();
    const timer = setInterval(checkMessages, 15000);
    return () => { cancelled = true; clearInterval(timer); };
  // Re-checked when the page changes, so opening Chat clears it promptly.
  }, [canUseChat, activeKey]);

  /*
   * Posts nobody has read yet, for the notification bell.
   *
   * The count is of posts this account has not opened, so it falls as they
   * are read — `refreshPostNotifications` is what the Posts page calls once a
   * view has been recorded, rather than waiting for the next poll.
   */
  const [unseenPosts, setUnseenPosts] = useState(0);
  const [postNotifications, setPostNotifications] = useState([]);
  const [openPostId, setOpenPostId] = useState('');
  const canUsePosts = can(user, 'posts');

  const refreshPostNotifications = useCallback(async () => {
    if (!canUsePosts) return;
    try {
      const { data } = await api.get('/posts/notifications', { params: { limit: 5 } });
      setUnseenPosts(data.unseen || 0);
      setPostNotifications(data.posts || []);
    } catch (error) {
      // A 403 here means the account is missing `posts:view`, which is
      // otherwise invisible: the bell simply stays empty and a post published
      // for everyone reaches nobody. Worth a line in the console.
      if (error.response?.status === 403) console.warn('Post notifications:', error.response?.data?.message);
    }
  }, [canUsePosts]);

  useEffect(() => {
    if (!canUsePosts) return undefined;
    refreshPostNotifications();
    const timer = setInterval(refreshPostNotifications, 60000);
    return () => clearInterval(timer);
  }, [canUsePosts, refreshPostNotifications, activeKey]);

  /*
   * Recent mail, for the mail icon in the header. Polled exactly like the
   * chat messages beside it, and for the same reason: the count has to be
   * visible from anywhere, not only once Mail is open.
   */
  const [mailUnread, setMailUnread] = useState(0);
  const [recentMail, setRecentMail] = useState([]);
  const [openMailId, setOpenMailId] = useState('');
  const canUseMail = can(user, 'mail');

  useEffect(() => {
    if (!canUseMail) return undefined;

    let cancelled = false;
    const checkMail = async () => {
      try {
        const { data } = await api.get('/mail/recent', { params: { limit: 5 } });
        if (cancelled) return;
        setMailUnread(data.unread || 0);
        setRecentMail(data.mails || []);
      } catch (error) {
        // Logged rather than swallowed: a 403 here means the account is
        // missing a permission, which is otherwise invisible.
        if (error.response?.status === 403) console.warn('Mail notifications:', error.response?.data?.message);
      }
    };

    checkMail();
    const timer = setInterval(checkMail, 15000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [canUseMail, activeKey]);

  const openMailItem = (mailId) => {
    setOpenMailId(mailId || '');
    setActiveKey('mail');
  };

  // Picking a post from the bell opens it, which records the view and so
  // takes it off the count.
  const openPost = (postId) => {
    setOpenPostId(postId || '');
    setActiveKey('posts');
  };

  // Picking a message from the header opens Chat on that conversation rather
  // than dropping the reader on the page and making them find it again.
  const openMessage = (threadId) => {
    setChatThreadId(threadId || '');
    setActiveKey('chat');
  };

  const handleExportPdf = async () => {
    if (!selectedRecord) return;

    const exportNode = document.getElementById('record-detail-export');
    if (!exportNode) {
      message.error(t('unableToExportRecord'));
      return;
    }

    try {
      const canvas = await html2canvas(exportNode, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        scrollX: 0,
        scrollY: 0,
      });
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 10;
      const contentWidth = pageWidth - margin * 2;
      const contentHeight = pageHeight - margin * 2;
      const pixelsPerMillimeter = canvas.width / contentWidth;
      const pageSliceHeight = Math.floor(contentHeight * pixelsPerMillimeter);
      const pageCanvas = document.createElement('canvas');
      const pageContext = pageCanvas.getContext('2d');

      pageCanvas.width = canvas.width;
      pageCanvas.height = pageSliceHeight;
      pageContext.fillStyle = '#ffffff';

      for (let sourceY = 0, pageNumber = 0; sourceY < canvas.height; sourceY += pageSliceHeight, pageNumber += 1) {
        const sliceHeight = Math.min(pageSliceHeight, canvas.height - sourceY);
        pageCanvas.height = sliceHeight;
        pageContext.fillRect(0, 0, canvas.width, sliceHeight);
        pageContext.drawImage(canvas, 0, sourceY, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);

        if (pageNumber > 0) pdf.addPage();
        pdf.addImage(
          pageCanvas.toDataURL('image/png'),
          'PNG',
          margin,
          margin,
          contentWidth,
          sliceHeight / pixelsPerMillimeter,
          undefined,
          'FAST',
        );
      }

      pdf.save(`${(selectedRecord.title || 'record').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-detail.pdf`);
      message.success(t('pdfExported'));
    } catch (error) {
      console.error(error);
      message.error(t('unableToExportPdf'));
    }
  };

  const handleExportWord = async () => {
    if (!selectedRecord) return;

    const filename = `${(selectedRecord.title || 'record').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-detail`;
    const htmlContent = `
      <html>
        <head>
          <meta charset="utf-8" />
          <style>
            body { font-family: Arial, sans-serif; font-size: 12pt; line-height: 1.6; color: #1f1f1f; margin: 24px; }
            h1, h2, h3 { margin: 0 0 12px; color: #111827; }
            p { margin: 0 0 12px; }
            strong, b { font-weight: 700; }
            ul, ol { margin: 0 0 12px 24px; }
            table { border-collapse: collapse; width: 100%; margin-bottom: 12px; }
            th, td { border: 1px solid #d1d5db; padding: 6px 8px; text-align: left; }
          </style>
        </head>
        <body>
          <h2>${selectedRecord.title || 'Record detail'}</h2>
          <p><strong>Category:</strong> ${selectedRecord.category || '-'}</p>
          ${selectedRecord.attempt ? `<p><strong>Attempt:</strong></p>${selectedRecord.attempt}` : ''}
          ${selectedRecord.attachment ? `<p><strong>Attachment:</strong> ${selectedRecord.attachment}</p>` : ''}
          <p><strong>Content:</strong></p>
          ${selectedRecord.content || '<p>No content</p>'}
          <p><strong>Created:</strong> ${new Date(selectedRecord.createdAt).toLocaleString()}</p>
        </body>
      </html>
    `;

    try {
      const blob = await asBlob(htmlContent, { orientation: 'portrait', margins: { top: 720, bottom: 720, left: 720, right: 720 } });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${filename}.docx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      message.success(t('wordExported'));
    } catch (error) {
      console.error(error);
      message.error(t('unableToExportWord'));
    }
  };

  const allMenuItems = [
    { key: 'overview', icon: <DashboardOutlined />, label: t('overview') },
    { key: 'users', icon: <TeamOutlined />, label: t('users') },
    { key: 'records', icon: <DatabaseOutlined />, label: t('data') },
    { key: 'cameras', icon: <CameraOutlined />, label: t('cameraManagement') },
    { key: 'projects', icon: <ProjectOutlined />, label: t('projectManagement') },
    { key: 'schedule', icon: <CalendarOutlined />, label: t('schedule') },
    {
      key: 'tools',
      icon: <ToolOutlined />,
      label: 'Tools',
      children: [
        { key: 'lvgl-tool', label: 'LVGL' },
        { key: 'convert-tool', label: 'Converting' },
        // The three model tools group together: they are about training and
        // inference, where the two above are file converters.
        {
          key: 'tools-ai',
          label: 'AI',
          children: [
            { key: 'yolo', label: 'YOLO' },
            { key: 'transformers', label: 'Transformers' },
            { key: 'keras', label: 'Keras' },
          ],
        },
      ],
    },
    {
      key: 'chat',
      icon: <MessageOutlined />,
      label: chatUnread > 0
        ? <span className="vision-menu-label">{t('chat')}<span className="vision-badge is-blue">{chatUnread}</span></span>
        : t('chat'),
    },
    { key: 'mail', icon: <MailOutlined />, label: t('mail') },
    { key: 'meetings', icon: <VideoCameraOutlined />, label: t('meetings') },
    {
      key: 'posts',
      icon: <NotificationOutlined />,
      label: unseenPosts > 0
        ? <span className="vision-menu-label">{t('posts')}<span className="vision-badge is-blue">{unseenPosts}</span></span>
        : t('posts'),
    },
    { key: 'database', icon: <CloudServerOutlined />, label: t('databaseManagement') },
    { key: 'system-monitor', icon: <BarChartOutlined />, label: t('systemMonitoring') },
    {
      key: 'basic-data',
      icon: <AppstoreOutlined />,
      label: t('basicData'),
      children: [{ key: 'categories', label: t('category') }],
    },
  ];

  /*
   * A parent stays only if at least one of its children survives the filter.
   *
   * Recursive rather than one level deep, because the menu is: Tools has an AI
   * group inside it. Flat logic checked `can(user, 'tools-ai')` — a grouping
   * label, never a page and so never a permission — and dropped every tool
   * underneath it. Only leaves are permission-checked; a group is judged
   * entirely by what survives inside it.
   */
  const filterMenu = (items) => items
    .map((item) => {
      if (!item.children) return can(user, item.key) ? item : null;
      const children = filterMenu(item.children);
      return children.length ? { ...item, children } : null;
    })
    .filter(Boolean);

  const leafKeys = (items) => items.flatMap((item) => (
    item.children ? leafKeys(item.children) : [item.key]
  ));

  const menuItems = filterMenu(allMenuItems);

  const visiblePageKeys = new Set(leafKeys(menuItems));
  // My Page is reached from the user menu rather than the sidebar, and is
  // always your own account, so it needs no page permission to open.
  const canViewActivePage = visiblePageKeys.has(activeKey) || activeKey === 'my-page';
  // The first actual page, not the first entry — the first entry may now be a
  // group whose own key renders nothing.
  const [firstVisiblePage = null] = leafKeys(menuItems);

  // Rendering off effectiveKey rather than activeKey means a revoked page is
  // never painted, not even for the frame before the effect below corrects it.
  const effectiveKey = canViewActivePage ? activeKey : firstVisiblePage;

  useEffect(() => {
    if (!canViewActivePage && firstVisiblePage) {
      setActiveKey(firstVisiblePage);
    }
  }, [canViewActivePage, firstVisiblePage, setActiveKey]);

  const userMenuItems = [
    { key: 'my-page', label: t('myPage'), onClick: () => setActiveKey('my-page') },
    { type: 'divider' },
    { key: 'logout', label: t('logout'), danger: true, onClick: logout },
  ];

  // The header search is the record search, so typing there jumps to Data
  // rather than being a decorative field.
  const handleGlobalSearch = (value) => {
    if (can(user, 'records')) {
      setActiveKey('records');
      onSearchRecords(value);
    }
  };

  return (
    <AppLayout
      user={user}
      menuItems={menuItems}
      selectedKey={effectiveKey}
      onSelect={setActiveKey}
      userMenuItems={userMenuItems}
      searchValue={searchText}
      onSearchChange={onSearchInputChange}
      onSearchSubmit={handleGlobalSearch}
      // The bell carries both things that are waiting to be looked at: posts
      // nobody has opened, and tomorrow's schedule.
      notificationCount={reminders.length + unseenPosts}
      notificationItems={reminders}
      onNotificationSelect={() => setActiveKey('schedule')}
      postItems={postNotifications}
      onPostSelect={openPost}
      showMessages={canUseChat}
      messageCount={chatUnread}
      messageItems={recentMessages}
      onMessageSelect={openMessage}
      showMail={canUseMail}
      mailCount={mailUnread}
      mailItems={recentMail}
      onMailSelect={openMailItem}
    >
        <Modal
          open={Boolean(selectedRecord)}
          title={selectedRecord?.title || 'Record details'}
          onCancel={() => setSelectedRecord(null)}
          footer={[
            <Button key="copy" icon={<CopyOutlined />} onClick={() => selectedRecord && copyHtmlWithStyles(selectedRecord.content, t)}>{t('copyContent')}</Button>,
            <Button key="pdf" onClick={handleExportPdf}>{t('exportPdf')}</Button>,
            <Button key="word" onClick={handleExportWord}>{t('exportWord')}</Button>,
            <Button key="close" onClick={() => setSelectedRecord(null)}>{t('close')}</Button>,
          ]}
          width={900}
        >
          {selectedRecord && (
            <div id="record-detail-export">
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                <Space size="small" wrap>
                  <Tag>{selectedRecord.category}</Tag>
                  {/* Who can read it, stated on the record rather than left to
                      be remembered from the form that created it. */}
                  <Tag icon={<ShareAltOutlined />} color={selectedRecord.visibility === 'selected' ? 'blue' : undefined}>
                    {describeSharing(selectedRecord, directory, t)}
                  </Tag>
                </Space>
                {selectedRecord.attempt && (
                  <Card size="small" title={t('attempt')}>
                    <div className="html-content detail-content">{selectedRecord.attempt}</div>
                  </Card>
                )}
                {selectedRecord.attachment && (
                  <a href={resolveAttachmentUrl(selectedRecord.attachment)} target="_blank" rel="noreferrer">
                    {t('openAttachment')}
                  </a>
                )}
                <div
                  className="html-content detail-content"
                  dangerouslySetInnerHTML={{ __html: selectedRecord.content || '<p>No content</p>' }}
                />
                <Text type="secondary">{t('createdAt', { value: new Date(selectedRecord.createdAt).toLocaleString() })}</Text>
              </Space>
            </div>
          )}
        </Modal>

        <Modal
          open={Boolean(editingRecord)}
          title={editingRecord?.title ? t('editRecordNamed', { title: editingRecord.title }) : t('editRecord')}
          onCancel={() => {
            setEditingRecord(null);
            recordForm.resetFields();
          }}
          footer={null}
          width={700}
        >
          <Form key={editingRecord?.id || 'edit-record'} form={recordForm} layout="vertical" onFinish={handleUpdateRecord}>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name="title" label={t('title')} rules={[{ required: true }]}>
                  <Input />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="categoryId" label={t('category')} rules={[{ required: true }]}>
                  <TreeSelect
                    treeData={categoryTreeData(categories)}
                    treeDefaultExpandAll
                    placeholder={t('selectCategory')}
                    allowClear
                    style={{ width: '100%' }}
                  />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item name="attempt" label={t('attempt')}>
              <Input.TextArea
                rows={4}
                placeholder={t('attemptDetailsPlaceholder')}
                value={recordForm.getFieldValue('attempt') || ''}
                onChange={(event) => recordForm.setFieldValue('attempt', event.target.value)}
              />
            </Form.Item>
            <Form.Item name="content" label={t('content')} rules={[{ required: true }]}>
              <HtmlEditor />
            </Form.Item>
            <Form.Item label={t('attachment')} name="attachment">
              <div className="mail-attachment-controls">
                <label className="mail-file-picker" htmlFor="record-edit-upload">
                  <PaperClipOutlined />
                  <span>{attachmentName ? t('changeFiles') : t('uploadFiles')}</span>
                </label>
                <input
                  id="record-edit-upload"
                  type="file"
                  accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.txt,.csv"
                  multiple
                  className="mail-file-input"
                  onChange={(event) => {
                    const files = Array.from(event.target.files || []);
                    const label = files.length === 0 ? '' : files.length === 1 ? files[0].name : `${files.length} files selected`;
                    setAttachmentName(label);
                    recordForm.setFieldValue('attachment', files);
                  }}
                />
              </div>
              {attachmentName && <div className="mail-file-name">{attachmentName}</div>}
            </Form.Item>
            <ShareWithField form={recordForm} directory={directory} currentUserId={user?.id} />
            <Space style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button onClick={() => {
                setEditingRecord(null);
                recordForm.resetFields();
              }}>{t('cancel')}</Button>
              <Button type="primary" htmlType="submit" loading={loading}>{t('updateRecord')}</Button>
            </Space>
          </Form>
        </Modal>

        <Modal
          open={isAddModalOpen}
          title={t('addRecord')}
          onCancel={() => {
            setIsAddModalOpen(false);
            addForm.resetFields();
          }}
          footer={null}
          width={700}
        >
          <Form form={addForm} layout="vertical" onFinish={handleSaveRecord}>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name="title" label={t('title')} rules={[{ required: true }]}>
                  <Input />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="categoryId" label={t('category')} rules={[{ required: true }]}>
                  <TreeSelect
                    treeData={categoryTreeData(categories)}
                    treeDefaultExpandAll
                    placeholder={t('selectCategory')}
                    allowClear
                    style={{ width: '100%' }}
                  />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item name="attempt" label={t('attempt')}>
              <Input.TextArea rows={4} placeholder={t('attemptDetailsPlaceholder')} />
            </Form.Item>
            <Form.Item name="content" label={t('content')} rules={[{ required: true }]}>
              <HtmlEditor />
            </Form.Item>
            <Form.Item label={t('attachment')} name="attachment">
              <div className="mail-attachment-controls">
                <label className="mail-file-picker" htmlFor="record-add-upload">
                  <PaperClipOutlined />
                  <span>{attachmentName ? t('changeFiles') : t('uploadFiles')}</span>
                </label>
                <input
                  id="record-add-upload"
                  type="file"
                  accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.txt,.csv"
                  multiple
                  className="mail-file-input"
                  onChange={(event) => {
                    const files = Array.from(event.target.files || []);
                    const label = files.length === 0 ? '' : files.length === 1 ? files[0].name : `${files.length} files selected`;
                    setAttachmentName(label);
                    addForm.setFieldValue('attachment', files);
                  }}
                />
              </div>
              {attachmentName && <div className="mail-file-name">{attachmentName}</div>}
            </Form.Item>
            <ShareWithField form={addForm} directory={directory} currentUserId={user?.id} />
            <Space style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button onClick={() => {
                setIsAddModalOpen(false);
                addForm.resetFields();
              }}>{t('cancel')}</Button>
              <Button type="primary" htmlType="submit" loading={loading}>{t('saveRecord')}</Button>
            </Space>
          </Form>
        </Modal>

        {!menuItems.length && (
          <Card>
            <Title level={4} style={{ marginTop: 0 }}>No pages available</Title>
            <Text type="secondary">
              Your account has not been granted access to any pages yet. Ask an administrator to
              update your permissions.
            </Text>
          </Card>
        )}

          {effectiveKey === 'overview' && (
            <OverviewPage
              user={user}
              users={users}
              records={records}
              categories={categories}
              cameras={cameras}
              systemStatus={systemStatus}
              overviewChartData={overviewChartData}
              onNavigate={setActiveKey}
            />
          )}

          {effectiveKey === 'records' && (
            <RecordsPage
              user={user}
              records={records}
              categories={categories}
              searchText={searchText}
              categoryFilter={categoryFilter}
              searchMode={searchMode}
              dateSearchEnabled={dateSearchEnabled}
              searchDateFrom={searchDateFrom}
              searchDateTo={searchDateTo}
              onDateSearchEnabledChange={onDateSearchEnabledChange}
              onSearchDateFromChange={onSearchDateFromChange}
              onSearchDateToChange={onSearchDateToChange}
              onSearchRecords={onSearchRecords}
              onSearchInputChange={onSearchInputChange}
              onCategoryFilterChange={onCategoryFilterChange}
              onAiSearch={onAiSearch}
              setSelectedRecord={setSelectedRecord}
              handleEditRecord={handleEditRecord}
              handleDeleteRecord={handleDeleteRecord}
              handleDeleteRecords={handleDeleteRecords}
              setIsAddModalOpen={setIsAddModalOpen}
            />
          )}

          {effectiveKey === 'cameras' && <CamerasPage user={user} cameras={cameras} setCameras={setCameras} />}

          {effectiveKey === 'schedule' && (
            <SchedulePage
              reminders={reminders}
              notificationPermission={permission}
              onRequestNotifications={requestPermission}
            />
          )}

          {effectiveKey === 'lvgl-tool' && <LvglToolPage />}
          {effectiveKey === 'convert-tool' && <ConvertToolPage />}
          {effectiveKey === 'yolo' && <YoloToolPage />}
          {effectiveKey === 'transformers' && <TransformersToolPage />}
          {effectiveKey === 'keras' && <KerasToolPage />}

          {effectiveKey === 'categories' && (
            <CategoriesPage
              categories={categories}
              categoryForm={categoryForm}
              handleCreateCategory={handleCreateCategory}
              handleDeleteCategory={handleDeleteCategory}
              loading={loading}
            />
          )}

          {effectiveKey === 'users' && (
            <UsersPage
              users={users}
              user={user}
              userTableColumns={userTableColumns}
              handleUpdateUser={handleUpdateUser}
              handleSetUserStatus={handleSetUserStatus}
              handleDeleteUser={handleDeleteUser}
              onRefreshUsers={onRefreshUsers}
              permissionCatalog={permissionCatalog}
            />
          )}

          {effectiveKey === 'chat' && (
            <ChatPage
              user={user}
              initialThreadId={chatThreadId}
              onThreadOpened={() => setChatThreadId('')}
            />
          )}

          {effectiveKey === 'mail' && (
            <MailPage
              user={user}
              directory={directory}
              initialMailId={openMailId}
              onMailOpened={() => setOpenMailId('')}
            />
          )}

          {effectiveKey === 'posts' && (
            <PostsPage
              user={user}
              initialPostId={openPostId}
              onPostOpened={() => setOpenPostId('')}
              onViewed={refreshPostNotifications}
            />
          )}

          {effectiveKey === 'meetings' && <MeetingsPage user={user} directory={directory} />}

          {effectiveKey === 'projects' && <ProjectsPage user={user} />}

          {/* Wallet now lives inside My Page, with the account's other personal data. */}
          {effectiveKey === 'my-page' && (
            <MyPage
              user={user}
              onUpdatePassword={handleUpdatePassword}
              onUpdateProfile={handleUpdateProfile}
            />
          )}

          {/* A reset or a replace-restore drops the account behind the current
              token, so the page is given the way out of a dead session. */}
          {effectiveKey === 'database' && <DatabasePage user={user} onSessionInvalidated={logout} />}

          {effectiveKey === 'system-monitor' && (
            <SystemMonitorPage
              systemStatus={systemStatus}
              records={records}
              users={users}
              categories={categories}
            />
          )}
    </AppLayout>
  );
}
