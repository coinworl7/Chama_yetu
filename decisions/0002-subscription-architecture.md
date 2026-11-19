# 0002 — Subscription fee architecture (deferred)

**Date:** Wed Nov 18, 2026  
**Status:** Proposed — do not build before validation (≥3 paying clients and a repeatable monthly delivery)  
**Relates to:** `0001-chama-segment.md`

## Context

The current product is a client-only, offline tool: a treasurer opens local HTML files, the M-Pesa statement is parsed in the browser, and nothing is uploaded. There is no hosting budget, no server, and no backend. The business is not yet registered (no business name, KRA PIN, or Till/Paybill/shortcode), which blocks formal merchant onboarding and automated M-Pesa collection.

We want a way to charge a subscription fee for the web app later without breaking the offline/no-install value proposition or building infrastructure before anyone pays.

## Decision

Introduce subscriptions in stages. Keep the app usable offline, keep money collection separate from the statement logic, and prefer manual, auditable steps until volume justifies automation.

### Phase 0 — Now (no subscription product)

- Charge per statement manually (current KSh 500 concierge offer) and learn willingness to pay.
- Do **not** add paywalls, licence checks, or payment integrations yet.
- Gate: build subscription plumbing only after **≥3 paying clients** and evidence they will pay monthly.

### Phase 1 — Manual licensing (first paid "app" subscriptions)

**Goal:** collect recurring fees with zero hosting and no payment API integration.

- **How a customer pays:** manual M-Pesa transfer to the business channel once registered (until then, only personal/manual collection is possible and should be treated as temporary). Record payment in a simple ledger/spreadsheet.
- **How access is granted:** issue a time-limited **licence key/token** per group/plan (e.g. monthly or quarterly expiry, plan, group name/id). Delivery can be WhatsApp/SMS/email text.
- **How the app checks it:** the web app accepts a pasted key and stores it locally (e.g. `localStorage`). For an offline-capable check, use a **signed token** (payload = group, plan, expires-at) verified in-browser with an embedded public key; signing happens on the maintainer’s machine. Do not embed a shared secret in client code.
- **Expiry over revocation:** keep licences short (e.g. 30–35 days). If someone does not renew, the key expires naturally. Avoid building remote revocation/DRM (a determined user can edit client-side files; accept that and price/support accordingly).
- **Offline behavior:** if the key is still within its validity window, the app works without network. Optionally allow a small grace period and show clear renewal prompts, but never block printing a statement in a way that could be used to pressure a treasurer mid-delivery.

### Phase 2 — Automated payments and entitlement issuance (when volume justifies it)

**Goal:** reduce manual issuance work while keeping the core tool offline-first.

- **Payment collection:** integrate a Kenyan-friendly gateway/aggregator that supports M-Pesa collections and provides reliable webhooks (evaluate current options such as IntaSend, Flutterwave, Pesapal, Paystack, or direct Daraja — verify M-Pesa/STK/Paybill support, fees, and settlement at build time). Direct Safaricom Daraja requires business registration/shortcode/KRA details; aggregators may lower onboarding friction but still require compliance checks.
- **Entitlement service:** a small serverless endpoint/webhook receives payment confirmation, verifies it server-side, and issues/renews a signed licence token (or records entitlement). This is a minimal backend (functions + simple storage), not a full app server.
- **Client flow:** treasurer pays → receives key automatically (or app fetches it when online) → key stored locally and verified offline as in Phase 1. The importer/PDF parsing remains local.
- **Operations:** basic admin view/spreadsheet of subscriptions, failed payments, and renewals; receipts/acknowledgements for customers.

### Phase 3 — Hosted/PWA or account model (optional, later)

- Only if customers need multi-device access, history, or team accounts: host a static PWA (or wrap via Capacitor for an APK) and optionally add lightweight accounts tied to entitlements.
- Do **not** move statement parsing or sensitive data handling to a server unless there is a clear reason and DPA 2019 obligations (lawful basis, minimisation, access/deletion, security, and any ODPC registration duties) are addressed.

## Pricing and packaging (to validate, not commit)

- Keep a **per-statement** option for irregular groups and a **monthly subscription** for active treasurers; price above the manual effort floor and below full-suite competitors where appropriate (see `pricing.md`).
- Consider group-based tiers (e.g. up to N members / statements per month) rather than per-member pricing to stay simple.
- Grandfather early manual clients when introducing automated billing.

## Constraints and non-goals

- **No custody of funds:** collect fees for the service only; never hold chama contributions.
- **No false security:** client-side licence checks deter casual non-payment, not determined bypass. Business terms and relationships matter more than DRM.
- **No premature infrastructure:** no server/database/gateway work before ≥3 paying clients.
- **Compliance prerequisites:** business registration, KRA PIN, Till/Paybill or aggregator onboarding, and a clear receipt/invoice flow are required before automated or scaled collection.

## Consequences

- **Good:** preserves offline, no-install use; enables revenue experiments with manual keys first; defers cost and complexity; clean upgrade path to automation.
- **Bad:** Phase 1 is manual admin work; client-side checks are bypassable; moving to gateways adds fees and compliance overhead.
- **Revisit when:** 3+ clients pay monthly, manual key issuance becomes a bottleneck, or customers explicitly need hosted/accounts.