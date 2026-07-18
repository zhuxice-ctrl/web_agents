import { afterEach, describe, expect, it, vi } from "vitest";

import { getProviderById } from "../providers/catalog";
import { generateProviderImage } from "./provider-image";

function installVisibleLayout(element: Element): void {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    width: 400,
    height: 48,
    top: 0,
    left: 0,
    right: 400,
    bottom: 48,
    x: 0,
    y: 0,
    toJSON: () => ({})
  });
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("provider image generation", () => {
  it("submits the prompt and captures only an image added afterward", async () => {
    document.body.innerHTML = `
      <main>
        <form>
          <textarea aria-label="Ask Grok anything"></textarea>
          <button type="submit" aria-label="Submit">Send</button>
        </form>
        <article><img data-testid="generated-image-old" src="https://grok.com/old.png"></article>
      </main>
    `;
    const input = document.querySelector("textarea")!;
    const button = document.querySelector("button")!;
    button.setAttribute("type", "button");
    installVisibleLayout(input);
    installVisibleLayout(button);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      const image = document.createElement("img");
      image.setAttribute("data-testid", "generated-image-new");
      image.src = "https://grok.com/new.png";
      document.querySelector("article")?.append(image);
    });

    const readImage = vi.fn(async (image: HTMLImageElement) => ({
      dataUrl: `data:image/png;base64,${btoa(image.src)}`,
      mimeType: "image/png"
    }));
    const result = await generateProviderImage(
      document,
      getProviderById("grok")!,
      "A blue geometric city",
      { timeoutMs: 100, readImage }
    );

    expect((input as HTMLTextAreaElement).value).toBe("A blue geometric city");
    expect(readImage).toHaveBeenCalledWith(expect.objectContaining({ src: "https://grok.com/new.png" }));
    expect(result.mimeType).toBe("image/png");
  });

  it("returns a stable timeout error when no new image appears", async () => {
    document.body.innerHTML = `
      <main><form>
        <textarea aria-label="Ask Grok anything"></textarea>
        <button type="submit" aria-label="Submit">Send</button>
      </form></main>
    `;
    installVisibleLayout(document.querySelector("textarea")!);
    const button = document.querySelector("button")!;
    button.setAttribute("type", "button");
    installVisibleLayout(button);

    await expect(generateProviderImage(
      document,
      getProviderById("grok")!,
      "A blue geometric city",
      { timeoutMs: 5 }
    )).rejects.toMatchObject({ code: "PROVIDER_GENERATION_TIMEOUT" });
  });
});
