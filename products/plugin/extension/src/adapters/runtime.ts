import type { AdapterStatus, InsertResult, ResponseSnapshot } from "../shared/types";
import type { RuntimeSiteAdapter } from "./types";
import { detectProviderByHostname } from "../providers/catalog";
import { captureLatestResponse, findInput, insertIntoElement } from "./dom";

const HUMAN_VERIFICATION_SELECTORS = [
  "#captcha_container",
  "iframe[src*='verifycenter']",
  "iframe[src*='captcha']",
  "iframe[src*='recaptcha']",
  "iframe[src*='hcaptcha']",
  "iframe[src*='turnstile']",
  "[id*='captcha' i]",
  "[class*='captcha' i]"
] as const;

export function detectHumanVerification(windowRef: Window = window): string | null {
  if (/(?:captcha|verify|security|challenge)/i.test(windowRef.location.href)) return "url";
  return HUMAN_VERIFICATION_SELECTORS.find((selector) => windowRef.document.querySelector(selector)) ?? null;
}

export function createSiteAdapter(windowRef: Window = window): RuntimeSiteAdapter {
  const providerDefinition = detectProviderByHostname(windowRef.location.hostname);
  const providerId = providerDefinition?.id ?? "unknown";
  const label = providerDefinition?.label ?? "Unknown";

  return {
    provider: providerId,
    detectSync(): AdapterStatus {
      const verification = detectHumanVerification(windowRef);
      if (verification) {
        return {
          provider: providerId,
          label,
          readiness: "unknown",
          canInsert: false,
          url: windowRef.location.href,
          reason: "HUMAN_VERIFICATION_REQUIRED",
          verificationRequired: true
        };
      }
      const input = findInput(windowRef.document, providerDefinition);

      if (!providerDefinition) {
        return {
          provider: "unknown",
          label,
          readiness: "unsupported",
          canInsert: false,
          url: windowRef.location.href,
          reason: "当前页面暂未配置站点适配器。"
        };
      }

      return {
        provider: providerDefinition.id,
        label,
        readiness: input ? "supported" : "no_input",
        canInsert: Boolean(input),
        url: windowRef.location.href,
        matchedSelector: input?.selector,
        reason: input ? undefined : "没有找到可写入的原生输入框，请先打开或聚焦网页对话输入栏。"
      };
    },
    async detect() {
      return this.detectSync();
    },
    async insertText(text: string): Promise<InsertResult> {
      const input = findInput(windowRef.document, providerDefinition);

      if (!input) {
        return {
          ok: false,
          provider: providerId,
          message: "没有找到可写入的原生输入框，请先打开或聚焦网页对话输入栏。"
        };
      }

      const ok = insertIntoElement(input.element, text);
      return {
        ok,
        provider: providerId,
        message: ok ? "已插入当前网页输入框，请在网页中手动确认发送。" : "输入框类型暂不支持。"
      };
    },
    captureLatestResponseSync(): ResponseSnapshot | null {
      return captureLatestResponse(windowRef.document, providerId, providerDefinition);
    },
    async captureLatestResponse(): Promise<ResponseSnapshot | null> {
      return this.captureLatestResponseSync();
    }
  };
}
