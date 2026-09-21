import { useEffect } from 'react';
import { AutoComplete, DatePicker, Form, Input, InputNumber, Modal, Radio, Select } from 'antd';
import dayjs from 'dayjs';
import { CURRENCIES, DEFAULT_CURRENCY, readLastCurrency } from './money';

const INCOME_CATEGORIES = ['Salary', 'Sales', 'Refund', 'Interest', 'Gift', 'Other'];
const EXPENSE_CATEGORIES = ['Hardware', 'Software', 'Hosting', 'Travel', 'Office', 'Food', 'Other'];

/**
 * One form for both directions: the amount is always positive and `type`
 * carries the sign, which is what keeps the totals a plain sum per series.
 */
export default function WalletEntryModal({ open, entry, saving, knownCategories = [], onCancel, onSubmit }) {
  const [form] = Form.useForm();
  const type = Form.useWatch('type', form) || 'expense';

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue(entry
      // An entry saved before the wallet held two currencies has none stored;
      // it was recorded in the default one.
      ? { ...entry, currency: entry.currency || DEFAULT_CURRENCY, date: dayjs(entry.date) }
      : {
        type: 'expense',
        // Preselected from the last entry, because a run of entries is
        // usually in one currency. It is only a starting point.
        currency: readLastCurrency(),
        date: dayjs(),
        amount: null,
        category: undefined,
        note: '',
        method: '',
      });
  }, [open, entry, form]);

  const suggestions = [...new Set([
    ...(type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES),
    ...knownCategories,
  ])].map((category) => ({ value: category }));

  return (
    <Modal
      open={open}
      title={entry ? 'Edit entry' : 'Record income or expense'}
      okText={entry ? 'Save changes' : 'Add entry'}
      confirmLoading={saving}
      onCancel={onCancel}
      onOk={async () => {
        const values = await form.validateFields().catch(() => null);
        if (!values) return;
        onSubmit({ ...values, date: values.date.format('YYYY-MM-DD') });
      }}
      width={560}
    >
      <Form form={form} layout="vertical">
        <Form.Item name="type" label="Type" rules={[{ required: true }]}>
          <Radio.Group>
            <Radio.Button value="income">Income</Radio.Button>
            <Radio.Button value="expense">Expense</Radio.Button>
          </Radio.Group>
        </Form.Item>

        <div className="vision-form-grid">
          <Form.Item
            name="amount"
            label="Amount"
            rules={[{ required: true, message: 'Enter an amount.' }, { type: 'number', min: 0.01, message: 'Amount must be greater than zero.' }]}
          >
            <InputNumber min={0} step={0.01} style={{ width: '100%' }} placeholder="0.00" />
          </Form.Item>
          <Form.Item
            name="currency"
            label="Currency"
            rules={[{ required: true, message: 'Choose a currency.' }]}
            extra="Kept per entry; totals are never converted."
          >
            <Select options={CURRENCIES.map((code) => ({ value: code, label: code }))} />
          </Form.Item>
          <Form.Item name="date" label="Date" rules={[{ required: true, message: 'Pick a date.' }]}>
            <DatePicker style={{ width: '100%' }} allowClear={false} />
          </Form.Item>
          <Form.Item name="category" label="Category" rules={[{ required: true, message: 'Choose or type a category.' }]}>
            <AutoComplete
              options={suggestions}
              placeholder={type === 'income' ? 'Salary' : 'Hosting'}
              filterOption={(input, option) => option.value.toLowerCase().includes(input.toLowerCase())}
            />
          </Form.Item>
          <Form.Item name="method" label="Method">
            <Input placeholder="Card, cash, transfer…" />
          </Form.Item>
        </div>

        <Form.Item name="note" label="Note">
          <Input.TextArea rows={3} placeholder="What was this for?" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
