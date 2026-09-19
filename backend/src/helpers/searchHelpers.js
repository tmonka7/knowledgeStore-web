export const escapeRegex = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const getAiSearchTerms = (text = '') => {
  const normalized = String(text || '').trim().toLowerCase();
  if (!normalized) return [];

  const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'for', 'in', 'on', 'with', 'by', 'is', 'it', 'at', 'as', 'be', 'this', 'that', 'from', 'into', 'about']);
  const tokens = normalized.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  const terms = new Set();

  for (const token of tokens) {
    if (stopWords.has(token)) continue;
    const trimmed = token.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
    if (!trimmed) continue;

    terms.add(trimmed);
    if (trimmed.endsWith('s') && trimmed.length > 3) terms.add(trimmed.slice(0, -1));
    if (trimmed.endsWith('ing') && trimmed.length > 5) terms.add(trimmed.slice(0, -3));
    if (trimmed.endsWith('ed') && trimmed.length > 4) terms.add(trimmed.slice(0, -2));
  }

  return [...terms];
};

export const scoreAiMatch = (record, query = '') => {
  if (!record || !query) return 0;

  const normalizedQuery = String(query).trim().toLowerCase();
  const fields = [
    record.title || '',
    record.category || '',
    record.content || '',
    record.attempt || '',
  ].join(' ');
  const lowerFields = fields.toLowerCase();
  const terms = getAiSearchTerms(normalizedQuery);

  let score = 0;

  if (!normalizedQuery) return 0;
  if (lowerFields.includes(normalizedQuery)) score += 12;

  if ((record.title || '').toLowerCase().includes(normalizedQuery)) score += 8;
  if ((record.category || '').toLowerCase().includes(normalizedQuery)) score += 7;

  for (const term of terms) {
    if (!term) continue;
    if (lowerFields.includes(term)) score += 4;
    if ((record.title || '').toLowerCase().includes(term)) score += 6;
    if ((record.category || '').toLowerCase().includes(term)) score += 5;
  }

  return score;
};

export const rankAiSearchRecords = (records = [], query = '') => {
  const normalizedQuery = String(query || '').trim();
  if (!normalizedQuery) return records;

  return [...records]
    .map((record) => ({ record, score: scoreAiMatch(record, normalizedQuery) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ record }) => record);
};
