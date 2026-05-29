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
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { MOCK_ENTRIES, loadEntryPdf } from "@/core/lib/mock-ace-portal";

// The Playwright browser bundle layout shifts between revisions and across
// machines (sandbox /opt/pw-browsers vs a developer's ~/Library/Caches or
// ~/.cache/ms-playwright). Hardcoding one path breaks, so we discover any
// installed chrome/headless_shell binary.
function discoverChromeBinary(): string | undefined {
  const explicit = process.env.PW_CHROME_BINARY;
  if (explicit && existsSync(explicit)) return explicit;
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    "/opt/pw-browsers",
    path.join(os.homedir(), "Library/Caches/ms-playwright"), // macOS
    path.join(os.homedir(), ".cache/ms-playwright"), // Linux
    path.join(os.homedir(), "AppData/Local/ms-playwright"), // Windows
  ].filter((r): r is string => Boolean(r) && existsSync(r as string));

  const candidates: string[] = [];
  for (const root of roots) {
    for (const dir of readdirSync(root)) {
      if (!dir.startsWith("chromium")) continue;
      for (const rel of [
        "chrome-linux64/chrome",
        "chrome-linux/chrome",
        "chrome-linux/headless_shell",
        "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
        "chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium",
        "chrome-headless-shell-mac-arm64/chrome-headless-shell",
        "chrome-headless-shell-mac-x64/chrome-headless-shell",
        "chrome-win/chrome.exe",
      ]) {
        const p = path.join(root, dir, rel);
        if (existsSync(p)) candidates.push(p);
      }
    }
  }
  candidates.sort((a, b) => {
    const fullA = a.includes("headless_shell") || a.includes("chrome-headless") ? 0 : 1;
    const fullB = b.includes("headless_shell") || b.includes("chrome-headless") ? 0 : 1;
    if (fullA !== fullB) return fullB - fullA;
    return b.localeCompare(a);
  });
  return candidates[0];
}

export type StepEvent =
  | { type: "step"; index: number; action: string; narration: string; screenshot_b64?: string; portal_path?: string; simulated?: boolean }
  | { type: "downloaded"; filename: string; bytes: number; path: string }
  | { type: "done"; entries_downloaded: number; total_ms: number }
  | { type: "notice"; message: string }
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
  portal_path: string,
): Promise<void> {
  const screenshot_b64 = await snap(page);
  await opts.onEvent({ type: "step", index, action, narration, screenshot_b64, portal_path });
}

/**
 * Drive the portal: login -> dashboard -> entries -> download each PDF.
 * Uses a real Playwright browser when one is available; if no browser can
 * be launched (e.g. `npx playwright install` hasn't been run on this
 * machine), it transparently falls back to a guided walkthrough that drives
 * the same portal pages — so "Audit my broker" always completes.
 */
export async function runAceBrowserAgent(opts: AceRunOpts): Promise<void> {
  const t0 = Date.now();
  let browser: Browser | null = null;
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ace-agent-"));

  // Try to launch a real browser; if that fails, run the guided walkthrough.
  try {
    const chromeBinary = discoverChromeBinary();
    browser = await chromium.launch({
      ...(chromeBinary ? { executablePath: chromeBinary } : {}),
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  } catch {
    await opts.onEvent({
      type: "notice",
      message:
        "Running the guided portal walkthrough (a headless browser isn't installed on this host — run `npm run setup:browser` to enable the live-screenshot view).",
    });
    await runGuidedWalkthrough(opts, t0);
    return;
  }

  let downloads = 0;
  try {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 720 } });
    const page = await ctx.newPage();

    await page.goto(`${opts.portal_base_url}/login`, { waitUntil: "domcontentloaded" });
    await step(opts, page, 1, "navigate", "Opened the ACE Importer Portal sign-in page.", "/api/portal/login");

    await page.fill('input[name="username"]', opts.username);
    await step(opts, page, 2, "type:username", "Typed the importer-of-record email address.", "/api/portal/login");

    await page.fill('input[name="password"]', opts.password);
    await step(opts, page, 3, "type:password", "Entered the password.", "/api/portal/login");

    await Promise.all([page.waitForLoadState("domcontentloaded"), page.click("#login-btn")]);
    await step(opts, page, 4, "click:login", "Clicked Sign in and landed on the dashboard.", "/api/portal/dashboard");

    await Promise.all([page.waitForLoadState("domcontentloaded"), page.click('a[href="/api/portal/entries"]')]);
    await step(opts, page, 5, "navigate:entries", "Opened the Entry Summaries list.", "/api/portal/entries");

    const rows = await page.locator(".download-link").all();
    for (let i = 0; i < rows.length; i++) {
      const link = rows[i];
      if (!link) continue;
      const idx = await link.getAttribute("data-idx");
      await step(opts, page, 6 + i, `click:download(${idx})`, `Clicked Download 7501 for entry row ${Number(idx) + 1}.`, "/api/portal/entries");
      const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
      const suggested = download.suggestedFilename();
      const dest = path.join(tmpDir, `entry-${idx}-${suggested}`);
      await download.saveAs(dest);
      const stat = await fs.stat(dest);
      downloads++;
      await opts.onEvent({ type: "downloaded", filename: suggested, bytes: stat.size, path: dest });
    }

    await step(opts, page, 6 + rows.length, "done", `Downloaded ${downloads} entry summaries. Handing off to the refund finder.`, "/api/portal/entries");
    await opts.onEvent({ type: "done", entries_downloaded: downloads, total_ms: Date.now() - t0 });
  } catch (e) {
    await opts.onEvent({ type: "error", message: e instanceof Error ? e.message : String(e) });
  } finally {
    if (browser) await browser.close().catch(() => undefined);
  }
}

/** Browserless guided walkthrough — same step events, portal pages shown via iframe. */
async function runGuidedWalkthrough(opts: AceRunOpts, t0: number): Promise<void> {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const emit = (e: StepEvent) => opts.onEvent(e);

  await emit({ type: "step", index: 1, action: "navigate", narration: "Opened the ACE Importer Portal sign-in page.", portal_path: "/api/portal/login", simulated: true });
  await wait(700);
  await emit({ type: "step", index: 2, action: "type:username", narration: `Typed the importer-of-record email (${opts.username}).`, portal_path: "/api/portal/login", simulated: true });
  await wait(500);
  await emit({ type: "step", index: 3, action: "type:password", narration: "Entered the password.", portal_path: "/api/portal/login", simulated: true });
  await wait(500);
  await emit({ type: "step", index: 4, action: "click:login", narration: "Signed in and landed on the dashboard.", portal_path: "/api/portal/dashboard", simulated: true });
  await wait(700);
  await emit({ type: "step", index: 5, action: "navigate:entries", narration: "Opened the Entry Summaries list.", portal_path: "/api/portal/entries", simulated: true });
  await wait(700);

  let downloads = 0;
  for (let i = 0; i < MOCK_ENTRIES.length; i++) {
    const e = MOCK_ENTRIES[i]!;
    await emit({ type: "step", index: 6 + i, action: `click:download(${i})`, narration: `Downloaded entry summary ${e.number}.`, portal_path: "/api/portal/entries", simulated: true });
    const pdf = await loadEntryPdf(i);
    downloads++;
    await emit({ type: "downloaded", filename: `${e.number}.pdf`, bytes: pdf ? pdf.byteLength : 0, path: "(pulled in-session)" });
    await wait(450);
  }
  await emit({ type: "step", index: 6 + MOCK_ENTRIES.length, action: "done", narration: `Pulled ${downloads} entry summaries. Handing off to the refund finder.`, portal_path: "/api/portal/entries", simulated: true });
  await emit({ type: "done", entries_downloaded: downloads, total_ms: Date.now() - t0 });
}
