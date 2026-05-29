import { describe, it, expect } from "vitest";
import { isValidLogin, MOCK_ENTRIES, renderLogin, renderEntries } from "@/core/lib/mock-ace-portal";

describe("ACE portal replica", () => {
  it("accepts the importer credentials and rejects others", () => {
    expect(isValidLogin("imports@atlasretail.com", "Atl@s2026!")).toBe(true);
    expect(isValidLogin("imports@atlasretail.com", "wrong")).toBe(false);
    expect(isValidLogin(null, null)).toBe(false);
  });

  it("exposes entries that each map to a backing PDF", () => {
    expect(MOCK_ENTRIES.length).toBeGreaterThan(0);
    for (const e of MOCK_ENTRIES) {
      expect(e.number).toMatch(/[A-Z]{2}-[A-Z]{3}-\d+-\d+/);
      expect(e.fileName).toMatch(/\.pdf$/);
    }
  });

  it("renders pages without leaking 'demo' wording", () => {
    const login = renderLogin();
    const entries = renderEntries();
    expect(login).toContain("Sign in");
    expect(entries).toContain("Entry Summaries");
    expect(login.toLowerCase()).not.toContain("demo");
    expect(entries.toLowerCase()).not.toContain("demo");
  });
});
