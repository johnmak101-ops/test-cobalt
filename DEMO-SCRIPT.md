# ShipTrack — Customer Demo Script

_Refreshed 2026-07-03. Storyline-driven: each shipment below is **confirmed**, **verified coherent** (its emails genuinely describe one shipment — no over-merge), and sits at a **different point of the shipment lifecycle** so you can walk the whole journey. IDs are current for this dataset._

## Before you start
- **App:** http://localhost:5173  (backend :3000 + frontend both running)
- **Login:** `admin@cobalt.hk` / `cobalt`  (or `super@cobalt.hk` / `cobalt` for Settings)
- Open the **Milestone Timeline** + the **Alerts & Emails** / **Change History** tabs on each — that's where the lifecycle shows.

## The story: one shipment's lifecycle
ShipTrack tracks every shipment up a 6-stage staircase, driven automatically by the emails as they arrive:

**Booked → Confirmed (SO) → At Warehouse → Sailed → Released (B/L) → Delivered**

The demo below walks four real shipments, each parked at a different stage, so the customer sees the full arc from a fresh booking to cargo released.

## Suggested flow (≈10–12 min)
1. **Dashboard** — active shipments, at-risk, alerts, new emails.
2. **LF Corp** — a *fresh booking* with its whole planned timeline.
3. **United Legwear** ⭐ — *on the water*: warehouse-in → sailed → Draft B/L → invoice.
4. **NEW LOBSTER** — *released*: Final B/L issued (the far end of the staircase).
5. **ALO Yoga (air)** — the same lifecycle for **air freight** (airport codes + AWB/MAWB).

---

## 1. LF Corp — a fresh booking (the plan) 🟦 *Booked / At Warehouse*
http://localhost:5173/shipments/2ca9331c-6fd7-411d-a754-3bb524e94450
- **Shenzhen (CNSZX) → Incheon, Korea (KRINC)** · SEA-LCL · **LX Pantos Logistics** · vessel **YOKOHAMA TRADER**.
- Booking **PLISZ4H11116** · SO **FENLSO003045** · consignee **LF Corp** (Li & Fung).
- **Why it's a good opener:** the whole planned timeline is already populated — **Cargo Ready → Warehouse-in → ETD → ATD → ETA** — from a single Booking Request email. Show the Milestone Timeline: this is a shipment the moment it's booked.

## 2. United Legwear ⭐ — on the water 🟧 *Sailed + Draft B/L*
http://localhost:5173/shipments/cd5b8ca0-826a-415c-8cdd-eabd8851c1ab
- **Shekou/Shenzhen (CNSZX) → Felixstowe, UK (GBFXT)** · SEA-LCL · **ShipAir Express** · vessel **EVER AEON** · container **EISU8344532** · HBL **HBLSEC-45301**.
- Consignee **United Legwear & Apparel UK** · booking **SESZX/0865/26/RZ** · 3 POs.
- **The flagship lifecycle view.** Milestone timeline reads **At Warehouse → Sailed → Draft B/L → Invoice** — four stages, built from a Draft-B/L email (ShipAir) and a vendor invoice, *both* referencing "ULUK". Open **Change History** to show each field traced back to the email that set it.

## 3. NEW LOBSTER — released 🟩 *Final B/L*
http://localhost:5173/shipments/31532647-536a-4ca0-be8c-0487cf5003ad
- **Yantian (CNYTN) → Felixstowe, UK (GBFXT)** · SEA-LCL · **ShipAir Express** · vessel **EVER AEON** · HBL **HBLSEC-45295**.
- **The far end of the staircase** — a **Final B/L** has been issued (cargo released). Note it rides the *same vessel + forwarder* as United Legwear with a consecutive HBL (…45295 vs …45301): a real co-load the system tracks as two separate shipments, not one merged blob.

## 4. ALO Yoga (air) — the lifecycle for air freight ✈️
http://localhost:5173/shipments/6cdf82ec-0976-4a8f-b444-55a63116fb87
- **Phnom Penh (PNH) → New York** · **AIR** · **Expeditors International** · AWB **43Y0005819** · MAWB **695-58441552**.
- Consignee **ALO Yoga** · booking **BX839500** · one Expeditors booking thread → **Booking → Departed → Invoice**.
- Shows air handled natively: **airport (IATA) codes** on the origin, the **house AWB + master MAWB** split out correctly, and a major global forwarder.

## Bonus — Brora (recognisable brand + a customs step)
http://localhost:5173/shipments/f6f9699f-f1c4-4483-96f6-494abc91d43b
- **Hong Kong (HKHKG) → Felixstowe, UK (GBFXT)** · SEA-LCL · consignee **Brora Limited** (Scottish cashmere). Its thread includes a **Customs declaration** email — useful if asked "what email types do you handle?"

---

## What to point at on each shipment
- **Milestone Timeline** — the lifecycle staircase, dated automatically from the emails.
- **Order Details** — booking/SO/HBL/MBL/container/vessel, consignee, forwarder, route.
- **Customer POs** — the buyer orders on the shipment.
- **Alerts & Emails** — every source email, click to read the original (Office 365 reading pane).
- **Change History** — every field change traced to the email that made it.

## If asked "how do you know these emails belong to the same shipment?"
"Each shipment is assembled from emails that share a booking / SO / B-L identity — not guessed. Vendor-invoice notifications that only reference a PO are kept as **Documents** (see the Documents tab), not turned into phantom shipments, and anything ambiguous is held in the **Review Queue** with its evidence attached."

## If asked "how accurate is the extraction?"
"Consignees, forwarders and document numbers come through as real values; roughly half of shipments auto-post, and the rest are held for a quick human check — nothing is silently guessed."

## Notes
- These IDs are current for the freshly-rebuilt dataset (2026-07-03). Most shipments in this sample are mid-lifecycle (booked → sailed); NEW LOBSTER is the one that has reached Final B/L.
- CVP vendor-invoice-only "shipments" now live under **Documents**, not the Shipments tracker.
- Local links (this laptop). From another machine, swap `localhost` for its IP.
