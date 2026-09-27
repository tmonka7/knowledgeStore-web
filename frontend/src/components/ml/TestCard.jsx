import { forwardRef, useEffect, useState } from 'react';
import {
  Card, Col, Empty, Row, Select, Space, Tag, Typography,
} from 'antd';
import { ExperimentOutlined, SwapOutlined } from '@ant-design/icons';
import { useLanguage } from '../../i18n';

const { Text } = Typography;

/**
 * The "Test" section under a Train panel: a model picker plus whatever the
 * tool needs to try that model out (`children`, given the chosen model and
 * the one to compare it with, or null). Fine-tuned models are listed first
 * and picked by default, since a model just trained is usually the one to
 * try; a fine-tuned model is compared with the model it was trained from, so
 * the test shows what the training changed.
 */
const TestCard = forwardRef(function TestCard({ models, value, onChange, describe, children }, ref) {
  const { t } = useLanguage();
  const [compareId, setCompareId] = useState('');
  const finetuned = models.filter((model) => model.kind === 'finetuned');
  const base = models.filter((model) => model.kind !== 'finetuned');
  const model = models.find((item) => item.id === value) || null;
  const compare = models.find((item) => item.id === compareId && item.id !== model?.id) || null;

  // A model deleted meanwhile (or a fresh page) falls back to the newest one.
  useEffect(() => {
    if (!model && models.length) onChange((finetuned[0] || base[0]).id);
  }, [model, models]); // eslint-disable-line react-hooks/exhaustive-deps

  // Picking a fine-tuned model compares it with its base, when that is still here.
  useEffect(() => {
    const origin = model?.kind === 'finetuned' && models.find((item) => item.id === model.baseModel);
    setCompareId(origin ? origin.id : '');
  }, [model?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const option = (item) => ({ value: item.id, label: describe ? `${item.name} (${describe(item)})` : item.name });
  const grouped = (list) => [
    { label: t('trainFinetuned'), options: finetuned.filter((item) => list.includes(item)).map(option) },
    { label: t('trainBase'), options: base.filter((item) => list.includes(item)).map(option) },
  ].filter((group) => group.options.length);
  const others = models.filter((item) => item.id !== model?.id);

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
            options={grouped(models)}
            notFoundContent={t('trainNoModels')}
          />
          <SwapOutlined style={{ color: '#8c8c8c' }} />
          <Text type="secondary">{t('mlTestCompare')}</Text>
          <Select
            showSearch
            optionFilterProp="label"
            style={{ minWidth: 280 }}
            value={compare?.id || ''}
            onChange={setCompareId}
            disabled={!model || !others.length}
            options={[{ value: '', label: t('mlTestNoCompare') }, ...grouped(others)]}
          />
        </Space>
        {model ? children(model, compare) : <Empty description={t('trainNoModels')} />}
      </Space>
    </Card>
  );
});

export default TestCard;

/**
 * One column per model (two when comparing), each headed by the model's name
 * and whether it is fine-tuned. `render(model, index)` fills a column.
 */
export function Side({ models, render }) {
  const { t } = useLanguage();
  if (models.length === 1) return render(models[0], 0);
  return (
    <Row gutter={[16, 16]}>
      {models.map((model, index) => (
        <Col key={model.id} xs={24} lg={12}>
          <Space direction="vertical" style={{ width: '100%' }}>
            <Space wrap size={4}>
              <Tag color={model.kind === 'finetuned' ? 'purple' : 'default'}>
                {model.kind === 'finetuned' ? t('trainFinetuned') : t('trainBase')}
              </Tag>
              <Text strong>{model.name}</Text>
            </Space>
            {render(model, index)}
          </Space>
        </Col>
      ))}
    </Row>
  );
}
