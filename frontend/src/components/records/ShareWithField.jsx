import { Form, Radio, Select } from 'antd';
import { useLanguage } from '../../i18n';

export const VISIBILITY_EVERYONE = 'everyone';
export const VISIBILITY_SELECTED = 'selected';

/**
 * Who a record is shared with, for the add and edit forms.
 *
 * Two questions rather than one list with an "everyone" entry in it: sharing
 * with everyone and sharing with a named set are different answers, and a
 * list that mixes them lets a record claim both at once.
 *
 * The owner is left out of the picker because they always have access; an
 * empty selection therefore means "only me", and the hint says so rather than
 * leaving it to be inferred.
 */
export default function ShareWithField({ form, directory = [], currentUserId }) {
  const { t } = useLanguage();
  const visibility = Form.useWatch('visibility', form) || VISIBILITY_EVERYONE;
  const sharedWith = Form.useWatch('sharedWith', form) || [];

  const options = directory
    .filter((person) => person.id !== currentUserId)
    .map((person) => ({
      value: person.id,
      label: person.username ? `${person.fullName} (${person.username})` : person.fullName,
    }));

  return (
    <>
      <Form.Item name="visibility" label={t('shareWith')} initialValue={VISIBILITY_EVERYONE}>
        <Radio.Group>
          <Radio.Button value={VISIBILITY_EVERYONE}>{t('shareEveryone')}</Radio.Button>
          <Radio.Button value={VISIBILITY_SELECTED}>{t('shareSelected')}</Radio.Button>
        </Radio.Group>
      </Form.Item>

      {visibility === VISIBILITY_SELECTED && (
        <Form.Item
          name="sharedWith"
          label={t('sharePeople')}
          extra={sharedWith.length ? undefined : t('shareOnlyYou')}
        >
          <Select
            mode="multiple"
            allowClear
            options={options}
            placeholder={t('sharePeoplePlaceholder')}
            optionFilterProp="label"
            maxTagCount="responsive"
            style={{ width: '100%' }}
          />
        </Form.Item>
      )}
    </>
  );
}

/** One line describing a record's sharing, for the detail view. */
export const describeSharing = (record, directory = [], t) => {
  if (!record || record.visibility !== VISIBILITY_SELECTED) return t('sharedWithEveryone');

  const shared = record.sharedWith || [];
  if (!shared.length) return t('sharedWithNobody');

  const nameById = new Map(directory.map((person) => [person.id, person.fullName]));
  const names = shared.map((id) => nameById.get(id) || t('unknownPerson'));
  return t('sharedWithPeople', { names: names.join(', ') });
};
