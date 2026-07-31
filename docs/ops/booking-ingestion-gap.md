# Booking ingestion gap — why some shipments arrive with missing data

**Symptom (real case, S2600240871A):** a booking's original "NEW BOOKING" email — the one whose
attachment carried the cargo split (e.g. 慧怡/LEFILG 126 ctns / 1504 KG / 9.04 CBM + 天盈/TIKNHO
160 ctns / 1461.4 KG / 11.5 CBM) — never reached the tracker. Only later internal **"RE:" replies** were
ingested (all with `attachment_count = 0`), so the shipment landed with empty qty / gross weight / volume
and two co-current booking numbers (…871A / …871B, one per factory).

## Root cause — structural mail delivery, not a code bug
The poller reads exactly **one mailbox, Inbox folder only**: `CobaltStatusTrack@cobaltknitwear.com`
(Microsoft Graph, app-only). It is a **passive collector** — it can only see a message that Exchange
delivered into that Inbox, which happens only when the tracking address is a **To/Cc recipient** or an
auto-forward rule copies one in.

The original booking email was addressed to a **person ("Yan")**, before the tracking address was on the
thread — so no copy was ever delivered to the ingested Inbox. No folder / filter / delta setting can fetch
a message the mailbox never received. The booking attachment rode only on that original; the replies that
were captured genuinely arrived with no attachment (Outlook replies drop the parent's file), and the
ingest's raw-MIME recovery can only recover an attachment embedded in a message this mailbox *did* receive.

## What's now in place (this change set)
Two safety nets so this is caught, plus a way to recover:
1. **"missing booking attachment" flag** (cobalt-queue gate) — an email that says "please find attached" /
   "请查收附件" but has zero ingested attachments (and no earlier thread message carried one) is routed to
   **human review** with a clear reason.
2. **"missing cargo" flag** (track-system committer) — a booked leg that names a cargo unit but has no
   qty / weight / volume is routed to review: *"Cargo quantity / weight / volume is missing — the booking
   attachment was likely never captured."*
3. **Manual "New shipment"** (Shipment Tracker → New shipment) — a human can create the shipment the
   pipeline missed. It's minted through the committer, so a later email upserts into it (no duplicate) and
   the entered fields are locked — which records what the human typed, not a block on the agent: a later
   email that disagrees overwrites the column and the field surfaces as contested for someone to resolve.

## The actual fix — mail-flow (best-first; code alone can't recover an undelivered message)
1. **Process (do this first):** have factories/forwarders always **Cc `CobaltStatusTrack@cobaltknitwear.com`**
   (or `CobaltShipment@`, which auto-forwards in) on the **original** "NEW BOOKING" email — not just the
   internal repliers. This puts the original + its attachment directly in the ingested Inbox.
2. **Forward-as-attachment intake (code — shipped):** when staff receive an original booking, forward it
   **as an attachment** (`.eml` / `.msg`) to the tracking mailbox. Normalize now detects `.eml` /
   `message/rfc822` (and already-handled `.msg`) and recurses: body text + child attachments (booking
   PDF/Excel) become their own queue parts for the parser.
3. **Exchange transport/journal rule:** copy factory-domain / "NEW BOOKING"-subject mail into the Inbox.
4. **Manual re-ingest (dev CLI — shipped):** export the missing original as `.eml` or `.msg` and run:
   `pnpm exec tsx src/dev/ingest-msg.ts <dir|file>` on the Agent VM (accepts both extensions).
   Filename is the dedup key (`mock:<fname>`). Full HTTP upload API still optional if ops want a UI.

**Preferred order:** (1) process Cc first → (2)/(4) for already-missed originals → (3) if volume justifies.
