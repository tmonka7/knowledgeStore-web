import { useState } from 'react';
import { Alert } from 'antd';
import PythonRunner from '../components/transformers/PythonRunner';
import TranslationDatasetEditor from '../components/transformers/TranslationDatasetEditor';
import { useLanguage } from '../i18n';
import { can } from '../permissions';

export default function TransformersToolPage({ user }) {
  const { t } = useLanguage();
  const [datasets, setDatasets] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [activeDirty, setActiveDirty] = useState(false);

  // Running Python is a separate grant from using the page: it executes code
  // on the server. The API enforces the same rule.
  const canExecute = can(user, 'transformers', 'execute');

  return (
    <div className="vision-page vision-stack">
      <div className="vision-page-header">
        <div>
          <h1 className="vision-page-title">Transformers</h1>
          <p className="vision-page-subtitle">{t('transformersSubtitle')}</p>
        </div>
      </div>

      <TranslationDatasetEditor
        datasets={datasets}
        onDatasetsChange={setDatasets}
        activeId={activeId}
        onActiveChange={setActiveId}
        onDirtyChange={setActiveDirty}
      />

      {canExecute ? (
        <PythonRunner datasets={datasets} activeId={activeId} activeDirty={activeDirty} />
      ) : (
        <Alert type="info" showIcon message={t('pythonNeedsPermission')} />
      )}
    </div>
  );
}
