import { afterEach, describe, expect, it } from "vitest";

import { detectHumanVerification } from "./runtime";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("runtime verification detection", () => {
  it("detects known verification routes", () => {
    const windowRef = {
      location: { href: "https://chatgpt.com/security/challenge" },
      document
    } as unknown as Window;
    expect(detectHumanVerification(windowRef)).toBe("url");
  });

  it("detects embedded CAPTCHA frames", () => {
    document.body.innerHTML = '<iframe src="https://verify.example/captcha"></iframe>';
    const windowRef = {
      location: { href: "https://chat.deepseek.com/" },
      document
    } as unknown as Window;
    expect(detectHumanVerification(windowRef)).toBe("iframe[src*='captcha']");
  });
});
