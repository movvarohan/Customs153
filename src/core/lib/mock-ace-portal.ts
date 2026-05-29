// Mock ACE Importer Portal — server-side HTML pages so the demo browser
// agent has something realistic to drive.
//
// In production the agent points at the actual ACE Importer Portal
// (live, with importer SSO + the per-importer entry summary list). For a
// local demo we serve our own pages that mimic ACE's structure: a login
// screen, a dashboard, an entry-summary list, and per-entry "Download
// PDF" links that serve back the canned sample 7501s in repo. The
// browser agent doesn't know the difference — it navigates by selector
// text the same way it would on the real portal.

import { promises as fs } from "node:fs";
import path from "node:path";

const VALID_USER = "imports@atlasretail.com";
const VALID_PASS = "Atl@s2026!";
const IMPORTER_NAME = "Atlas Retail Holdings LLC";

const PAGE_CSS = `
  body { font-family: -apple-system, system-ui, sans-serif; margin: 0; background: #f3f4f6; color: #0f2c4d; }
  .topbar { background: #08233e; color: #fff; padding: 12px 24px; display: flex; align-items: center; justify-content: space-between; }
  .topbar .brand { font-weight: 700; letter-spacing: .12em; font-size: 13px; text-transform: uppercase; }
  .topbar .seal { font-size: 11px; color: #93c5fd; }
  main { max-width: 960px; margin: 24px auto; padding: 24px; background: #fff; border: 1px solid #e5e7eb; }
  h1 { font-size: 22px; margin: 0 0 12px; }
  h2 { font-size: 15px; margin: 18px 0 8px; color: #4b5563; }
  label { display: block; font-size: 11px; margin-bottom: 4px; color: #6b7280; text-transform: uppercase; letter-spacing: .1em; }
  input[type=text], input[type=password] { width: 280px; padding: 8px; border: 1px solid #d1d5db; font-size: 14px; }
  button { background: #2a7f62; color: #fff; padding: 8px 16px; font-size: 14px; border: 0; cursor: pointer; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #e5e7eb; }
  th { background: #f3f4f6; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #6b7280; }
  a { color: #2a7f62; text-decoration: none; }
  .nav a { color: #fff; margin-left: 20px; font-size: 13px; }
  .pill { background: #eef2ff; color: #3730a3; padding: 2px 8px; border-radius: 999px; font-size: 11px; }
`;

function shell(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>${title} — ACE Importer Portal</title>
<style>${PAGE_CSS}</style></head>
<body>
  <div class="topbar">
    <div>
      <span class="brand">ACE Importer Portal</span>
      <span class="nav"><a href="/api/portal/dashboard">Dashboard</a><a href="/api/portal/entries">Entry Summaries</a></span>
    </div>
    <span class="seal">CBP · U.S. Customs and Border Protection · Automated Commercial Environment</span>
  </div>
  <main>${body}</main>
</body></html>`;
}

export function renderLogin(error?: string): string {
  return shell(
    "Sign in",
    `
    <h1>Sign in to the Importer Portal</h1>
    <p>Connect to your importer-of-record account to access entry summaries and history.</p>
    ${error ? `<p style="color:#b91c1c;font-size:13px;">${error}</p>` : ""}
    <form method="POST" action="/api/portal/login">
      <h2>Credentials</h2>
      <label>Email</label>
      <input type="text" name="username" autocomplete="off" />
      <div style="height:8px"></div>
      <label>Password</label>
      <input type="password" name="password" />
      <div style="height:14px"></div>
      <button id="login-btn" type="submit">Sign in</button>
    </form>
  `,
  );
}

export function renderDashboard(): string {
  return shell(
    "Dashboard",
    `
    <h1>${IMPORTER_NAME}</h1>
    <p>Welcome to the ACE Importer Portal. <a href="/api/portal/entries">View your entry summaries →</a></p>
    <h2>Quick links</h2>
    <ul>
      <li><a href="/api/portal/entries">Entry Summaries (last 12 months)</a></li>
      <li><a href="#">CF 28 / CF 29 Notices</a></li>
      <li><a href="#">Liquidation Status</a></li>
      <li><a href="#">Statement Reconciliation</a></li>
    </ul>
  `,
  );
}

export interface MockEntry {
  number: string;
  entryDate: string;
  port: string;
  declaredValue: string;
  fileName: string; // matches a real 7501-style PDF we serve
}

export const MOCK_ENTRIES: MockEntry[] = [
  { number: "CN-AMA-7195891-13", entryDate: "2025-07-31", port: "Los Angeles, CA", declaredValue: "$48,250.00", fileName: "shenzhen-electronics.pdf" },
  { number: "CN-AMA-5248288-09", entryDate: "2025-06-12", port: "Long Beach, CA", declaredValue: "$22,910.00", fileName: "shenzhen-electronics.pdf" },
  { number: "IN-ATL-1182943-02", entryDate: "2025-05-04", port: "Newark, NJ", declaredValue: "$18,260.00", fileName: "india-houseware.pdf" },
];

export function renderEntries(): string {
  return shell(
    "Entry Summaries",
    `
    <h1>Entry Summaries</h1>
    <p>${MOCK_ENTRIES.length} entries in the last 12 months. <button id="download-all-btn">Download all (PDF)</button></p>
    <table>
      <thead><tr>
        <th>Entry No.</th><th>Entry Date</th><th>Port</th><th>Declared Value</th><th>PDF</th>
      </tr></thead>
      <tbody>
        ${MOCK_ENTRIES.map(
          (e, i) => `
        <tr>
          <td><span class="pill">${e.number}</span></td>
          <td>${e.entryDate}</td>
          <td>${e.port}</td>
          <td>${e.declaredValue}</td>
          <td><a class="download-link" data-idx="${i}" href="/api/portal/entry/${i}/pdf" download>Download 7501</a></td>
        </tr>`,
        ).join("")}
      </tbody>
    </table>
  `,
  );
}

export function isValidLogin(username: string | null, password: string | null): boolean {
  return username === VALID_USER && password === VALID_PASS;
}

export async function loadEntryPdf(index: number): Promise<Buffer | null> {
  const e = MOCK_ENTRIES[index];
  if (!e) return null;
  const samplesDir = path.resolve(process.cwd(), "data/sample-invoices");
  try {
    return await fs.readFile(path.join(samplesDir, e.fileName));
  } catch {
    return null;
  }
}
