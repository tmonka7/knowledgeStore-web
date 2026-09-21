import { createContext, createElement, useContext, useEffect, useMemo, useState } from 'react';

const parseTranslations = (xml) => {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.querySelector('parsererror')) throw new Error('Invalid translations XML.');

  return Array.from(document.querySelectorAll('text[id]')).reduce((catalog, element) => {
    const id = element.getAttribute('id');
    catalog[id] = {};
    Array.from(element.attributes).forEach((attribute) => {
      if (attribute.name !== 'id') catalog[id][attribute.name] = attribute.value;
    });
    return catalog;
  }, {});
};

const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  const [language, setLanguage] = useState(() => localStorage.getItem('language') || 'en');
  const [translations, setTranslations] = useState({});

  useEffect(() => {
    fetch('/translations.xml')
      .then((response) => {
        if (!response.ok) throw new Error(`Could not load translations (${response.status}).`);
        return response.text();
      })
      .then((xml) => setTranslations(parseTranslations(xml)))
      .catch((error) => console.error(error));
  }, []);

  useEffect(() => {
    localStorage.setItem('language', language);
    document.documentElement.lang = language;
  }, [language]);

  const value = useMemo(() => ({
    language,
    setLanguage,
    t: (key, values = {}) => Object.entries(values).reduce((text, [name, replacement]) => (
      text.replaceAll(`{${name}}`, replacement)
    ), translations[key]?.[language] || translations[key]?.en || key),
  }), [language, translations]);

  return createElement(LanguageContext.Provider, { value }, children);
}

export const useLanguage = () => useContext(LanguageContext);
export const languageOptions = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Espanol' },
  { value: 'zh', label: '中文' },
  { value: 'jp', label: '日本語' },
];
