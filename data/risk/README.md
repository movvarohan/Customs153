# Risk screening lists

This directory holds three publicly-available federal screening lists used by
`src/core/agents/risk-screener.ts`. All files are CSV with the schemas below.
All are free, no authentication, refreshable at any time with
`npm run risk:fetch`.

## `ofac-sdn.csv` — OFAC Specially Designated Nationals
- Source: <https://www.treasury.gov/ofac/downloads/sdn.csv>
- Updated: daily by US Treasury
- Use: blocks any US person from doing business with the named party
- Schema: `uid,name,sdn_type,program,title,call_sign,vess_type,tonnage,grt,vess_flag,vess_owner,remarks`

The full list is ~12,000 rows. The committed subset is a hand-picked
representative cross-section (~120 rows) so the demo can run without
network. To get the full live list, run `npm run risk:fetch`.

## `bis-entity-list.csv` — BIS Entity List
- Source: <https://www.bis.doc.gov/index.php/policy-guidance/lists-of-parties-of-concern/entity-list>
  (download as CSV via <https://api.trade.gov/static/consolidated_screening_list/consolidated.csv>)
- Updated: weekly by US Commerce Department
- Use: requires a license for export to the named party
- Schema: `entity_number,name,alt_names,addresses,country,federal_register_notice,end_user_review_committee_decision_date,license_requirement,license_policy`

Committed subset is ~80 representative rows.

## `uflpa-entity-list.csv` — Uyghur Forced Labor Prevention Act Entity List
- Source: <https://www.dhs.gov/uflpa-entity-list>
  (the DHS publishes the names as PDF; this CSV is the structured extract)
- Updated: irregularly by DHS Forced Labor Enforcement Task Force
- Use: rebuttable presumption that imports of certain goods from these
  entities involve forced labor, banning entry under 19 USC §1307
- Schema: `entry_number,name,address,city,province,country,sector,added_date,sublist`
- Sublists: "List 1" (manufactures using forced labor), "List 2" (sources
  material from XUAR), "List 3" (works with the Xinjiang government's
  labor-transfer program), "List 4" (Mining)

The full list as of mid-2026 is ~80 entities. Committed in full.

## XUAR scrutiny regions (`uflpa-regions.json`)
A small hand-curated map of cities / prefectures in the Xinjiang Uyghur
Autonomous Region (and a handful of relocation sites) used for the "address
in scrutiny region" check. Pattern based on public reporting; this is not
itself a federal list. Used to surface a broker-review recommendation, not
to block.
