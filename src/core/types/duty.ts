// TODO(CLAUDE.md §3 "Duty calculator"):
//   Deterministic math. No LLM calls in this code path. All monetary values in cents.

export interface DutyComponent {
  kind:
    | "ad_valorem"
    | "section_301"
    | "section_232"
    | "reciprocal"
    | "antidumping"
    | "countervailing"
    | "mpf"
    | "hmf"
    | "fta_preference"; // negative amount if savings
  ratePercent: number | null; // null for fixed-fee components
  amountCents: number;
  sourceCitation: string; // e.g., "USTR Section 301 List 4A"
}

export interface DutyCalculation {
  lineItemId: string;
  customsValueCents: number;
  components: DutyComponent[];
  totalDutyCents: number;
  calculatedAt: string;
  rateTableVersion: string; // versioned tariff table snapshot
}
