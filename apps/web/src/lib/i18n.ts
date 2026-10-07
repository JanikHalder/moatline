import { useCallback, useSyncExternalStore } from "react";
import { de } from "@/locales/de";

/**
 * Interface language. The English text is the key: a string without a
 * translation shows in English instead of breaking, so pages can be
 * translated one at a time. `{name}` placeholders are filled from `vars`.
 */
export type Lang = "en" | "de";

export const LANGS: Array<{ value: Lang; label: string }> = [
  { value: "en", label: "English" },
  { value: "de", label: "Deutsch" },
];

const KEY = "pc-lang";
const DICTS: Record<Lang, Record<string, string>> = { en: {}, de };

function initial(): Lang {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === "en" || stored === "de") return stored;
  } catch {
    // storage disabled
  }
  return typeof navigator !== "undefined" &&
    navigator.language?.toLowerCase().startsWith("de")
    ? "de"
    : "en";
}

let current: Lang = initial();
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  current = lang;
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    // the choice just won't persist
  }
  if (typeof document !== "undefined") document.documentElement.lang = lang;
  for (const l of listeners) l();
}

if (typeof document !== "undefined") document.documentElement.lang = current;

export function translate(
  lang: Lang,
  text: string,
  vars?: Record<string, string | number>
): string {
  const out = DICTS[lang][text] ?? text;
  return vars
    ? out.replace(/\{(\w+)\}/g, (m, k: string) =>
        k in vars ? String(vars[k]) : m
      )
    : out;
}

/**
 * Translate outside of hooks (helpers, callbacks). Route content remounts
 * when the language changes (see RootLayout), so this always reads the
 * current one.
 */
export function tx(
  text: string,
  vars?: Record<string, string | number>
): string {
  return translate(current, text, vars);
}

export function useLang(): Lang {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getLang,
    getLang
  );
}

/** `const t = useT(); t("Repositories")` — re-renders when the language changes. */
export function useT() {
  const lang = useLang();
  return useCallback(
    (text: string, vars?: Record<string, string | number>) =>
      translate(lang, text, vars),
    [lang]
  );
}
