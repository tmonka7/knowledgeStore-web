import { forwardRef, useEffect } from 'react';
import { Card, Empty, Select, Space, Typography } from 'antd';
import { ExperimentOutlined } from '@ant-design/icons';
import { useLanguage } from '../../i18n';

const { Text } = Typography;

/**
 * The "Test" section under a Train panel: a model picker plus whatever the
 * tool needs to try that model out (`children`, given the chosen model).
 * Fine-tuned models are listed first and picked by default, since a model
 * just trained is usually the one to try.
 */
const TestCard = forwardRef(function TestCard({ models, value, onChange, describe, children }, ref) {
  const { t } = useLanguage();
  const finetuned = models.filter((model) => model.kind === 'finetuned');
  const base = models.filter((model) => model.kind !== 'finetuned');
  const model = models.find((item) => item.id === value) || null;

  // A model deleted meanwhile (or a fresh page) falls back to the newest one.
  useEffect(() => {
    if (!model && models.length) onChange((finetuned[0] || base[0]).id);
  }, [model, models]); // eslint-disable-line react-hooks/exhaustive-deps

  const option = (item) => ({ value: item.id, label: describe ? `${item.name} (${describe(item)})` : item.name });
  const options = [
    { label: t('trainFinetuned'), options: finetuned.map(option) },
    { label: t('trainBase'), options: base.map(option) },
  ].filter((group) => group.options.length);

  return (
    <Card
      ref={ref}
      bordered={false}
      title={<Space><ExperimentOutlined />{t('mlTestTitle')}</Space>}
    >
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Space wrap>
          <Text type="secondary">{t('mlTestModel')}</Text>
          <Select
            showSearch
            optionFilterProp="label"
            style={{ minWidth: 320 }}
            value={model?.id}
            placeholder={t('trainPickModel')}
            onChange={onChange}
            options={options}
            notFoundContent={t('trainNoModels')}
          />
        </Space>
        {model ? children(model) : <Empty description={t('trainNoModels')} />}
      </Space>
    </Card>
  );
});

export default TestCard;
