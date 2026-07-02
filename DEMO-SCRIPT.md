# ShipTrack — Customer Demo Script

_Refreshed 2026-07-03 on the final gpt-5.4-mini corpus (after the PO-list-split fix). All shipments verified clean; consignee/party names resolve to real companies and ~50% of shipments auto-confirm._

## Before you start
- **App:** http://localhost:5173  (backend :3000 + frontend both running)
- **Login:** `admin@cobalt.hk` / `cobalt`  (or `super@cobalt.hk` / `cobalt` for Settings)
- Land on the **Dashboard**, then open shipments via the links below.

## Suggested flow (≈10–12 min)
1. **Dashboard** — active shipments, at-risk, alerts, new emails.
2. **Galeries Lafayette** — clean end-to-end record + alert (recognisable brand).
3. **United Legwear** — sailed shipment, alert, multi-PO.
4. **Fenix Outdoor (air)** — air freight with IATA codes + 12 POs on one booking.
5. **Benetton (air)** — another IATA air route (Dhaka→Milan); if asked "what if the AI is unsure?", it's in review → show the Review Queue.

---

## ⭐ Galeries Lafayette (Magasins Galeries Lafayette)
http://localhost:5173/shipments/cf5c81ac-838d-4441-bd1a-f3bb81f06961
- Yantian → Le Havre · SEA-LCL · CEVA Freight · 3 POs · active alert · consignee **Magasins Galeries Lafayette** (real company, resolved from the email).
- Show the full Order Details, Customer POs, milestone timeline, and the alert. Recognisable French department store — strong opener.

## United Legwear & Apparel UK
http://localhost:5173/shipments/983d6ba6-7038-4074-b81b-e77f3d917b0f
- Shenzhen → Felixstowe · SEA-LCL · **Sailed** · ShipAir · 3 POs · active alert. Clean sailed shipment with proactive monitoring.

## Fenix Outdoor — air freight + PO linkage
http://localhost:5173/shipments/1a8545b9-fadc-4d7c-9ecc-2fd8be2f7f07
- Hong Kong **HKG** → Dubai **DXB** · AIR · **12 POs on one booking**. Shows airport (IATA) codes on air legs *and* the strongest PO-linkage view.

## Benetton — air, and the Review-Queue demo
http://localhost:5173/shipments/4a034a81-ae92-41b3-ab2e-5e4d4969188f
- Dhaka **DAC** → Milan **MXP** · AIR · consignee **Benetton Operations S.R.L.** · in **review**. Recognisable Italian brand, and a natural way to show the human-in-the-loop Review Queue: plain-language reason chips + the Conflicting-values panel with source emails one click away.

## American Eagle (AEO)
http://localhost:5173/shipments/8ab5eb7c-b091-40c2-8017-4b66714dd471
- **Chittagong, Bangladesh → Singapore** · Sailed · APL Logistics · active alert. A non-China origin for the "global coverage" point.

---

## Feature checklist
- **Dashboard KPIs** · **Order Details** (fully populated) · **Customer POs** (Fenix = 12) · **Milestone timeline** · **Alerts** · **Change History** (traced to source emails) · **Air IATA vs sea UN/LOCODE** · **Review Queue** (conflict cross-check).

## If asked "how accurate is the extraction?"
"We run a recent extraction model — consignee/party names, forwarders and document numbers come through as real values, ~half the shipments auto-post, and anything ambiguous is held for a quick human check with the evidence attached."

## Notes
- Local links (this laptop). From another machine, swap `localhost` for its IP.
- Data regenerated 2026-07-03 — IDs differ from earlier bookmarks; use the links above.
