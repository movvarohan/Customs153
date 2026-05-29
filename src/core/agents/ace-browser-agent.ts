// Browser-using agent that drives the (mock) ACE Importer Portal.
//
// In production this would point at the real CBP ACE Importer Portal
// (or via Cloudflare Browser Rendering against it). The pattern: an
// agent logs in with the importer's credentials, navigates the portal,
// downloads the entry summary PDFs, and feeds them into the refund
// finder — no CSV upload, no manual data entry from the importer.
//
// For the local demo, the target portal is the in-repo mock at
// /api/portal/* which serves HTML pages and downloads back the canned
// sample 7501 PDFs. The agent doesn't know it's mock — it navigates by
// selector and link text exactly as it would on the real portal.
//
// The run is streamed to the caller as NDJSON step events:
//   { type: "step", index, action, narration, screenshot_b64? }
//   { type: "downloaded", filename, bytes }
//   { type: "done", entries_downloaded, total_ms }
//   { type: "error", message }

import { chromium, type Browser, type Page } from "playwright-core";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

// Playwright's "chromium install" produces a couple of binaries here. We
// prefer the full chrome over headless_shell because download events fire
// reliably on the former. The path is environment-pinned for the demo.
const CHROME_BINARY = "/opt/pw-browsers/chromium-1223/chrome-linux64/chrome";

export type StepEvent =
  | { type: "step"; index: number; action: string; narration: string; screenshot_b64?: string }
  | { type: "downloaded"; filename: string; bytes: number; path: string }
  | { type: "done"; entries_downloaded: number; total_ms: number }
  | { type: "error"; message: string };

export interface AceRunOpts {
  /** Base URL of the portal (the mock is /api/portal under the backend). */
  portal_base_url: string;
  username: string;
  password: string;
  onEvent: (e: StepEvent) => void | Promise<void>;
}

async function snap(page: Page): Promise<string> {
  const buf = await page.screenshot({ fullPage: false, type: "png" });
  return buf.toString("base64");
}

async function step(
  opts: AceRunOpts,
  page: Page,
  index: number,
  action: string,
  narration: string,
): Promise<void> {
  const screenshot_b64 = await snap(page);
  await opts.onEvent({ type: "step", index, action, narration, screenshot_b64 });
}

/**
 * Drive the portal: login -> dashboard -> entries -> download each PDF.
 * Downloaded PDFs are saved to a temp dir and the paths returned via
 * "downloaded" events.
 */
export async function runAceBrowserAgent(opts: AceRunOpts): Promise<void> {
  const t0 = Date.now();
  let browser: Browser | null = null;
  let downloads = 0;
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ace-agent-"));
  try {
    browser = await chromium.launch({
      executablePath: CHROME_BINARY,
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 720 } });
    const page = await ctx.newPage();

    // 1. Land on the portal
    await page.goto(`${opts.portal_base_url}/login`, { waitUntil: "domcontentloaded" });
    await step(opts, page, 1, "navigate", "Opened the ACE Importer Portal sign-in page.");

    // 2. Type the username
    await page.fill('input[name="username"]', opts.username);
    await step(opts, page, 2, "type:username", "Typed the importer-of-record email address.");

    // 3. Type the password
    await page.fill('input[name="password"]', opts.password);
    await step(opts, page, 3, "type:password", "Entered the password.");

    // 4. Click Sign in
    await Promise.all([
      page.waitForLoadState("domcontentloaded"),
      page.click("#login-btn"),
    ]);
    await step(opts, page, 4, "click:login", "Clicked Sign in and landed on the dashboard.");

    // 5. Navigate to Entry Summaries
    await Promise.all([
      page.waitForLoadState("domcontentloaded"),
      page.click('a[href="/api/portal/entries"]'),
    ]);
    await step(
      opts,
      page,
      5,
      "navigate:entries",
      "Opened the Entry Summaries list. Three entries in the last 12 months.",
    );

    // 6+. Download each entry summary PDF
    const rows = await page.locator(".download-link").all();
    for (let i = 0; i < rows.length; i++) {
      const link = rows[i];
      if (!link) continue;
      const idx = await link.getAttribute("data-idx");
      await step(
        opts,
        page,
        6 + i,
        `click:download(${idx})`,
        `Clicked Download 7501 for entry row ${Number(idx) + 1}.`,
      );
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        link.click(),
      ]);
      const suggested = download.suggestedFilename();
      const dest = path.join(tmpDir, `entry-${idx}-${suggested}`);
      await download.saveAs(dest);
      const stat = await fs.stat(dest);
      downloads++;
      await opts.onEvent({ type: "downloaded", filename: suggested, bytes: stat.size, path: dest });
    }

    await step(
      opts,
      page,
      6 + rows.length,
      "done",
      `Downloaded ${downloads} entry summary PDF${downloads === 1 ? "" : "s"}. Handing off to the refund finder.`,
    );
    await opts.onEvent({
      type: "done",
      entries_downloaded: downloads,
      total_ms: Date.now() - t0,
    });
  } catch (e) {
    await opts.onEvent({ type: "error", message: e instanceof Error ? e.message : String(e) });
  } finally {
    if (browser) await browser.close().catch(() => undefined);
  }
}
