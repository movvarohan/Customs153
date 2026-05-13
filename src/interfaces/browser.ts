// BrowserAutomation interface. Used for scraping CBP CROSS, USTR exclusion
// publications, FMC notices. Local adapter is a Playwright stub; Cloudflare
// Browser Rendering adapter later.

export interface RenderedPage {
  url: string;
  html: string;
  status: number;
}

export interface BrowserAutomation {
  render(url: string, opts?: { waitForSelector?: string; timeoutMs?: number }): Promise<RenderedPage>;
}
