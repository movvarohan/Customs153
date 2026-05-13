// TODO: replace with a real BrowserAutomation adapter using Playwright for
// local dev (`npm i playwright && npx playwright install chromium`). For now,
// a plain fetch — adequate for static gov pages, useless for JS-rendered ones.

import type { BrowserAutomation, RenderedPage } from "@/interfaces/browser";

export class StubBrowser implements BrowserAutomation {
  async render(
    url: string,
    _opts?: { waitForSelector?: string; timeoutMs?: number },
  ): Promise<RenderedPage> {
    const res = await fetch(url);
    const html = await res.text();
    return { url, html, status: res.status };
  }
}
