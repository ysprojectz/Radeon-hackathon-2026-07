# Claims Processor Portal — claims-ui

**Next.js 15 frontend for ACOS — Autonomous Claims Operating System.**

Provides a full-featured web portal for insurance claims adjudicators:
- Submit claims (PDF upload or JSON) with 5-step guided wizard
- Review AI-adjudicated settlements with policy citation evidence
- Manage the HITL review queue with SLA tracking
- Export finance-grade PDF reports with full audit trail
- Monitor real-time operations dashboard

---

## Getting Started

### Prerequisites

- Node.js 20+
- Backend API running on port 8000 (see root `README.md`)

### Development

```bash
cd claims-ui
npm install

# Copy env file
cp .env.example .env.local
# .env.local: NEXT_PUBLIC_API_URL=http://localhost:8000

npm run dev
# Open http://localhost:3000
```

### Production (Docker)

```bash
# From claims-engine-source/
docker compose up -d claims-ui
# Portal at http://localhost:3000
```

---

## Authentication

All portal routes require login. Navigate to any page to be redirected to `/login`.

**Demo accounts:**

| Email | Password | Role |
|---|---|---|
| `admin@claims-engine.local` | `Admin@2024!` | ADMIN |
| `adjuster@claims-engine.local` | `Adjuster@2024!` | ADJUSTER |
| `reviewer@claims-engine.local` | `Reviewer@2024!` | SENIOR_ADJUSTER |
| `compliance@claims-engine.local` | `Compliance@2024!` | COMPLIANCE_OFFICER |

Tokens are stored in `localStorage` under:
- `claims_engine_access_token`
- `claims_engine_refresh_token`
- `claims_engine_user`

A 401 response from the API automatically clears tokens and redirects to `/login?next=<original_path>`.

---

## Pages

| Route | Page | Description |
|---|---|---|
| `/login` | Login | JWT authentication. Dark-themed with demo credential table. |
| `/` | Dashboard | Live KPIs (auto-refresh 30s): total claims, auto-adj rate, avg confidence, HITL pending, settled amount, denial rate. Pie + bar charts. |
| `/submit` | Submit Claim | 5-step wizard: Select Policy → Upload PDF → Review OCR → Processing → Result |
| `/claims` | Claims List | Searchable, filterable table of all 14+ claims. Status + market filters. |
| `/claims/[ref]` | Claim Detail | Settlement waterfall, line items, policy citations (REGIONAL/COMPANY), audit trail with hash chain. PDF export. |
| `/hitl` | Review Queue | HITL pending claims with SLA countdown. Decision drawer: Accept AI / Override / Deny / Escalate / Request Info. 5-second poll. |
| `/policies` | Policies | 5 policies grouped by market. Upload PDF for LLM clause extraction. |

---

## Key Files

```
claims-ui/
├── app/
│   ├── layout.tsx              Root layout with AuthLayout wrapper
│   ├── page.tsx                Dashboard
│   ├── login/page.tsx          Login form (JWT)
│   ├── submit/page.tsx         5-step claim wizard
│   ├── claims/
│   │   ├── page.tsx            Claims list + filters
│   │   └── [reference]/page.tsx Claim detail + PDF export
│   ├── hitl/page.tsx           HITL review queue
│   └── policies/page.tsx       Policy management
│
├── components/
│   ├── layout/
│   │   ├── AuthLayout.tsx      Auth gate — redirects unauthenticated users
│   │   ├── AppShell.tsx        Sidebar + Topbar shell
│   │   ├── Sidebar.tsx         Nav links with HITL badge
│   │   └── Topbar.tsx          Breadcrumb, API health, user badge, logout
│   ├── dashboard/              KPICard, KPIGrid, charts
│   ├── submit/                 WizardShell, Step1–5 components
│   ├── claims/                 ClaimsTable, ClaimFilters, ClaimStatusBadge
│   ├── claim-detail/           SettlementBreakdown, AuditTimeline, PolicyCitationsPanel
│   ├── hitl/                   HITLQueueTable, HITLDecisionPanel, HITLDecisionForm
│   ├── policies/               PolicyCard, PolicyGroup, PolicyUploadModal
│   ├── pdf/                    FinancePDFDocument, PDFExportButton (@react-pdf/renderer)
│   └── shared/                 UploadZone, ConfidenceScore, CurrencyAmount, HashChainBadge
│
└── lib/
    ├── auth.ts                 Token storage helpers (getAccessToken, setTokens, clearAuth)
    ├── api.ts                  Typed fetch client — auth headers + 401 handler + login()
    ├── types.ts                TypeScript interfaces mirroring backend Pydantic schemas
    ├── utils.ts                formatCurrency, formatDate, statusColor, formatRelative
    ├── constants.ts            Status labels, trigger colors, market names
    └── hooks/
        ├── useClaims.ts        SWR claims list
        ├── useClaimDetail.ts   Parallel fetch: claim + audit trail
        ├── useDashboardKPIs.ts 30-second polling
        ├── useHITLQueue.ts     5-second polling
        └── usePolicies.ts      Policies + clauses cache
```

---

## API Proxy

All browser requests route through the Next.js proxy at `/api/v1/proxy/*` → `{NEXT_PUBLIC_API_URL}/api/v1/*`. This hides the backend URL from browser clients.

Configured in `next.config.ts`:
```ts
rewrites: [
  { source: "/api/v1/proxy/:path*", destination: `${apiUrl}/api/v1/:path*` }
]
```

---

## PDF Export

The Finance PDF is generated client-side using `@react-pdf/renderer`. It includes:
- Claim header (reference, status, patient, policy, confidence)
- Section 1: Financial settlement waterfall
- Section 2: Line items table with per-procedure breakdown
- Section 3: Full audit trail with all hash values

`PDFExportButton` is loaded via `next/dynamic` with `ssr: false` to avoid server-side rendering issues.

Downloaded as: `claims-report-{reference}-{date}.pdf`

---

## Tech Stack

| Technology | Version | Use |
|---|---|---|
| Next.js | 15 | App Router, SSR, API proxy |
| TypeScript | 5.x | Type safety throughout |
| Tailwind CSS | 3.x | Utility-first styling |
| shadcn/ui | Latest | Button, Card, Badge, Sheet, Dialog, Tabs, etc. |
| SWR | 2.3.x | Data fetching + polling |
| Recharts | 2.x | Dashboard pie + bar charts |
| @react-pdf/renderer | 4.x | Client-side PDF generation |
| react-dropzone | 14.x | PDF drag-and-drop upload |
| date-fns | 4.x | Date formatting |
| lucide-react | Latest | Icons |
| next-themes | Latest | Dark/light mode |

---

## Known Issues & Enhancement Plan

This section previously referenced `ENHANCEMENT_PLAN.md` in the project root. That file has never existed in this repository's git history — the reference was stale. If a full bug/code-quality/feature backlog is wanted, it needs to be written from scratch; this section should not be treated as a live tracker until then.

The four items previously listed here as "most critical open" have been verified against current code (2026-07-20) and are already resolved:
- ~~BUG-01: Route API through Next.js proxy (backend URL visible in browser)~~ — `lib/api.ts` routes exclusively through `/api/v1/proxy/*` and dedicated server-side route handlers under `app/api/v1/*`; no client-side code calls `NEXT_PUBLIC_API_URL` directly.
- ~~BUG-02: Mobile sidebar not collapsible (unusable on < 640px)~~ — `Sidebar.tsx` has explicit mobile/tablet breakpoint handling with an `lg:hidden` overlay.
- ~~BUG-06: Wizard submits hard-coded `patient_dob: "1990-01-01"` for every claim~~ — `patient_dob` is a real, required, validated field throughout the `/submit` wizard (`Step2ManualEntry`, `Step3ReviewOCR`, `Step4Processing`) and the `/claims-advance` flow.
- ~~BUG-08: KPI trend values (+2.1%, -0.4) are hard-coded constants, not real deltas~~ — `KPIGrid.tsx` fetches real day-over-day volume data via `getDashboardVolume()` and computes trends from it.

If new issues are found, track them here directly rather than reintroducing a reference to a file that doesn't exist.
