import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Empty, Input, Modal, Select, Tooltip, message } from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  MailOutlined,
  PhoneOutlined,
  PlusOutlined,
  ReloadOutlined,
  StarFilled,
  StarOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import api from '../../api';
import { can } from '../../permissions';
import StatCard from '../ui/StatCard';
import ContactFormModal from './ContactFormModal';

const initials = (name = '') => name
  .split(' ')
  .filter(Boolean)
  .slice(0, 2)
  .map((part) => part[0].toUpperCase())
  .join('') || '?';

/**
 * A personal address book: the API scopes every contact by its owner, so this
 * is one account's list and never the organisation's.
 */
export default function ContactsPanel({ user }) {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingContact, setEditingContact] = useState(null);
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState('all');

  const canCreate = can(user, 'contacts', 'create');
  const canEdit = can(user, 'contacts', 'edit');
  const canDelete = can(user, 'contacts', 'delete');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/contacts');
      setContacts(data.contacts || []);
    } catch (error) {
      message.error(error.response?.data?.message || 'Unable to load contacts.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const groups = useMemo(
    () => [...new Set(contacts.map((contact) => contact.group).filter(Boolean))].sort(),
    [contacts],
  );

  const visibleContacts = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return contacts.filter((contact) => {
      if (groupFilter !== 'all' && contact.group !== groupFilter) return false;
      if (!needle) return true;
      return [contact.fullName, contact.email, contact.phone, contact.company, contact.jobTitle, ...(contact.tags || [])]
        .some((field) => String(field || '').toLowerCase().includes(needle));
    });
  }, [contacts, search, groupFilter]);

  const replaceContact = (updated) => {
    setContacts((current) => current
      .map((contact) => (contact.id === updated.id ? updated : contact))
      // Favourites first, then by name — the same order the API returns.
      .sort((a, b) => (Number(b.favourite) - Number(a.favourite)) || a.fullName.localeCompare(b.fullName)));
  };

  const saveContact = async (values) => {
    setSaving(true);
    try {
      if (editingContact) {
        const { data } = await api.put(`/contacts/${editingContact.id}`, values);
        replaceContact(data.contact);
        message.success('Contact updated.');
      } else {
        await api.post('/contacts', values);
        message.success('Contact added.');
        await load();
      }
      setModalOpen(false);
      setEditingContact(null);
    } catch (error) {
      message.error(error.response?.data?.message || 'Unable to save that contact.');
    } finally {
      setSaving(false);
    }
  };

  const toggleFavourite = async (contact) => {
    try {
      const { data } = await api.patch(`/contacts/${contact.id}/favourite`, { favourite: !contact.favourite });
      replaceContact(data.contact);
    } catch (error) {
      message.error(error.response?.data?.message || 'Unable to update that contact.');
    }
  };

  const removeContact = (contact) => {
    Modal.confirm({
      title: `Delete ${contact.fullName}?`,
      content: 'This cannot be undone.',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api.delete(`/contacts/${contact.id}`);
          setContacts((current) => current.filter((item) => item.id !== contact.id));
          message.success('Contact deleted.');
        } catch (error) {
          message.error(error.response?.data?.message || 'Unable to delete that contact.');
        }
      },
    });
  };

  return (
    <div className="vision-stack">
      <div className="vision-stat-grid">
        <StatCard
          tone="blue"
          icon={<TeamOutlined />}
          label="Contacts"
          value={contacts.length}
          meta={`${groups.length} group${groups.length === 1 ? '' : 's'}`}
        />
        <StatCard
          tone="amber"
          icon={<StarFilled />}
          label="Favourites"
          value={contacts.filter((contact) => contact.favourite).length}
          meta="Sorted to the top"
        />
        <StatCard
          tone="violet"
          icon={<MailOutlined />}
          label="With email"
          value={contacts.filter((contact) => contact.email).length}
          meta="Reachable by mail"
        />
        <StatCard
          tone="cyan"
          icon={<PhoneOutlined />}
          label="With phone"
          value={contacts.filter((contact) => contact.phone).length}
          meta="Reachable by phone"
        />
      </div>

      <div className="vision-filter-bar">
        <Input.Search
          className="vision-filter-search"
          placeholder="Search by name, company, email, phone or tag"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          allowClear
        />
        <Select
          value={groupFilter}
          onChange={setGroupFilter}
          className="vision-filter-select"
          options={[
            { value: 'all', label: 'All groups' },
            ...groups.map((group) => ({ value: group, label: group })),
          ]}
        />
        <div className="vision-filter-actions">
          <Button className="vision-btn-ghost" icon={<ReloadOutlined />} loading={loading} onClick={load}>
            Refresh
          </Button>
          {canCreate && (
            <Button
              type="primary"
              className="vision-btn-primary"
              icon={<PlusOutlined />}
              onClick={() => { setEditingContact(null); setModalOpen(true); }}
            >
              Add contact
            </Button>
          )}
        </div>
      </div>

      {!visibleContacts.length ? (
        <section className="vision-panel">
          <Empty
            description={contacts.length ? 'No contact matches these filters' : 'No contacts yet'}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        </section>
      ) : (
        <div className="contact-grid">
          {visibleContacts.map((contact) => (
            <article key={contact.id} className="contact-card">
              <header className="contact-card-head">
                <span className="contact-card-avatar">{initials(contact.fullName)}</span>
                <div className="contact-card-identity">
                  <h4>{contact.fullName}</h4>
                  <span className="vision-cell-muted">
                    {[contact.jobTitle, contact.company].filter(Boolean).join(' · ') || contact.group}
                  </span>
                </div>
                {canEdit && (
                  <Tooltip title={contact.favourite ? 'Remove from favourites' : 'Mark as favourite'}>
                    <button
                      type="button"
                      className={`contact-card-star${contact.favourite ? ' is-on' : ''}`}
                      onClick={() => toggleFavourite(contact)}
                      aria-pressed={contact.favourite}
                      aria-label={contact.favourite ? 'Remove from favourites' : 'Mark as favourite'}
                    >
                      {contact.favourite ? <StarFilled /> : <StarOutlined />}
                    </button>
                  </Tooltip>
                )}
              </header>

              <ul className="contact-card-lines">
                {contact.email && (
                  <li>
                    <MailOutlined />
                    <a href={`mailto:${contact.email}`}>{contact.email}</a>
                  </li>
                )}
                {contact.phone && (
                  <li>
                    <PhoneOutlined />
                    <a href={`tel:${contact.phone.replace(/\s+/g, '')}`}>{contact.phone}</a>
                  </li>
                )}
              </ul>

              {contact.tags?.length > 0 && (
                <div className="task-card-tags">
                  {contact.tags.map((tag) => <span key={tag} className="vision-badge is-grey">{tag}</span>)}
                </div>
              )}

              {contact.notes && <p className="contact-card-notes">{contact.notes}</p>}

              <footer className="contact-card-foot">
                <span className="vision-badge is-blue">{contact.group}</span>
                <div className="vision-row-actions">
                  {canEdit && (
                    <Tooltip title="Edit">
                      <Button
                        size="small"
                        icon={<EditOutlined />}
                        onClick={() => { setEditingContact(contact); setModalOpen(true); }}
                      />
                    </Tooltip>
                  )}
                  {canDelete && (
                    <Tooltip title="Delete">
                      <Button size="small" danger icon={<DeleteOutlined />} onClick={() => removeContact(contact)} />
                    </Tooltip>
                  )}
                </div>
              </footer>
            </article>
          ))}
        </div>
      )}

      <ContactFormModal
        open={modalOpen}
        contact={editingContact}
        groups={groups}
        saving={saving}
        onCancel={() => { setModalOpen(false); setEditingContact(null); }}
        onSubmit={saveContact}
      />
    </div>
  );
}
