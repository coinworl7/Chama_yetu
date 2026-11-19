# 0001 — Chama statement as the first product

**Date:** Mon Nov 16, 2026
**Status:** Accepted, pending the Nov 29 payment test
**Supersedes:** the pending `0001-client-or-portfolio` question, which became moot when the
supermarket and fantasy projects were dropped.

## Context

Two planned projects were abandoned: a supermarket site for a client who already has a working
website, and a fantasy football app whose market is already served. Neither had a buyer who had
agreed to anything. The remaining constraints are: one intermediate developer, 10–20 hours a week,
no hosting budget, no deadline, Kenya, and a preference for paid work plus a product they run.

The chama/savings-group segment has a real, recurring, money-shaped problem, and the records needed
to serve it already exist as M-Pesa statements and Excel sheets.

## Decision

Build a paid **monthly accountability statement** for chamas of 10–30 members, sold to the treasurer,
produced manually first. Do not build a ledger application until at least 25 groups are paying, or
until manual production demonstrably breaks.

Positioning: *we do not replace your system; we produce the statement your members can trust.*

## Why not the alternatives

| Option | Why rejected |
|---|---|
| Another e-commerce build | Most crowded junior portfolio category in Kenya; no buyer identified |
| Fantasy football | Market served (FPL, Dream Team, Sorare); data licensing unclear; payments required |
| County data dashboard | Strong analytics portfolio, weak willingness to pay; no recurring buyer |
| Full chama management suite | Direct competition with Chamasoft (KSh 1,000/mo), Simpat (KSh 500/mo), Tekeleza (KSh 100/member/mo) at a fraction of their resources |
| M-Pesa statement analyser | Consumer app, no identifiable payer, one-off use |

## Consequences

**Good**

- No data acquisition risk: the customer already has the data.
- The artifact is shareable, so distribution is built into the product.
- Manual delivery is a paid discovery process; the product is written from observed work.
- Free to start: no hosting, no merchant onboarding, no app store.

**Bad**

- Revenue is service-shaped until volume arrives, so it competes with study time.
- Per-group revenue is small (KSh 500–900/month); this needs dozens of groups to matter.
- Handling money records carries dispute and data-protection exposure.
- The buyer is price-sensitive and will compare you to a KSh 500 competitor.

**Exit criteria**

- Zero of three groups pay by Nov 29 → stop or change one variable, do not build.
- Fewer than 6 of 10 interviews describe a money dispute → wrong segment.
- Past 25 paying groups → automate before taking another manual client.

## Follow-ups

1. Register the business name and get a Till before quoting (required to collect payment).
2. Check ODPC registration obligations for holding member names and money records.
3. One-page confidentiality note and a privacy policy before the first real dataset.
4. Re-point the ECC learning schedule weeks 1–5 at this project and regenerate the calendar.
