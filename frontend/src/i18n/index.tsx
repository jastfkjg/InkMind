import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Language, translations } from "./translations";

const GLOBAL_LANGUAGE_KEY = "inkmind_language";

function readStoredLanguage(): Language {
  if (typeof window === "undefined") {
    return "zh";
  }
  const stored = localStorage.getItem(GLOBAL_LANGUAGE_KEY);
  if (stored && ["zh", "en"].includes(stored)) {
    return stored as Language;
  }
  const browserLang = navigator.language.toLowerCase();
  if (browserLang.startsWith("zh")) {
    return "zh";
  }
  return "en";
}

type I18nState = {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
  isZh: boolean;
  isEn: boolean;
};

const I18nContext = createContext<I18nState | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    return readStoredLanguage();
  });

  useEffect(() => {
    localStorage.setItem(GLOBAL_LANGUAGE_KEY, language);
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  }, [language]);

  const setLanguage = useCallback((newLanguage: Language) => {
    setLanguageState(newLanguage);
  }, []);

  const t = useCallback(
    (key: string): string => {
      const value = translations[language][key];
      if (value === undefined) {
        console.warn(`Translation key not found: ${key}`);
        return key;
      }
      return value;
    },
    [language]
  );

  const value = useMemo(
    () => ({
      language,
      setLanguage,
      t,
      isZh: language === "zh",
      isEn: language === "en",
    }),
    [language, setLanguage, t]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return ctx;
}
