// Inbound shipment coordination.
//
// A customs broker sits between the freight forwarder, the ocean carrier, the
// drayage trucker, and the warehouse — and the entry has hard timing rules:
//   - ISF (10+2) must be filed >= 24h before the vessel is loaded at origin
//   - the CBP entry is filed before/at arrival
//   - customs release gates the trucker's pickup
//   - the container has a "last free day" before demurrage accrues
// This models each in-flight shipment's milestone chain deterministically from
// its ETD/ETA, derives where it is today, who owns the next action, and which
// hard deadlines are at risk. No LLM — fast and reliable.

const DAY = 24 * 60 * 60 * 1000;

export type Party = "Freight forwarder" | "Ocean carrier" | "Customs broker" | "CBP" | "Drayage trucker" | "Warehouse";
export type MilestoneStatus = "done" | "in_progress" | "next" | "upcoming" | "at_risk";

export interface Milestone {
  key: string;
  label: string;
  party: Party;
  date: string;            // target/expected date
  deadline: string | null; // hard deadline, if any
  rule_note: string | null;
  status: MilestoneStatus;
}

export interface NextAction {
  label: string;
  party: Party;
  due: string;
  days_left: number;
  urgency: "urgent" | "soon" | "ok";
}

export interface Shipment {
  id: string;
  supplier: string;
  product: string;
  container: string;
  carrier: string;
  vessel: string;
  origin_port: string;
  dest_port: string;
  etd: string;
  eta: string;
  transit_days: number;
  last_free_day: string;
  demurrage_risk: boolean;
  current_stage: string;
  next_action: NextAction | null;
  milestones: Milestone[];
}

export interface CoordinationResult {
  importer: string;
  as_of: string;
  summary: {
    in_flight: number;
    actions_due: number;       // shipments with an action due within 3 days
    at_risk: number;           // shipments with an at-risk hard deadline
    awaiting_release: number;
    demurrage_risk: number;
  };
  shipments: Shipment[];
}

interface Template {
  id: string;
  supplier: string;
  product: string;
  container: string;
  carrier: string;
  vessel: string;
  origin_port: string;
  dest_port: string;
  /** ETD relative to today, in days (negative = already departed). */
  etd_offset: number;
  transit_days: number;
  /** Optional: a milestone the shipment is stuck on (held despite its target
   *  date passing) — e.g. drayage waiting on the trucker → demurrage risk. */
  stuck_at?: string;
}

// A spread of shipments at different lifecycle stages so the whole chain shows:
// awaiting ISF, in transit, arriving soon, at port needing drayage, delivered.
const TEMPLATES: Template[] = [
  { id: "SHP-2026-0418", supplier: "Goertek Vina (Bắc Ninh)", product: "Wireless TWS earbuds, 12,000 units", container: "MSKU7741203 · 40HC", carrier: "ONE", vessel: "ONE Olympus 014E", origin_port: "Haiphong, VN", dest_port: "Long Beach, CA", etd_offset: -3, transit_days: 21 },
  { id: "SHP-2026-0421", supplier: "Dongguan Houseware Co.", product: "PP storage containers, 8,400 sets", container: "TGHU5520981 · 40GP", carrier: "Maersk", vessel: "Maersk Emden 118W", origin_port: "Yantian, CN", dest_port: "Los Angeles, CA", etd_offset: 4, transit_days: 18 },
  { id: "SHP-2026-0409", supplier: "Sihitek (Hanoi)", product: "USB-C cables + chargers, 30,000 units", container: "CMAU4419087 · 40HC", carrier: "CMA CGM", vessel: "CMA CGM Lisa 207E", origin_port: "Haiphong, VN", dest_port: "Long Beach, CA", etd_offset: -12, transit_days: 16 },
  { id: "SHP-2026-0395", supplier: "Shenzhen Aurora Electronics", product: "20W wall chargers, 15,000 units", container: "OOLU8830142 · 40GP", carrier: "OOCL", vessel: "OOCL Texas 091E", origin_port: "Yantian, CN", dest_port: "Long Beach, CA", etd_offset: -19, transit_days: 16, stuck_at: "drayage" },
  { id: "SHP-2026-0372", supplier: "Nanobot Solutions (Maharashtra)", product: "Stainless insulated bottles, 6,000 units", container: "HLCU6612340 · 40HC", carrier: "Hapag-Lloyd", vessel: "Hapag Chennai Express 33W", origin_port: "Nhava Sheva, IN", dest_port: "New York, NY", etd_offset: -34, transit_days: 26 },
];

function iso(d: Date): string { return d.toISOString().slice(0, 10); }
function daysBetween(a: Date, b: Date): number { return Math.round((b.getTime() - a.getTime()) / DAY); }

export function computeCoordination(importer: string, asOf: Date = new Date()): CoordinationResult {
  const t0 = new Date(iso(asOf)); // normalize to midnight UTC

  const shipments: Shipment[] = TEMPLATES.map((t) => {
    const etd = new Date(t0.getTime() + t.etd_offset * DAY);
    const eta = new Date(etd.getTime() + t.transit_days * DAY);
    const lastFreeDay = new Date(eta.getTime() + 4 * DAY);

    // Build the milestone chain with target dates + hard deadlines.
    const raw: Array<{ key: string; label: string; party: Party; date: Date; deadline: Date | null; rule: string | null }> = [
      { key: "booking", label: "Cargo booked", party: "Freight forwarder", date: new Date(etd.getTime() - 21 * DAY), deadline: null, rule: null },
      { key: "isf", label: "ISF (10+2) filed", party: "Customs broker", date: new Date(etd.getTime() - 2 * DAY), deadline: new Date(etd.getTime() - 1 * DAY), rule: "Due ≥24h before vessel loading" },
      { key: "etd", label: "Vessel departs", party: "Ocean carrier", date: etd, deadline: null, rule: null },
      { key: "entry", label: "CBP entry filed", party: "Customs broker", date: new Date(eta.getTime() - 2 * DAY), deadline: eta, rule: "Filed before arrival" },
      { key: "eta", label: "Vessel arrives", party: "Ocean carrier", date: eta, deadline: null, rule: null },
      { key: "release", label: "Customs release", party: "CBP", date: new Date(eta.getTime() + 1 * DAY), deadline: null, rule: null },
      { key: "drayage", label: "Drayage pickup", party: "Drayage trucker", date: new Date(eta.getTime() + 2 * DAY), deadline: lastFreeDay, rule: "Last free day before demurrage" },
      { key: "delivered", label: "Delivered to FBA / warehouse", party: "Warehouse", date: new Date(eta.getTime() + 4 * DAY), deadline: null, rule: null },
    ];

    // If the shipment is stuck on a milestone, treat that as the current step
    // even though its target date has passed (e.g. trucker congestion).
    const stuckIdx = t.stuck_at ? raw.findIndex((m) => m.key === t.stuck_at) : -1;
    const firstUndoneIdx = stuckIdx >= 0 ? stuckIdx : raw.findIndex((m) => t0 < m.date);

    const milestones: Milestone[] = raw.map((m, i) => {
      let status: MilestoneStatus;
      if (i < firstUndoneIdx) status = "done";
      else if (i === firstUndoneIdx) status = "next";
      else status = "upcoming";
      if (i === firstUndoneIdx && i !== stuckIdx && t0 >= m.date) status = "done"; // edge: nothing left
      // In-transit window: between departure and arrival.
      if (m.key === "eta" && status !== "done" && t0 >= etd && t0 < eta) status = "in_progress";
      // At-risk: this is the current step, has a hard deadline within 1 day or
      // already passed (the stuck case forces this).
      if (i === firstUndoneIdx && m.deadline) {
        const dl = daysBetween(t0, m.deadline);
        if (dl <= 1) status = "at_risk";
      }
      return {
        key: m.key, label: m.label, party: m.party,
        date: iso(m.date), deadline: m.deadline ? iso(m.deadline) : null, rule_note: m.rule, status,
      };
    });

    const nextM = raw[firstUndoneIdx];
    let next_action: NextAction | null = null;
    if (nextM) {
      const due = nextM.deadline ?? nextM.date;
      const daysLeft = daysBetween(t0, due);
      next_action = {
        label: nextM.label,
        party: nextM.party,
        due: iso(due),
        days_left: daysLeft,
        urgency: daysLeft <= 1 ? "urgent" : daysLeft <= 3 ? "soon" : "ok",
      };
    }

    const drayMs = raw.find((m) => m.key === "drayage")!;
    const drayDone = stuckIdx >= 0 && t.stuck_at === "drayage" ? false : t0 >= drayMs.date;
    const demurrage_risk = !drayDone && t0 >= new Date(lastFreeDay.getTime() - 1 * DAY) && t0 >= eta;

    const currentStage = nextM ? nextM.label : "Delivered";

    return {
      id: t.id, supplier: t.supplier, product: t.product, container: t.container,
      carrier: t.carrier, vessel: t.vessel, origin_port: t.origin_port, dest_port: t.dest_port,
      etd: iso(etd), eta: iso(eta), transit_days: t.transit_days,
      last_free_day: iso(lastFreeDay), demurrage_risk,
      current_stage: currentStage, next_action, milestones,
    };
  });

  // Sort: at-risk / soonest action first; delivered last.
  shipments.sort((a, b) => {
    const ar = a.next_action?.days_left ?? 9999;
    const br = b.next_action?.days_left ?? 9999;
    return ar - br;
  });

  return {
    importer,
    as_of: iso(t0),
    summary: {
      in_flight: shipments.filter((s) => s.next_action !== null).length,
      actions_due: shipments.filter((s) => s.next_action && s.next_action.days_left <= 3).length,
      at_risk: shipments.filter((s) => s.milestones.some((m) => m.status === "at_risk")).length,
      awaiting_release: shipments.filter((s) => s.current_stage === "Customs release").length,
      demurrage_risk: shipments.filter((s) => s.demurrage_risk).length,
    },
    shipments,
  };
}
