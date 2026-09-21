import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, DatePicker, Empty, Modal, Select, Space, Tooltip, message } from 'antd';
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../api';
import { can } from '../permissions';
import FilterBar from '../components/ui/FilterBar';
import PageHeader from '../components/ui/PageHeader';
import Pagination from '../components/ui/Pagination';
import StatCard from '../components/ui/StatCard';
import WalletEntryModal from '../components/wallet/WalletEntryModal';
import { BalanceTrend, CategoryBreakdown, MonthlyFlowChart } from '../components/wallet/WalletCharts';
import { CURRENCIES, formatMoney, readStoredCurrency } from '../components/wallet/money';

const PAGE_SIZE = 10;
const MONTH_OPTIONS = [3, 6, 12, 24];

const emptySummary = {
  totals: { income: 0, expense: 0, balance: 0, entries: 0 },
  monthly: [],
  categories: { income: [], expense: [] },
};

/**
 * Wallet Management.
 *
 * Entries and statistics are two requests against the same filters, and the
 * figures come from the API rather than being re-added in the browser, so the
 * cards, the charts and the table always agree.
 */
export default function WalletPage({ user, embedded = false }) {
  const [entries, setEntries] = useState([]);
  const [summary, setSummary] = useState(emptySummary);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState(null);
  const [page, setPage] = useState(1);
  const [currency, setCurrency] = useState(readStoredCurrency);

  const [range, setRange] = useState(null);
  const [typeFilter, setTypeFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [months, setMonths] = useState(6);

  const canCreate = can(user, 'wallet', 'create');
  const canEdit = can(user, 'wallet', 'edit');
  const canDelete = can(user, 'wallet', 'delete');

  const params = useMemo(() => ({
    ...(range?.[0] ? { from: range[0].format('YYYY-MM-DD') } : {}),
    ...(range?.[1] ? { to: range[1].format('YYYY-MM-DD') } : {}),
    ...(typeFilter !== 'all' ? { type: typeFilter } : {}),
    ...(categoryFilter !== 'all' ? { category: categoryFilter } : {}),
  }), [range, typeFilter, categoryFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [entryResponse, summaryResponse] = await Promise.all([
        api.get('/wallet/entries', { params }),
        api.get('/wallet/summary', { params: { ...params, months } }),
      ]);
      setEntries(entryResponse.data.entries || []);
      setSummary(summaryResponse.data || emptySummary);
    } catch (error) {
      message.error(error.response?.data?.message || 'Unable to load the wallet.');
    } finally {
      setLoading(false);
    }
  }, [params, months]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [params]);
  useEffect(() => { localStorage.setItem('wallet-currency', currency); }, [currency]);

  // Categories are whatever has been used so far, so the filter and the form
  // suggestions stay in step with the data without a second endpoint.
  const knownCategories = useMemo(
    () => [...new Set(entries.map((entry) => entry.category).filter(Boolean))].sort(),
    [entries],
  );

  const pageCount = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const visibleEntries = entries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const saveEntry = async (values) => {
    setSaving(true);
    try {
      if (editingEntry) {
        await api.put(`/wallet/entries/${editingEntry.id}`, values);
        message.success('Entry updated.');
      } else {
        await api.post('/wallet/entries', values);
        message.success('Entry recorded.');
      }
      setModalOpen(false);
      setEditingEntry(null);
      await load();
    } catch (error) {
      message.error(error.response?.data?.message || 'Unable to save that entry.');
    } finally {
      setSaving(false);
    }
  };

  const removeEntry = (entry) => {
    Modal.confirm({
      title: 'Delete this entry?',
      content: `${entry.type === 'income' ? 'Income' : 'Expense'} of ${formatMoney(entry.amount, currency)} on ${entry.date}.`,
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api.delete(`/wallet/entries/${entry.id}`);
          message.success('Entry deleted.');
          await load();
        } catch (error) {
          message.error(error.response?.data?.message || 'Unable to delete that entry.');
        }
      },
    });
  };

  const totals = summary.totals || emptySummary.totals;
  const positiveBalance = totals.balance >= 0;

  // The toolbar is the same either way; only its frame changes. Embedded in a
  // My Page tab it sits on its own, because that page already has the header.
  const toolbar = (
    <>
      <Select
        value={currency}
        onChange={setCurrency}
        options={CURRENCIES.map((code) => ({ value: code, label: code }))}
        style={{ width: 96 }}
      />
      <Button className="vision-btn-ghost" icon={<ReloadOutlined />} loading={loading} onClick={load}>
        Refresh
      </Button>
      {canCreate && (
        <Button
          type="primary"
          className="vision-btn-primary"
          icon={<PlusOutlined />}
          onClick={() => { setEditingEntry(null); setModalOpen(true); }}
        >
          Add entry
        </Button>
      )}
    </>
  );

  return (
    <div className={embedded ? 'vision-stack' : 'vision-page vision-stack'}>
      {embedded ? (
        <div className="vision-page-actions account-toolbar">{toolbar}</div>
      ) : (
        <PageHeader
          title="Wallet Management"
          subtitle="Record income and expenses, and see where the money went."
          actions={toolbar}
        />
      )}

      <div className="vision-stat-grid">
        <StatCard
          tone="blue"
          icon={<ArrowUpOutlined />}
          label="Income"
          value={formatMoney(totals.income, currency, { compact: true })}
          meta={`${summary.categories?.income?.length || 0} categories`}
        />
        <StatCard
          tone="amber"
          icon={<ArrowDownOutlined />}
          label="Expense"
          value={formatMoney(totals.expense, currency, { compact: true })}
          meta={`${summary.categories?.expense?.length || 0} categories`}
        />
        <StatCard
          tone={positiveBalance ? 'green' : 'red'}
          icon={<WalletOutlined />}
          label="Balance"
          value={formatMoney(totals.balance, currency, { compact: true })}
          trend={positiveBalance ? 'up' : 'down'}
          meta={positiveBalance ? 'In surplus' : 'Spending exceeds income'}
        />
        <StatCard
          tone="violet"
          icon={<WalletOutlined />}
          label="Entries"
          value={totals.entries}
          meta={range ? 'In the selected range' : 'All time'}
        />
      </div>

      <FilterBar
        actions={(
          <Button
            className="vision-btn-ghost"
            onClick={() => { setRange(null); setTypeFilter('all'); setCategoryFilter('all'); }}
          >
            Clear
          </Button>
        )}
      >
        <DatePicker.RangePicker
          value={range}
          onChange={setRange}
          className="vision-filter-select"
          allowEmpty={[true, true]}
        />
        <Select
          value={typeFilter}
          onChange={setTypeFilter}
          className="vision-filter-select"
          options={[
            { value: 'all', label: 'All types' },
            { value: 'income', label: 'Income only' },
            { value: 'expense', label: 'Expense only' },
          ]}
        />
        <Select
          value={categoryFilter}
          onChange={setCategoryFilter}
          className="vision-filter-select"
          options={[
            { value: 'all', label: 'All categories' },
            ...knownCategories.map((category) => ({ value: category, label: category })),
          ]}
        />
        <Select
          value={months}
          onChange={setMonths}
          className="vision-filter-select"
          options={MONTH_OPTIONS.map((count) => ({ value: count, label: `Last ${count} months` }))}
        />
      </FilterBar>

      <section className="vision-panel vision-panel-tight">
        <div className="vision-panel-head">
          <h3 className="vision-section-title">Income and expense</h3>
          <span className="vision-cell-muted">Last {months} months</span>
        </div>
        {!summary.monthly?.length
          ? <Empty description="Nothing recorded yet" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          : <MonthlyFlowChart months={summary.monthly} currency={currency} />}
      </section>

      <div className="vision-overview-split">
        <section className="vision-panel vision-panel-tight">
          <div className="vision-panel-head">
            <h3 className="vision-section-title">Running balance</h3>
            <span className="vision-cell-muted">Cumulative net</span>
          </div>
          {!summary.monthly?.length
            ? <Empty description="Nothing recorded yet" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            : <BalanceTrend months={summary.monthly} currency={currency} />}
        </section>

        <section className="vision-panel vision-panel-tight">
          <div className="vision-panel-head">
            <h3 className="vision-section-title">Spending by category</h3>
            <span className="vision-cell-muted">Top {summary.categories?.expense?.length || 0}</span>
          </div>
          <CategoryBreakdown rows={summary.categories?.expense || []} type="expense" currency={currency} />
        </section>
      </div>

      <div className="vision-overview-split">
        <section className="vision-panel vision-panel-tight">
          <div className="vision-panel-head">
            <h3 className="vision-section-title">Income by category</h3>
            <span className="vision-cell-muted">Top {summary.categories?.income?.length || 0}</span>
          </div>
          <CategoryBreakdown rows={summary.categories?.income || []} type="income" currency={currency} />
        </section>

        <section className="vision-panel vision-panel-tight">
          <div className="vision-panel-head">
            <h3 className="vision-section-title">Monthly figures</h3>
          </div>
          <div className="vision-table-scroll">
            <table className="vision-data-table">
              <thead>
                <tr><th>Month</th><th>Income</th><th>Expense</th><th>Net</th></tr>
              </thead>
              <tbody>
                {(summary.monthly || []).map((month) => (
                  <tr key={month.key}>
                    <td>{month.label}</td>
                    <td className="vision-cell-muted">{formatMoney(month.income, currency)}</td>
                    <td className="vision-cell-muted">{formatMoney(month.expense, currency)}</td>
                    <td className={month.net >= 0 ? 'vision-amount is-income' : 'vision-amount is-expense'}>
                      {formatMoney(month.net, currency)}
                    </td>
                  </tr>
                ))}
                {!summary.monthly?.length && (
                  <tr><td colSpan={4} className="vision-cell-muted">Nothing recorded yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="vision-panel vision-panel-tight">
        <div className="vision-panel-head">
          <h3 className="vision-section-title">Entries</h3>
          <span className="vision-cell-muted">{entries.length} matching</span>
        </div>

        {!entries.length ? (
          <Empty description="No entries match these filters" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <>
            <div className="vision-table-scroll">
              <table className="vision-data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Category</th>
                    <th>Note</th>
                    <th>Method</th>
                    <th>Amount</th>
                    {(canEdit || canDelete) && <th>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {visibleEntries.map((entry) => (
                    <tr key={entry.id}>
                      <td className="vision-cell-muted">{dayjs(entry.date).format('D MMM YYYY')}</td>
                      <td>
                        <span className={`vision-badge ${entry.type === 'income' ? 'is-blue' : 'is-amber'}`}>
                          {entry.type}
                        </span>
                      </td>
                      <td>{entry.category}</td>
                      <td className="vision-cell-muted" title={entry.note}>{entry.note || '—'}</td>
                      <td className="vision-cell-muted">{entry.method || '—'}</td>
                      <td className={`vision-amount is-${entry.type}`}>
                        {entry.type === 'income' ? '+' : '−'}{formatMoney(entry.amount, currency)}
                      </td>
                      {(canEdit || canDelete) && (
                        <td>
                          <Space size="small">
                            {canEdit && (
                              <Tooltip title="Edit">
                                <Button
                                  size="small"
                                  icon={<EditOutlined />}
                                  onClick={() => { setEditingEntry(entry); setModalOpen(true); }}
                                />
                              </Tooltip>
                            )}
                            {canDelete && (
                              <Tooltip title="Delete">
                                <Button size="small" danger icon={<DeleteOutlined />} onClick={() => removeEntry(entry)} />
                              </Tooltip>
                            )}
                          </Space>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination current={page} total={pageCount} onChange={setPage} />
          </>
        )}
      </section>

      <WalletEntryModal
        open={modalOpen}
        entry={editingEntry}
        saving={saving}
        knownCategories={knownCategories}
        onCancel={() => { setModalOpen(false); setEditingEntry(null); }}
        onSubmit={saveEntry}
      />
    </div>
  );
}
