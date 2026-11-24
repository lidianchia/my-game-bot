import type { AppConfig } from "./core/app";
import { parseLang } from "./core/i18n";

/** Plain settings from wrangler vars, kept free of Workers types so Node tests can import it. */
export interface ConfigVars {
  ALLOWED_CHAT_IDS?: string;
  DEFAULT_LANG?: string;
  MINIAPP_SHORT_NAME?: string;
}

export function appConfig(vars: ConfigVars): AppConfig {
  const ids = (vars.ALLOWED_CHAT_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map(Number)
    .filter((value) => Number.isFinite(value));
  const webAppName = (vars.MINIAPP_SHORT_NAME ?? "").trim();
  return {
    defaultLang: parseLang(vars.DEFAULT_LANG) ?? "zh",
    allowedChatIds: ids.length ? new Set(ids) : null,
    webAppName: /^[A-Za-z0-9_]{3,30}$/.test(webAppName) ? webAppName : null,
  };
}
