import { Tag, Tooltip } from 'antd';
import { UserOutlined } from '@ant-design/icons';
import { useLanguage } from '../../i18n';

/**
 * "by Alice" beside a shared dataset (or speaker) someone else created;
 * nothing for the caller's own. The API adds ownerName, mine and canManage.
 */
export default function OwnerTag({ item }) {
  const { t } = useLanguage();
  if (!item || item.mine) return null;
  return (
    <Tooltip title={item.canManage ? t('datasetAdminManages') : t('datasetSharedHelp')}>
      <Tag icon={<UserOutlined />} style={{ marginInlineEnd: 0 }}>
        {t('datasetBy', { name: item.ownerName || t('unknownPerson') })}
      </Tag>
    </Tooltip>
  );
}
