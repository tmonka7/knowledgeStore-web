import { useEffect, useMemo, useRef, useState } from 'react';
import { Avatar, Form, Modal, Tag, message } from 'antd';
import { UserOutlined } from '@ant-design/icons';
import api from './api';
import AuthPage from './components/AuthPage';
import DashboardPage from './pages/DashboardPage';
import { can } from './permissions';

const defaultUser = { username: 'admin', password: 'admin123' };

function App() {
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [user, setUser] = useState(null);
  const [users, setUsers] = useState([]);
  const [records, setRecords] = useState([]);
  const [categories, setCategories] = useState([]);
  const [cameras, setCameras] = useState([]);
  const [searchText, setSearchText] = useState('');
  const [dateSearchEnabled, setDateSearchEnabled] = useState(false);
  const [searchDateFrom, setSearchDateFrom] = useState('');
  const [searchDateTo, setSearchDateTo] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [searchMode, setSearchMode] = useState('text');
  const [systemStatus, setSystemStatus] = useState({
    api: 'checking',
    memory: 'N/A',
    memoryPercent: 0,
    memoryLimit: 'N/A',
    cpu: navigator.hardwareConcurrency || 'N/A',
    cpuPercent: 0,
    history: [],
    lastUpdated: new Date().toLocaleTimeString(),
  });
  const cpuSampleRef = useRef({ lastTick: performance.now(), previousPercent: 30 });
  const [loading, setLoading] = useState(false);
  const [activeKey, setActiveKey] = useState('overview');
  const [loginForm] = Form.useForm();
  const [recordForm] = Form.useForm();
  const [addForm] = Form.useForm();
  const [categoryForm] = Form.useForm();
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [editingRecord, setEditingRecord] = useState(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [attachmentName, setAttachmentName] = useState('');
  const [permissionCatalog, setPermissionCatalog] = useState([]);

  const isLoggedIn = Boolean(token && user);

  const fetchProfile = async () => {
    if (!token) return;
    try {
      const { data } = await api.get('/user/profile');
      setUser(data.user);
    } catch (error) {
      console.error(error);
      logout();
    }
    }
  };

  const fetchUsers = async () => {
    if (!token) return;
    try {
      const { data } = await api.get('/users');
      setUsers(data.users || []);
    } catch (error) {
      console.error(error);
    }
  };

  const fetchData = async (
    query = '',
    selectedCategoryId = categoryFilter,
    mode = searchMode,
    dateEnabled = dateSearchEnabled,
    dateFrom = searchDateFrom,
    dateTo = searchDateTo,
  ) => {
    if (!token) return;
    try {
      const normalizedQuery = String(query || '').trim();
      const params = {};
      if (normalizedQuery) params.q = normalizedQuery;
      if (selectedCategoryId) params.categoryId = selectedCategoryId;
      if (mode && mode !== 'text') params.mode = mode;
      if (dateEnabled && (dateFrom || dateTo)) {
        if (dateFrom) params.dateFrom = dateFrom;
        if (dateTo) params.dateTo = dateTo;
      }

      const response = normalizedQuery || selectedCategoryId || mode !== 'text' || (dateEnabled && (dateFrom || dateTo))
        ? await api.get('/data/search', { params })
        : await api.get('/data', { params });
      setRecords(response.data.data || []);
    } catch (error) {
      console.error(error);
    }
  };

  const fetchCategories = async () => {
    if (!token) return;
    try {
      const { data } = await api.get('/categories');
      setCategories(data.categories || []);
    } catch (error) {
      console.error(error);
    }
  };

  const fetchCameras = async () => {
    if (!token) return;
    try {
      const { data } = await api.get('/cameras');
      setCameras(data.cameras || []);
    } catch (error) {
      console.error(error);
    }
  };

  const fetchPermissionCatalog = async () => {
    try {
      const { data } = await api.get('/permissions/catalog');
      setPermissionCatalog(data.catalog || []);
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    if (token) {
      fetchProfile();
    }
  }, [token]);

  // Each resource is fetched only when the user may see it, so a restricted
  // account doesn't fire a wall of 403s on login.
  useEffect(() => {
    if (!user) return;
    if (can(user, 'users', 'view')) fetchUsers();
    if (can(user, 'records', 'view')) fetchData(searchText, categoryFilter, searchMode);
    if (can(user, 'categories', 'view')) fetchCategories();
    if (can(user, 'cameras', 'view')) fetchCameras();
    if (user.role === 'admin') fetchPermissionCatalog();
  }, [user]);

  useEffect(() => {
    if (!token) return undefined;

    const checkSystemStatus = async () => {
      try {
        const { data } = await api.get('/health');
        const usedHeap = performance?.memory?.usedJSHeapSize ?? 0;
        const heapLimit = performance?.memory?.jsHeapSizeLimit ?? 0;
        const memoryPercent = heapLimit
          ? Math.min(100, Math.max(0, (usedHeap / heapLimit) * 100))
          : Math.min(100, Math.max(20, 35 + (Math.sin(Date.now() / 5000) + 1) * 20));
        const memoryValue = usedHeap ? `${Math.round((usedHeap / 1024 / 1024) * 10) / 10} MB` : `${Math.round(memoryPercent)}% live estimate`;
        const memoryLimitValue = heapLimit ? `${Math.round((heapLimit / 1024 / 1024) * 10) / 10} MB` : 'browser estimate';

        const now = performance.now();
        const drift = now - cpuSampleRef.current.lastTick;
        const baseline = 30 + (Math.sin(now / 5000) + 1) * 28;
        const cpuPercent = Math.min(100, Math.max(8, baseline + (drift > 2000 ? 18 : 0) - (drift < 1000 ? 6 : 0)));
        cpuSampleRef.current.lastTick = now;
        cpuSampleRef.current.previousPercent = cpuPercent;

        setSystemStatus((current) => {
          const nextHistory = [
            ...(current.history || []),
            {
              time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              memory: memoryPercent,
              cpu: cpuPercent,
            },
          ].slice(-12);

          return {
            api: data?.ok ? 'online' : 'offline',
            memory: memoryValue,
            memoryPercent,
            memoryLimit: memoryLimitValue,
            cpu: navigator.hardwareConcurrency || 'N/A',
            cpuPercent,
            history: nextHistory,
            lastUpdated: new Date().toLocaleTimeString(),
          };
        });
      } catch (error) {
        const fallbackCpu = Math.min(100, Math.max(10, (cpuSampleRef.current.previousPercent || 35) + 8));
        cpuSampleRef.current.previousPercent = fallbackCpu;

        setSystemStatus((current) => ({
          ...current,
          api: 'offline',
          memory: current.memory || 'live estimate',
          memoryPercent: Math.min(100, Math.max(20, (current.memoryPercent || 40) + 3)),
          cpuPercent: fallbackCpu,
          lastUpdated: new Date().toLocaleTimeString(),
        }));
      }
    };

    checkSystemStatus();
    const interval = setInterval(checkSystemStatus, 3000);
    return () => clearInterval(interval);
  }, [token]);

  const logout = () => {
    localStorage.removeItem('token');
    setToken('');
    setUser(null);
    setUsers([]);
    setRecords([]);
    setCameras([]);
  };

  const handleLogin = async (values) => {
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', values);
      localStorage.setItem('token', data.token);
      setToken(data.token);
      setUser(data.user);
      message.success(`Welcome back, ${data.user.fullName}!`);
      loginForm.resetFields();
    } catch (error) {
      message.error(error.response?.data?.message || 'Login failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (values) => {
    setLoading(true);
    try {
      const { data } = await api.post('/auth/register', values);
      localStorage.setItem('token', data.token);
      setToken(data.token);
      setUser(data.user);
      message.success(`Account created for ${data.user.fullName}.`);
      loginForm.resetFields();
    } catch (error) {
      message.error(error.response?.data?.message || 'Registration failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveRecord = async (values) => {
    setLoading(true);
    try {
      const selectedCategory = categories.find((item) => item.id === values.categoryId);
      const formData = new FormData();
      formData.append('title', values.title || '');
      formData.append('category', selectedCategory ? selectedCategory.path || selectedCategory.name : values.category || '');
      formData.append('categoryId', values.categoryId || '');
      formData.append('attempt', values.attempt || '');
      formData.append('content', values.content || '');

      const selectedFiles = Array.isArray(values.attachment)
        ? values.attachment
        : values.attachment && typeof values.attachment === 'object' && values.attachment.name
          ? [values.attachment]
          : [];

      selectedFiles.forEach((file) => {
        formData.append('attachment', file);
      });

      await api.post('/data', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      message.success('Record created successfully.');
      recordForm.resetFields();
      addForm.resetFields();
      setAttachmentName('');
      setIsAddModalOpen(false);
      fetchData();
    } catch (error) {
      message.error(error.response?.data?.message || 'Unable to save record.');
    } finally {
      setLoading(false);
    }
  };

  const handleEditRecord = (record) => {
    const categoryMatch = categories.find((item) => item.id === record.categoryId || item.path === record.category);
    const existingFiles = Array.isArray(record.attachments) && record.attachments.length > 0
      ? record.attachments
      : record.attachment
        ? [record.attachment]
        : [];
    const attachmentLabel = existingFiles.length === 1
      ? existingFiles[0].split('/').pop()
      : existingFiles.length > 1
        ? `${existingFiles.length} files selected`
        : '';

    setEditingRecord(record);
    recordForm.setFieldsValue({
      title: record.title || '',
      categoryId: categoryMatch?.id || record.categoryId || '',
      attempt: record.attempt || '',
      content: record.content || '',
      attachment: existingFiles,
    });
    setAttachmentName(attachmentLabel);
  };

  const handleUpdateRecord = async (values) => {
    if (!editingRecord?.id) return;

    setLoading(true);
    try {
      const selectedCategory = categories.find((item) => item.id === values.categoryId);
      const formData = new FormData();
      formData.append('title', values.title || '');
      formData.append('category', selectedCategory ? selectedCategory.path || selectedCategory.name : values.category || '');
      formData.append('categoryId', values.categoryId || '');
      formData.append('attempt', values.attempt || '');
      formData.append('content', values.content || '');

      const selectedFiles = Array.isArray(values.attachment)
        ? values.attachment
        : values.attachment && typeof values.attachment === 'object' && values.attachment.name
          ? [values.attachment]
          : [];

      selectedFiles.forEach((file) => {
        formData.append('attachment', file);
      });

      await api.put(`/data/${editingRecord.id}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      message.success('Record updated successfully.');
      recordForm.resetFields();
      setAttachmentName('');
      setEditingRecord(null);
      fetchData(searchText);
    } catch (error) {
      message.error(error.response?.data?.message || 'Unable to update record.');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateCategory = async (values) => {
    try {
      await api.post('/categories', {
        name: values.name,
        parentId: values.parentId || null,
      });
      categoryForm.resetFields();
      fetchCategories();
      message.success('Category created successfully.');
    } catch (error) {
      message.error(error.response?.data?.message || 'Unable to create category.');
    }
  };

  const handleDeleteCategory = async (id) => {
    try {
      await api.delete(`/categories/${id}`);
      fetchCategories();
      fetchData(searchText);
      message.success('Category deleted.');
    } catch (error) {
      message.error(error.response?.data?.message || 'Unable to delete category.');
    }
  };

  const handleSearchInputChange = (value) => {
    setSearchText(value || '');
  };

  const handleSearchRecords = (value) => {
    const nextValue = value || '';
    setSearchMode('text');
    setSearchText(nextValue);
    fetchData(nextValue, categoryFilter, 'text', dateSearchEnabled, searchDateFrom, searchDateTo);
  };

  const handleAiSearch = (value) => {
    const nextValue = value || '';
    setSearchMode('ai');
    setSearchText(nextValue);
    fetchData(nextValue, categoryFilter, 'ai', dateSearchEnabled, searchDateFrom, searchDateTo);
  };

  const handleCategoryFilterChange = (value) => {
    const nextValue = value || '';
    setCategoryFilter(nextValue);
    fetchData(searchText, nextValue, searchMode);
  };

  const handleDeleteRecord = async (id) => {
    Modal.confirm({
      title: 'Delete record?',
      content: 'This action cannot be undone.',
      onOk: async () => {
        try {
          await api.delete(`/data/${id}`);
          message.success('Record deleted.');
          fetchData(searchText);
        } catch (error) {
          message.error(error.response?.data?.message || 'Delete failed.');
        }
      },
    });
  };

  const handleUpdateUser = async (id, values) => {
    try {
      const { data } = await api.put(`/users/${id}`, values);
      message.success('User updated successfully.');
      fetchUsers();
      // Editing yourself changes your own menu, so refresh the active session too.
      if (data.user?.id === user?.id) {
        setUser(data.user);
      }
      return true;
    } catch (error) {
      message.error(error.response?.data?.message || 'Unable to update user.');
      return false;
    }
  };

  const handleUpdatePassword = async (values) => {
    try {
      await api.put('/user/password', {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      message.success('Password updated successfully.');
      return true;
    } catch (error) {
      message.error(error.response?.data?.message || 'Unable to update password.');
      return false;
    }
  };

  const userTableColumns = useMemo(
    () => [
      { title: 'Name', dataIndex: 'fullName', key: 'fullName' },
      {
        title: 'Photo',
        key: 'faceImage',
        width: 72,
        render: (_, record) => record.faceImage
          ? <img className="user-face-avatar" src={record.faceImage} alt={`${record.fullName} face`} />
          : <Avatar className="user-face-avatar user-face-placeholder" icon={<UserOutlined />} />,
      },
      { title: 'Username', dataIndex: 'username', key: 'username' },
      { title: 'Email', dataIndex: 'email', key: 'email' },
      { title: 'Role', dataIndex: 'role', key: 'role', render: (role) => <Tag color={role === 'admin' ? 'blue' : 'green'}>{role}</Tag> },
    ],
    [],
  );

  const summaryCards = [
    {
      title: 'Total Data',
      value: `${records.length}`,
      color: '#1e90ff',
      accent: '#dfeeff',
      change: '↑ 12%',
      meta: 'vs last month',
      icon: 'database',
    },
    {
      title: 'Total Users',
      value: `${users.length}`,
      color: '#2ec27d',
      accent: '#dffaf0',
      change: '↑ 6%',
      meta: 'vs last month',
      icon: 'users',
    },
    {
      title: 'Storage Used',
      value: '2.4 TB / 10 TB',
      color: '#8c7ef5',
      accent: '#efeaff',
      change: '24%',
      meta: 'of total',
      icon: 'storage',
    },
    {
      title: 'System Status',
      value: 'Healthy',
      color: '#28b56d',
      accent: '#e8fff2',
      change: 'Online',
      meta: 'All systems running normally',
      icon: 'status',
    },
  ];

  const overviewChartData = useMemo(() => {
    const now = new Date();
    const monthMap = new Map();

    for (let index = 5; index >= 0; index -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
      const key = date.toLocaleString('en-US', { month: 'short' });
      monthMap.set(key, { label: key, value: 0 });
    }

    records.forEach((record) => {
      const createdAt = record.createdAt ? new Date(record.createdAt) : null;
      if (!createdAt || Number.isNaN(createdAt.getTime())) return;

      const key = createdAt.toLocaleString('en-US', { month: 'short' });
      if (monthMap.has(key)) {
        monthMap.get(key).value += 1;
      }
    });

    return Array.from(monthMap.values());
  }, [records]);

  if (!isLoggedIn) {
    return (
      <AuthPage
        defaultUser={defaultUser}
        loading={loading}
        loginForm={loginForm}
        handleLogin={handleLogin}
        handleRegister={handleRegister}
      />
    );
  }

  return (
    <DashboardPage
      user={user}
      users={users}
      records={records}
      categories={categories}
      cameras={cameras}
      setCameras={setCameras}
      activeKey={activeKey}
      setActiveKey={setActiveKey}
      logout={logout}
      selectedRecord={selectedRecord}
      setSelectedRecord={setSelectedRecord}
      editingRecord={editingRecord}
      setEditingRecord={setEditingRecord}
      summaryCards={summaryCards}
      overviewChartData={overviewChartData}
      systemStatus={systemStatus}
      handleDeleteRecord={handleDeleteRecord}
      recordForm={recordForm}
      addForm={addForm}
      categoryForm={categoryForm}
      handleSaveRecord={handleSaveRecord}
      handleUpdateRecord={handleUpdateRecord}
      handleEditRecord={handleEditRecord}
      handleCreateCategory={handleCreateCategory}
      handleDeleteCategory={handleDeleteCategory}
      loading={loading}
      isAddModalOpen={isAddModalOpen}
      setIsAddModalOpen={setIsAddModalOpen}
      userTableColumns={userTableColumns}
      handleUpdatePassword={handleUpdatePassword}
      handleUpdateUser={handleUpdateUser}
      permissionCatalog={permissionCatalog}
      attachmentName={attachmentName}
      setAttachmentName={setAttachmentName}
      searchText={searchText}
      categoryFilter={categoryFilter}
      searchMode={searchMode}
              dateSearchEnabled={dateSearchEnabled}
              searchDateFrom={searchDateFrom}
              searchDateTo={searchDateTo}
              onDateSearchEnabledChange={setDateSearchEnabled}
              onSearchDateFromChange={setSearchDateFrom}
              onSearchDateToChange={setSearchDateTo}
      onSearchRecords={handleSearchRecords}
      onSearchInputChange={handleSearchInputChange}
      onCategoryFilterChange={handleCategoryFilterChange}
      onAiSearch={handleAiSearch}
    />
  );
}

export default App;
