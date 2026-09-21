import { createContext, createElement, useContext, useEffect, useMemo, useState } from 'react';

/*
 * Translations live in frontend/public/translations.xml, one <text> element
 * per string with an attribute per language:
 *
 *   <text id="overview" en="Overview" es="Resumen" zh="概览" jp="概要" />
 *
 * Keeping them in public/ rather than in this module means the file is served
 * as-is and can be edited without a rebuild — the cost is that the catalog
 * arrives over the network, which is what the loading gate below is for.
 *
 * This file stays plain JS (createElement, no JSX) because Vite only applies
 * the JSX transform to .jsx by default.
 */
export const languageOptions = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Espanol' },
  { value: 'zh', label: '中文' },
  { value: 'jp', label: '日本語' },
];

const SUPPORTED = languageOptions.map((option) => option.value);
const FALLBACK = 'en';
const CATALOG_URL = `${import.meta.env.BASE_URL}translations.xml`;

const parseCatalog = (xmlText) => {
  const parsed = new DOMParser().parseFromString(xmlText, 'application/xml');
  // A malformed file parses "successfully" into a parsererror document, so
  // the only way to notice is to look for that element.
  if (parsed.getElementsByTagName('parsererror').length) {
    throw new Error('translations.xml is not valid XML.');
  }

  const catalog = new Map();
  for (const node of parsed.getElementsByTagName('text')) {
    const id = node.getAttribute('id');
    if (!id) continue;

    const row = {};
    for (const code of SUPPORTED) {
      const value = node.getAttribute(code);
      if (value !== null) row[code] = value;
    }
    catalog.set(id, row);
  }
  return catalog;
};

// Fetched once per page load at module scope, so remounting the provider —
// or mounting a second one — never refetches or reparses the file.
let catalogPromise = null;

const loadCatalog = () => {
  if (!catalogPromise) {
    catalogPromise = fetch(CATALOG_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`${CATALOG_URL} returned HTTP ${response.status}`);
        return response.text();
      })
      .then(parseCatalog);
  }
  return catalogPromise;
};

const LanguageContext = createContext(null);

const readStoredLanguage = () => {
  try {
    const stored = localStorage.getItem('language');
    return SUPPORTED.includes(stored) ? stored : FALLBACK;
  } catch (error) {
    // Private mode and blocked site data both throw here rather than return null.
    return FALLBACK;
  }
};

export function LanguageProvider({ children }) {
  const [language, setLanguage] = useState(readStoredLanguage);
  const [catalog, setCatalog] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem('language', language);
    } catch (error) {
      /* A remembered language is a convenience, not a requirement. */
    }
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    let cancelled = false;

    loadCatalog().then(
      (entries) => { if (!cancelled) setCatalog(entries); },
      (error) => {
        console.error('Unable to load translations:', error.message);
        if (!cancelled) setFailed(true);
      },
    );

    return () => { cancelled = true; };
  }, []);

  const value = useMemo(() => ({
    language,
    setLanguage: (next) => setLanguage(SUPPORTED.includes(next) ? next : FALLBACK),
    ready: Boolean(catalog),
    /**
     * The chosen language, then English, then the key itself — a string that
     * has not been translated yet shows up as its id rather than as blank UI.
     * `values` fills {placeholders}, as in totalRecords="Total {count} records".
     */
    t: (key, values = {}) => {
      const row = catalog?.get(key);
      const text = row?.[language] || row?.[FALLBACK] || key;

      return Object.entries(values).reduce(
        (result, [name, replacement]) => result.replace(`{${name}}`, replacement),
        text,
      );
    },
  }), [language, catalog]);

  // The first paint waits for the catalog: a flash of raw ids is worse than a
  // moment of nothing. A failed load renders anyway — ids everywhere is ugly,
  // a blank page is unusable.
  if (!catalog && !failed) return null;

  return createElement(LanguageContext.Provider, { value }, children);
}

export const useLanguage = () => useContext(LanguageContext);
