export type Locale = 'en' | 'ru';

export const LOCALES: Locale[] = ['en', 'ru'];
export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_STORAGE_KEY = 'fn.locale';

export type MessageTree = {
  [key: string]: string | MessageTree;
};
