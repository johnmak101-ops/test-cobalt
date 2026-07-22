# ShipTrack — Intelligent Shipping Operations Dashboard

## 1. Executive Summary

**ShipTrack** is an AI-powered shipping operations platform for **Cobalt Knitwear**, a garment manufacturer based in Hong Kong/Shenzhen. The system monitors shipping communications with freight forwarders, automatically extracts key data from emails, tracks shipment milestones, and proactively alerts the operations team when expected communications are overdue.

The platform transforms fragmented email-based shipping coordination into a structured, searchable, and actionable operations hub—reducing manual data entry, eliminating missed deadlines, and providing end-to-end visibility from booking to delivery.

---

## 2. User Personas

### 2.1 Primary: Sunny — Operations Coordinator

**Profile:**
- 5 years in garment shipping operations
- Monitors 40-60 active shipments daily
- Uses Excel, email, WhatsApp constantly
- First point of contact when customers ask "where is my order?"

**Pain Points:**
- Spends 2+ hours daily searching emails for shipping information
- Manually copies booking details from emails into spreadsheets
- Misses export document deadlines when emails get buried
- No single view of which shipments need attention today

**User Story:**
> "As an Operations Coordinator, I want to see all shipping emails automatically parsed and organized by PO number, so that I can quickly find booking details without searching through hundreds of emails."

**Acceptance Criteria:**
- All shipping emails appear in unified inbox within 5 minutes of receipt
- AI extracts: booking number, HBL#, vessel name, ETD, ETA
- PO numbers are linked to their corresponding shipments
- Dashboard shows "Alerts Requiring Attention" prominently
- Can search by PO# and get answer in < 10 seconds

**Values:** Speed, accuracy, no surprises

---

### 2.2 Secondary: Amon — Operations Manager

**Profile:**
- 12 years in logistics operations
- Reviews overall shipping performance weekly
- Escalation point for delayed shipments
- Responsible for forwarder relationships

**Pain Points:**
- Learns about booking confirmations days after they arrive
- No single view of all active shipments across customers
- Delays are discovered reactively, not proactively
- Can't easily identify which forwarders are causing problems

**User Story:**
> "As an Operations Manager, I want a real-time dashboard showing all active shipments with their current status, so that I can identify potential delays before they impact customers."

**Acceptance Criteria:**
- Dashboard shows all shipments in pipeline (booked → in transit → delivered)
- Color-coded status: Green (on track), Yellow (at risk), Red (delayed)
- Click into any shipment for full timeline and documents
- Configure alert thresholds without code changes
- Weekly summary of alerts and resolutions

**Values:** Trends, accountability, process improvement

---

### 2.3 IT Administrator: Amon (also)

**Profile:**
- Manages Cobalt's internal systems
- Expert technical skills

**Pain Points:**
- No central system for shipping data—scattered across emails and spreadsheets
- Email parsing scripts break when forwarders change templates
- Requests from operations for "simple reports" require manual data compilation

**User Story:**
> "As an IT Administrator, I want a centralized shipping data platform with admin controls, so that I can configure alert rules and troubleshoot issues without code changes."

**Acceptance Criteria:**
- Settings UI for configuring alert thresholds
- Audit log of all data changes
- API endpoints for future integration

---

## 3. Objectives

| # | Objective | Success Metric |
|---|-----------|----------------|
| 1 | **AI-Powered Email Extraction** — Automatically extract booking confirmations, HBL#, ETD/ETA, and tracking info from forwarder emails | 95%+ accuracy on structured email extraction |
| 2 | **Real-Time Shipment Visibility** — Provide unified dashboard for all active shipments with status tracking | Any shipment status retrievable in < 10 seconds |
| 3 | **Proactive Alert System** — Alert operations team when expected emails are overdue | Alert triggered 24h+ before deadline missed |
| 4 | **Configurable Thresholds** — Allow operations manager to adjust alert rules without code changes | All 6 alert rules configurable via Settings UI |
| 5 | **Unified Shipping Inbox** — Consolidate all shipping-related emails into a single, searchable hub | 100% of shipping emails automatically captured and parsed |

---

## 4. Data Sources

| Source | Data Type | Integration Method |
|--------|-----------|-------------------|
| Shipping Email Inbox | Booking confirmations, B/L, ETD/ETA, telex | IMAP + AI parsing (Claude) |
| Manual Entry (v1) | PO details, customer info, forwarder | Form input |
| ERP/Order System (v2) | PO details, quantities, customer info | REST API (future) |

---

## 5. Design System

### 5.1 Brand Identity — Cobalt Knitwear

**Primary Colors:**
| Token | Hex | Usage |
|-------|-----|-------|
| `--cobalt-primary` | `#0047BA` | Header bars, primary buttons, active states, logo background |
| `--cobalt-teal` | `#00A884` | Success states, positive indicators, secondary accents |
| `--cobalt-gray` | `#898989` | Neutral backgrounds, muted text, secondary sections |

**Alert Status Colors:**
| Token | Hex | Usage |
|-------|-----|-------|
| `--status-critical` | `#DC2626` | Critical alerts (missed deadlines), red badges |
| `--status-warning` | `#F59E0B` | Warning alerts (approaching deadlines), yellow badges |
| `--status-info` | `#3B82F6` | Informational alerts, blue badges |
| `--status-success` | `#22C55E` | On-track shipments, completed milestones |

**Shipment State Colors:**
| State | Color | Hex |
|-------|-------|-----|
| 🟡 BOOKED | Amber | `#E6A23C` |
| 🟢 CONFIRMED | Green | `#67C23A` |
| 🔵 AT WAREHOUSE | Blue | `#409EFF` |
| 🟣 SAILED | Purple | `#9B59B6` |
| ⚪ RELEASED | Gray | `#909399` |
| ✅ DELIVERED | Green | `#67C23A` |

### 5.2 Typography

| Element | Font | Weight | Size |
|---------|------|--------|------|
| Headings | Quicksand | Medium (500) | 1.25rem - 2.25rem |
| Body | Quicksand | Regular (400) | 0.875rem - 1rem |
| Labels | Quicksand | Medium (500) | 0.75rem |
| Mono/Data | JetBrains Mono | Regular (400) | 0.875rem |

### 5.3 Surfaces (Dark Theme — Default)

| Token | Hex | Usage |
|-------|-----|-------|
| `--bg` | `#050505` | App background |
| `--surface-900` | `#0A0A0A` | Sidebar, top bar |
| `--surface-800` | `#121212` | Cards, panels, modals |
| `--surface-700` | `#1A1A1A` | Inputs, hover states |
| `--border` | `#222222` | Dividers, card borders |
| `--text-primary` | `#FFFFFF` | Headings, active labels |
| `--text-secondary` | `#A1A1AA` | Body text, descriptions |
| `--text-muted` | `#71717A` | Timestamps, metadata |

### 5.4 Surfaces (Light Theme)

| Token | Hex | Usage |
|-------|-----|-------|
| `--bg` | `#FAFAFA` | App background |
| `--surface-900` | `#F0F0F0` | Sidebar, top bar |
| `--surface-800` | `#FFFFFF` | Cards, panels |
| `--border` | `#E0E0E2` | Dividers |
| `--text-primary` | `#0A0A0A` | Headings |
| `--text-secondary` | `#3F3F46` | Body text |

---

## 6. Application Structure

### 6.1 Dashboard (Home)

The main dashboard provides an at-a-glance view of shipping operations.

**Layout:**
```
┌─────────────────────────────────────────────────────────────────────┐
│ HEADER BAR (Cobalt Primary #0047BA)                                 │
│ ┌─────────┐                           [Search] [Alerts 🔔] [User]  │
│ │ COBALT  │   ShipTrack                                            │
│ └─────────┘                                                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌─────────────┐│
│  │ 📦 Active    │ │ ⚠️ At Risk   │ │ 🔴 Critical  │ │ 📧 New      ││
│  │ Shipments    │ │ Shipments    │ │ Alerts       │ │ Emails      ││
│  │     47       │ │      5       │ │      2       │ │     12      ││
│  └──────────────┘ └──────────────┘ └──────────────┘ └─────────────┘│
│                                                                     │
│  ALERTS REQUIRING ATTENTION                            [View All →]│
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ 🔴 CRITICAL  PO# 100-100209  New Lobster UK                     ││
│  │    Cut-off passed — cargo may have missed the vessel           ││
│  │    CFS Cut-off: Feb 3 12:00  •  Last email: 2 days ago         ││
│  ├─────────────────────────────────────────────────────────────────┤│
│  │ ⚠️ WARNING   PO# 2238941     SKIM US West                       ││
│  │    Awaiting departure confirmation                              ││
│  │    Draft B/L received: 5 days ago                               ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                     │
│  RECENT SHIPMENT ACTIVITY                                           │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ PO#         │ Customer    │ Route  │ Status      │ Next Action  ││
│  ├─────────────┼─────────────┼────────┼─────────────┼──────────────┤│
│  │ 100-100209  │ New Lobster │ SZ→UK  │ 🟢 CONFIRMED│ Cargo to CFS ││
│  │ 2238941     │ SKIM        │ SZ→LA  │ 🔵 AT WHSE  │ Departure    ││
│  │ 6131180898  │ Daniels     │ HK→DE  │ 🟣 SAILED   │ Telex Release││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**KPI Cards:**
- Use `--surface-800` background with subtle border
- Icon in Cobalt Primary or status color
- Large number (32px), label below (12px muted)
- Hover: lift with subtle shadow

**Alert Cards:**
- Left border colored by severity (4px solid)
- Badge with severity label (CRITICAL/WARNING/INFO)
- PO#, Customer, and alert message
- Timestamp and "time since" in muted text

---

### 6.2 Shipment Tracker

Full list of all shipments with filtering and search.

**Filters:**
- Status: All / BOOKED / CONFIRMED / AT WAREHOUSE / SAILED / RELEASED / DELIVERED
- Customer: Dropdown with all customers
- Forwarder: Dropdown with all forwarders
- Date Range: ETD range picker
- Alert Status: All / Critical / Warning / On Track

**Table Columns:**
| Column | Width | Content |
|--------|-------|---------|
| PO# | 120px | Primary identifier, clickable |
| Customer | 150px | Brand/retailer name |
| Forwarder | 120px | GFS, JAS, DSV, etc. |
| Route | 80px | SZ→UK, HK→DE format |
| Status | 110px | State badge with color |
| ETD | 100px | Date or "TBD" |
| ETA | 100px | Date or "TBD" |
| Last Activity | 120px | Relative time |
| Alert | 40px | Icon if alert active |

**Row Interaction:**
- Hover: background `--surface-700`
- Click: expand inline detail panel or navigate to shipment detail

---

### 6.3 Shipment Detail View

Full information for a single shipment.

**Layout:**
```
┌─────────────────────────────────────────────────────────────────────┐
│ ← Back to Shipments                                                 │
│                                                                     │
│ PO# 100-100209                              Status: 🟢 CONFIRMED    │
│ New Lobster UK  •  Torque/Shipair  •  SZ → UK                      │
│                                                                     │
├────────────────────────┬────────────────────────────────────────────┤
│                        │                                            │
│  MILESTONE TIMELINE    │  KEY DATES                                 │
│                        │  ┌──────────────────────────────────────┐  │
│  ● Booking Request     │  │ CRD (Cargo Ready)     Feb 3, 2026   │  │
│    Jan 23, 2026        │  │ CFS Cut-off           Feb 3, 12:00  │  │
│         │              │  │ ETD                   Feb 22 (est)  │  │
│  ● SO Received         │  │ ETA                   Mar 27 (est)  │  │
│    Jan 30, 2026        │  └──────────────────────────────────────┘  │
│         │              │                                            │
│  ○ Draft B/L           │  EXTRACTED DATA                            │
│    (Awaiting)          │  ┌──────────────────────────────────────┐  │
│         │              │  │ HBL#:          (pending)             │  │
│  ○ Final B/L           │  │ Vessel:        (pending)             │  │
│         │              │  │ Voyage:        (pending)             │  │
│  ○ Telex Release       │  │ Warehouse:     Yantian CFS Terminal  │  │
│                        │  └──────────────────────────────────────┘  │
│                        │                                            │
├────────────────────────┴────────────────────────────────────────────┤
│                                                                     │
│  RELATED EMAILS                                          [View All] │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ 📧 Jan 30  SO Received  "NLOB UK Torque ID:118997..."          ││
│  │ 📧 Jan 23  Booking Sent "Booking request for New Lobster UK"   ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Milestone Timeline:**
- Vertical timeline with circular nodes
- Completed: filled circle with checkmark, muted text
- Current: filled circle with pulse animation, primary text
- Pending: hollow circle, muted text
- Connecting line between nodes

**Key Dates Card:**
- Grid layout with label/value pairs
- Deadline dates in bold if approaching
- "TBD" for unknown dates in muted

---

### 6.4 Email Inbox (AI-Parsed)

Unified view of all shipping-related emails with AI-extracted data.

**Layout:**
```
┌─────────────────────────────────────────────────────────────────────┐
│ SHIPPING INBOX                                     [Refresh] [Filter]│
├─────────────────────────────────────────────────────────────────────┤
│ Search emails...                                                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│ TODAY                                                               │
│ ┌─────────────────────────────────────────────────────────────────┐│
│ │ 📧 GFS                                              10:32 AM    ││
│ │ HBL NUMBER SZ2C54172564 S00541725 SZXJLAX83545980...            ││
│ │ ┌─────────────────────────────────────────────────────────────┐ ││
│ │ │ AI EXTRACTED:                                               │ ││
│ │ │ Type: Final B/L  •  PO#: 2238941  •  HBL#: SZ2C54172564    │ ││
│ │ │ Vessel: CMA CGM MARCO POLO  •  ETD: Feb 22  •  ETA: Mar 15 │ ││
│ │ │ [Link to Shipment →]                                        │ ││
│ │ └─────────────────────────────────────────────────────────────┘ ││
│ └─────────────────────────────────────────────────────────────────┘│
│                                                                     │
│ YESTERDAY                                                           │
│ ┌─────────────────────────────────────────────────────────────────┐│
│ │ 📧 Torque/Shipair                                   3:45 PM     ││
│ │ NLOB UK Torque ID:118997//FEN-MS//SZ-UK //NEW LOBSTER...        ││
│ │ ┌─────────────────────────────────────────────────────────────┐ ││
│ │ │ AI EXTRACTED:                                               │ ││
│ │ │ Type: Shipping Order  •  PO#: 100-100209  •  Customer: NLOB │ ││
│ │ │ CFS Cut-off: Feb 3, 12:00 noon  •  Warehouse: Yantian       │ ││
│ │ │ [Link to Shipment →]               [⚠️ Unmatched PO]        │ ││
│ │ └─────────────────────────────────────────────────────────────┘ ││
│ └─────────────────────────────────────────────────────────────────┘│
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Email Card:**
- Sender and timestamp header
- Subject line truncated with ellipsis
- Collapsible "AI EXTRACTED" panel (expanded by default)
- Extracted fields in key-value grid
- Link to associated shipment
- Warning badge if PO not matched

**Email Type Badges:**
| Type | Color | Label |
|------|-------|-------|
| Booking Request | `#E6A23C` | BOOKING |
| Shipping Order | `#67C23A` | SO |
| Draft B/L | `#409EFF` | DRAFT B/L |
| Final B/L | `#9B59B6` | FINAL B/L |
| Telex Release | `#909399` | TELEX |
| Unknown | `#71717A` | UNCLASSIFIED |

---

### 6.5 Alerts Dashboard

Dedicated view for all active alerts.

**Alert Severity Sections:**
```
┌─────────────────────────────────────────────────────────────────────┐
│ ALERTS                                                    [Settings]│
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│ 🔴 CRITICAL (2)                                                     │
│ ┌─────────────────────────────────────────────────────────────────┐│
│ │ Cut-off passed — cargo may have missed the vessel              ││
│ │ PO# 100-100209  •  New Lobster UK  •  CFS Cut-off was Feb 3    ││
│ │ [View Shipment]  [Dismiss]  [Snooze 24h]                        ││
│ ├─────────────────────────────────────────────────────────────────┤│
│ │ No departure in 7+ days after Draft B/L                        ││
│ │ PO# 22491  •  Daniels DE  •  Draft B/L received Jan 25         ││
│ │ [View Shipment]  [Dismiss]  [Snooze 24h]                        ││
│ └─────────────────────────────────────────────────────────────────┘│
│                                                                     │
│ ⚠️ WARNING (3)                                                      │
│ ┌─────────────────────────────────────────────────────────────────┐│
│ │ Cut-off tomorrow — confirm cargo delivery status               ││
│ │ PO# 6131180898  •  SKIM  •  CFS Cut-off: Feb 10                ││
│ │ [View Shipment]  [Dismiss]  [Snooze 24h]                        ││
│ └─────────────────────────────────────────────────────────────────┘│
│                                                                     │
│ ℹ️ INFO (5)                                                         │
│ └─ [Show 5 info alerts...]                                         │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Alert Actions:**
- View Shipment: Navigate to shipment detail
- Dismiss: Remove alert (with confirmation)
- Snooze: Hide for 24h/48h/1 week

---

### 6.6 Settings: Alert Configuration

The Settings page includes a dedicated **Alert Rules** configuration panel.

**Layout:**
```
┌─────────────────────────────────────────────────────────────────────┐
│ SETTINGS                                                            │
├──────────────┬──────────────────────────────────────────────────────┤
│              │                                                      │
│  General     │  ALERT RULES CONFIGURATION                           │
│  ──────────  │                                                      │
│  Email       │  Configure when alerts are triggered for each        │
│  ──────────  │  shipment state. Changes take effect immediately.    │
│  ● Alerts    │                                                      │
│  ──────────  │  ┌────────────────────────────────────────────────┐  │
│  Users       │  │ A1: BOOKED — No SO Received                    │  │
│  ──────────  │  │                                                │  │
│  API         │  │ Trigger after: [___2___] days                  │  │
│              │  │ Severity:      [Warning ▼]                     │  │
│              │  │ Enabled:       [✓]                             │  │
│              │  └────────────────────────────────────────────────┘  │
│              │                                                      │
│              │  ┌────────────────────────────────────────────────┐  │
│              │  │ A2: CONFIRMED — Cut-off Approaching            │  │
│              │  │                                                │  │
│              │  │ Trigger before cut-off: [___1___] days         │  │
│              │  │ Severity:               [Warning ▼]            │  │
│              │  │ Enabled:                [✓]                    │  │
│              │  └────────────────────────────────────────────────┘  │
│              │                                                      │
│              │  ┌────────────────────────────────────────────────┐  │
│              │  │ A3: CONFIRMED — Cut-off Passed (Critical)      │  │
│              │  │                                                │  │
│              │  │ Trigger after cut-off: [___0___] days          │  │
│              │  │ Severity:              [Critical ▼] (locked)   │  │
│              │  │ Enabled:               [✓] (locked)            │  │
│              │  └────────────────────────────────────────────────┘  │
│              │                                                      │
│              │  ┌────────────────────────────────────────────────┐  │
│              │  │ A4: AT WAREHOUSE — No Final B/L                │  │
│              │  │                                                │  │
│              │  │ Trigger after Draft B/L: [___5___] days        │  │
│              │  │ Severity:                [Warning ▼]           │  │
│              │  │ Enabled:                 [✓]                   │  │
│              │  └────────────────────────────────────────────────┘  │
│              │                                                      │
│              │  ┌────────────────────────────────────────────────┐  │
│              │  │ A5: SAILED — No Telex Release                  │  │
│              │  │                                                │  │
│              │  │ Trigger after Final B/L: [___7___] days        │  │
│              │  │ Severity:                [Info ▼]              │  │
│              │  │ Enabled:                 [✓]                   │  │
│              │  └────────────────────────────────────────────────┘  │
│              │                                                      │
│              │  ┌────────────────────────────────────────────────┐  │
│              │  │ A6: RELEASED — No Delivery Confirmation        │  │
│              │  │                                                │  │
│              │  │ Trigger after ETA: [___3___] days              │  │
│              │  │ Severity:          [Info ▼]                    │  │
│              │  │ Enabled:           [✓]                         │  │
│              │  └────────────────────────────────────────────────┘  │
│              │                                                      │
│              │  [Reset to Defaults]              [Save Changes]     │
│              │                                                      │
└──────────────┴──────────────────────────────────────────────────────┘
```

**Alert Rule Card Components:**
| Field | Type | Description |
|-------|------|-------------|
| Rule ID | Label | A1, A2, A3, etc. (read-only) |
| Title | Label | Descriptive name of the rule |
| Trigger Threshold | Number Input | Days before/after event |
| Severity | Dropdown | Critical / Warning / Info |
| Enabled | Toggle | On/Off switch |

**Locked rules:**
- A3 (Cut-off Passed) is locked to Critical severity and always enabled — this is the most important business rule and should never be disabled

---

## 7. AI Agent Architecture

### 7.1 Email Processing Pipeline

ShipTrack uses a 4-step AI pipeline to process incoming emails:

**Step 1: CLASSIFY**
- Input: Email subject + body
- Method: Keyword matching for email type detection
- Chinese keywords: 入仓单 (SO), 请核对提单 (Draft B/L), 开船提单 (Final B/L), 电放提单 (Telex)
- English keywords: BOOKING, SO, HBL, TELEX, RELEASE
- Output: Email type classification

**Step 2: EXTRACT (AI)**
- Input: Full email content
- Method: Claude API with structured extraction prompt
- Output: JSON with extracted fields:
  ```json
  {
    "po_numbers": ["100-100209"],
    "customer": "New Lobster UK",
    "forwarder": "Torque/Shipair",
    "route": "SZ→UK",
    "crd": "2026-02-03",
    "cfs_cutoff": "2026-02-03T12:00:00",
    "hbl_number": null,
    "vessel": null,
    "etd": null,
    "eta": null
  }
  ```

**Step 3: VALIDATE**
- Check PO# format against known patterns
- Verify date sanity (ETA after ETD)
- Match PO# to existing shipment records
- Flag unmatched POs for manual review

**Step 4: STORE & ALERT**
- Link email to shipment record
- Update shipment milestone and state
- Evaluate alert rules
- Trigger notifications if thresholds exceeded

### 7.2 Alert Rules Engine

Customer product rules (Settings): **days after ETD**, Draft / Final B/L staircase.

| Rule ID | Trigger condition | Severity | Default threshold |
|---------|-------------------|----------|-------------------|
| A1 | ETD + N days, no Draft B/L | Warning | **1 day** after ETD |
| A2 | ETD + N days, no Draft B/L | Critical | **2 days** after ETD |
| A3 | ETD + N days, no Final B/L | Warning | **3 days** after ETD |
| A4 | ETD + N days, no Final B/L | Critical | **7 days** after ETD |

Optional per-origin-country day overrides (e.g. CN / BD / KH) apply on top of the defaults.

**Operator message:** stored `alert.message` is **generated at fire time** from the live rule
threshold + leg facts (elapsed days after ETD, watch target, action hint) — not the static
seed `description`. See [docs/reference/alert-rules-and-messages.md](../reference/alert-rules-and-messages.md).

Legacy A5/A6 (telex / delivery) and built-in A7 (cargo-ready revision not reflected) exist in
the engine but are outside the customer Settings cards.

---

## 8. Data Model

### 8.1 Core Entities

**Shipment**
```typescript
interface Shipment {
  id: string;                    // UUID
  po_numbers: string[];          // One or more PO references
  customer_id: string;           // FK to Customer
  forwarder_id: string;          // FK to Forwarder
  route: string;                 // "SZ→UK" format
  
  // Dates
  crd: Date | null;              // Cargo Ready Date (from Cobalt)
  cfs_cutoff: Date | null;       // Cut-off deadline (from forwarder)
  etd: Date | null;              // Estimated departure
  eta: Date | null;              // Estimated arrival
  actual_departure: Date | null;
  actual_arrival: Date | null;
  
  // Extracted data
  hbl_number: string | null;
  vessel_name: string | null;
  voyage_number: string | null;
  warehouse_address: string | null;
  
  // State
  status: ShipmentStatus;
  risk_level: RiskLevel;
  
  // Metadata
  created_at: Date;
  updated_at: Date;
}

type ShipmentStatus = 
  | 'BOOKED'
  | 'CONFIRMED'
  | 'AT_WAREHOUSE'
  | 'SAILED'
  | 'RELEASED'
  | 'DELIVERED';

type RiskLevel = 'ON_TRACK' | 'AT_RISK' | 'DELAYED';
```

**ShippingEmail**
```typescript
interface ShippingEmail {
  id: string;
  message_id: string;            // Email Message-ID header
  subject: string;
  sender: string;
  received_at: Date;
  body_text: string;
  body_html: string;
  
  // AI processing
  email_type: EmailType;
  extracted_data: ExtractedData;
  extraction_confidence: number; // 0-1
  
  // Linking
  shipment_id: string | null;
  is_matched: boolean;
  
  attachments: Attachment[];
}

type EmailType =
  | 'BOOKING_REQUEST'
  | 'SHIPPING_ORDER'
  | 'DRAFT_BL'
  | 'FINAL_BL'
  | 'TELEX_RELEASE'
  | 'DELAY_NOTICE'
  | 'OTHER';
```

**Alert**
```typescript
interface Alert {
  id: string;
  shipment_id: string;
  rule_id: string;               // A1, A2, A3, etc.
  severity: AlertSeverity;
  message: string;
  
  // State
  status: AlertStatus;
  triggered_at: Date;
  dismissed_at: Date | null;
  snoozed_until: Date | null;
}

type AlertSeverity = 'CRITICAL' | 'WARNING' | 'INFO';
type AlertStatus = 'ACTIVE' | 'DISMISSED' | 'SNOOZED' | 'RESOLVED';
```

**AlertRule**
```typescript
interface AlertRule {
  id: string;                    // A1, A2, A3, A4 (product)
  name: string;                  // Human-readable name
  description: string;           // Static Settings blurb only — not the fired alert text
  
  // Trigger configuration
  state: ShipmentStatus | null;  // Optional staircase gate; product rules use null
  trigger_type: 'days_after' | 'days_before';
  trigger_reference: 'etd' | 'booking_request' | 'cutoff' | 'draft_bl' | 'final_bl' | 'eta' | ...;
  watch_for: 'draft_bl' | 'final_bl' | 'so' | ...;
  threshold_days: number;        // Operator unit (API/UI); persisted as threshold_hours = days * 24
  
  // Alert settings
  severity: AlertSeverity;
  enabled: boolean;
  locked: boolean;
  
  // Metadata
  updated_at: Date;
  updated_by: string;
}
```

### 8.2 Default Alert Rules Configuration

Settings and API speak **days**; the DB column is `threshold_hours` (days × 24).
`description` is presentation-only; fired alerts use a live-formatted `message`.

```typescript
// Product set — seed in backend/src/db/seed.ts (thresholdHours = days * 24)
const DEFAULT_ALERT_RULES = [
  {
    id: 'A1',
    name: 'No Draft BOL received',
    description: 'Warning when Draft B/L is still missing after ETD + N calendar days',
    state: null, // any lifecycle once ETD exists
    trigger_type: 'days_after',
    trigger_reference: 'etd',
    watch_for: 'draft_bl',
    threshold_days: 1,
    severity: 'WARNING',
    enabled: true,
    locked: false,
  },
  {
    id: 'A2',
    name: 'No Draft BOL received',
    description: 'Critical when Draft B/L is still missing after ETD + N calendar days',
    state: null,
    trigger_type: 'days_after',
    trigger_reference: 'etd',
    watch_for: 'draft_bl',
    threshold_days: 2,
    severity: 'CRITICAL',
    enabled: true,
    locked: false,
  },
  {
    id: 'A3',
    name: 'No Final BOL received',
    description: 'Warning when Final B/L is still missing after ETD + N calendar days',
    state: null,
    trigger_type: 'days_after',
    trigger_reference: 'etd',
    watch_for: 'final_bl',
    threshold_days: 3,
    severity: 'WARNING',
    enabled: true,
    locked: false,
  },
  {
    id: 'A4',
    name: 'No Final BOL received',
    description: 'Critical when Final B/L is still missing after ETD + N calendar days',
    state: null,
    trigger_type: 'days_after',
    trigger_reference: 'etd',
    watch_for: 'final_bl',
    threshold_days: 7,
    severity: 'CRITICAL',
    enabled: true,
    locked: false,
  },
];
// Example fired message (not description):
// "No Draft B/L — 2 days after ETD (2026-02-01); threshold is ETD + 1 day. Contact forwarder for Draft B/L."
```

See [docs/reference/alert-rules-and-messages.md](../reference/alert-rules-and-messages.md).

---

## 9. Technical Stack

**Frontend:**
- React 19 + TypeScript
- Zustand for state management
- TanStack Query for data fetching
- Tailwind CSS with custom Cobalt theme tokens
- Lucide React for icons

**Backend:**
- NestJS 11 (Node + TypeScript) API server
- Drizzle ORM + PostgreSQL
- Receives scored decisions from the **cobalt-queue** agent via `POST /api/decisions` — email
  extraction + ingestion (Microsoft Graph + the Claude-based parser) run out of process in that
  separate service, not in this app

**Infrastructure:**
- Single Docker image (NestJS serves `/api` + the built SPA) on AliCloud VMs
- Email polling + extraction run in the separate cobalt-queue service
- Scheduled alert evaluation

---

## 10. Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Email extraction accuracy | 95%+ | Manual review of extracted fields |
| Alert lead time | 24h+ before deadline | Time between alert and missed milestone |
| Search response time | < 500ms | P95 latency for shipment lookup |
| Email processing time | < 30s | Time from email arrival to dashboard update |
| System uptime | 99.5% | Monitoring dashboards |

---

*Document created: April 2026*
*For: Cobalt Knitwear ShipTrack POC — PAVE Studio Development*
