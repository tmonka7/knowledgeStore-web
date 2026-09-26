import { useRef, useState } from 'react';
import { Alert } from 'antd';
import PythonRunner from '../components/transformers/PythonRunner';
import TrainingPanel from '../components/transformers/TrainingPanel';
import TranslationDatasetEditor from '../components/transformers/TranslationDatasetEditor';
import { useLanguage } from '../i18n';
import { can } from '../permissions';

export default function TransformersToolPage({ user }) {
  const { t } = useLanguage();
  const [datasets, setDatasets] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [activeDirty, setActiveDirty] = useState(false);
  const [trainRequest, setTrainRequest] = useState(null);
  const trainingRef = useRef(null);

  // Each is a separate grant, and the API enforces the same rules: training
  // ties up the server for hours, and running Python executes arbitrary code.
  const canTrain = can(user, 'transformers', 'train');
  const canExecute = can(user, 'transformers', 'execute');

  const startTraining = (request) => {
    // A fresh object each click, so asking twice for the same pair re-applies it.
    setTrainRequest({ ...request });
    trainingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

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
        onTrain={canTrain ? startTraining : undefined}
      />

      {canTrain ? (
        <TrainingPanel ref={trainingRef} datasets={datasets} activeId={activeId} request={trainRequest} />
      ) : (
        <Alert type="info" showIcon message={t('trainNeedsPermission')} />
      )}

      {canExecute ? (
        <PythonRunner datasets={datasets} activeId={activeId} activeDirty={activeDirty} />
      ) : (
        <Alert type="info" showIcon message={t('pythonNeedsPermission')} />
      )}
    </div>
  );
}
