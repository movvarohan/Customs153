import { describe, it, expect } from "vitest";
import { extractReasoningSoFar } from "@/core/agents/classifier";

// The classifier streams its tool_use input JSON; `reasoning` is the first
// property so its value streams first. extractReasoningSoFar decodes the
// in-flight prefix from a partial JSON buffer — this is what powers the
// live token-by-token reasoning view.
describe("extractReasoningSoFar", () => {
  it("returns null before the reasoning key has streamed", () => {
    expect(extractReasoningSoFar('{"cita')).toBeNull();
    expect(extractReasoningSoFar("")).toBeNull();
  });

  it("returns the decoded prefix while the string value is still open", () => {
    expect(extractReasoningSoFar('{"reasoning":"Step 1 — identify')).toBe("Step 1 — identify");
  });

  it("decodes escaped quotes and newlines", () => {
    expect(extractReasoningSoFar('{"reasoning":"heading \\"8518\\" applies')).toBe('heading "8518" applies');
    expect(extractReasoningSoFar('{"reasoning":"line one\\nline two"}')).toBe("line one\nline two");
  });

  it("stops at the closing quote when the value is complete", () => {
    expect(extractReasoningSoFar('{"reasoning":"done","hts_code":"8518.30.20.00"}')).toBe("done");
  });

  it("waits on an incomplete trailing escape instead of mis-decoding", () => {
    // trailing backslash with no escape char yet -> decode up to it, not past
    expect(extractReasoningSoFar('{"reasoning":"abc\\')).toBe("abc");
  });
});
