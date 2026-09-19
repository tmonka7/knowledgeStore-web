import { createContext, createElement, useContext, useEffect, useMemo, useState } from 'react';

const translations = {
  en: {
    language: 'Language',
    overview: 'Overview',
    users: 'Users',
    data: 'Data',
    cameraManagement: 'Camera Management',
    chat: 'Chat',
    mail: 'Mail',
    systemMonitoring: 'System Monitoring',
    basicData: 'Basic Data',
    category: 'Category',
    settings: 'Settings',
    logout: 'Logout',
    searchPlaceholder: 'Search data (name, category, etc.)',
    allCategories: 'All Categories',
    searchByDate: 'Search by date',
    fromDate: 'From date',
    toDate: 'To date',
    aiSearch: 'AI Search',
    search: 'Search',
    uploadData: 'Upload Data',
    exportExcel: 'Export Excel',
    delete: 'Delete',
    totalRecords: 'Total {count} records',
  },
  es: {
    language: 'Idioma',
    overview: 'Resumen',
    users: 'Usuarios',
    data: 'Datos',
    cameraManagement: 'Gestion de camaras',
    chat: 'Chat',
    mail: 'Correo',
    systemMonitoring: 'Monitoreo del sistema',
    basicData: 'Datos basicos',
    category: 'Categoria',
    settings: 'Configuracion',
    logout: 'Cerrar sesion',
    searchPlaceholder: 'Buscar datos (nombre, categoria, etc.)',
    allCategories: 'Todas las categorias',
    searchByDate: 'Buscar por fecha',
    fromDate: 'Fecha inicial',
    toDate: 'Fecha final',
    aiSearch: 'Busqueda IA',
    search: 'Buscar',
    uploadData: 'Subir datos',
    exportExcel: 'Exportar Excel',
    delete: 'Eliminar',
    totalRecords: 'Total: {count} registros',
  },
  zh: {
    language: '语言',
    overview: '概览',
    users: '用户',
    data: '数据',
    cameraManagement: '摄像头管理',
    chat: '聊天',
    mail: '邮件',
    systemMonitoring: '系统监控',
    basicData: '基础数据',
    category: '分类',
    settings: '设置',
    logout: '退出登录',
    searchPlaceholder: '搜索数据（名称、分类等）',
    allCategories: '所有分类',
    searchByDate: '按日期搜索',
    fromDate: '开始日期',
    toDate: '结束日期',
    aiSearch: '智能搜索',
    search: '搜索',
    uploadData: '上传数据',
    exportExcel: '导出 Excel',
    delete: '删除',
    totalRecords: '共 {count} 条记录',
  },
};

const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  const [language, setLanguage] = useState(() => localStorage.getItem('language') || 'en');

  useEffect(() => {
    localStorage.setItem('language', language);
    document.documentElement.lang = language;
  }, [language]);

  const value = useMemo(() => ({
    language,
    setLanguage,
    t: (key, values = {}) => Object.entries(values).reduce(
      (text, [name, replacement]) => text.replace(`{${name}}`, replacement),
      translations[language]?.[key] || translations.en[key] || key,
    ),
  }), [language]);

  return createElement(LanguageContext.Provider, { value }, children);
}

export const useLanguage = () => useContext(LanguageContext);
export const languageOptions = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Espanol' },
  { value: 'zh', label: '中文' },
];
