import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider } from 'antd';
import App from './App';
import './styles.css';
// Loaded last so the VisionAI tokens win over the older page rules.
import './styles/vision.css';
import './styles/vision-pages.css';
import { LanguageProvider } from './i18n';

const visionTheme = {
  token: {
    colorPrimary: '#1677ff',
    colorInfo: '#1677ff',
    colorSuccess: '#22c55e',
    colorWarning: '#f59e0b',
    colorError: '#ff4d5f',
    colorTextBase: '#102a43',
    colorBorder: '#e3ecf5',
    colorBorderSecondary: '#eef3fa',
    borderRadius: 10,
    borderRadiusLG: 14,
    fontSize: 14,
    controlHeight: 38,
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  },
  components: {
    Layout: {
      headerBg: 'transparent',
      bodyBg: 'transparent',
      siderBg: 'transparent',
      footerBg: 'transparent',
    },
    Menu: { itemBg: 'transparent', subMenuItemBg: 'transparent' },
    Card: { borderRadiusLG: 18 },
    Modal: { borderRadiusLG: 18 },
    Table: { headerBg: '#f8fbff', borderColor: '#eef3fa' },
    Button: { primaryShadow: 'none' },
  },
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ConfigProvider theme={visionTheme}>
      <LanguageProvider>
        <App />
      </LanguageProvider>
    </ConfigProvider>
  </React.StrictMode>,
);
