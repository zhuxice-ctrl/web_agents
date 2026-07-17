import en from "./en.json";
import zhCN from "./zh-CN.json";
import type { Locale } from "../shared/types";

type Dictionary = Record<string, string>;

const dictionaries: Record<Locale, Dictionary> = {
  "zh-CN": zhCN,
  en
};

export function translate(locale: Locale, key: string): string {
  return dictionaries[locale][key] ?? dictionaries["zh-CN"][key] ?? key;
}
