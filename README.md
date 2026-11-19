# Chama Ledger — validation kit

**Started:** Mon Nov 16, 2026
**Goal:** prove someone pays for a monthly accountability statement before writing a product.
**Segment:** salary-based chamas and investment clubs, 10–30 members, reached through the treasurer.

## Why this segment

| Criterion | Why it wins |
|---|---|
| Already semi-digital | Treasurer keeps an Excel sheet and receives contributions on M-Pesa, so the records exist and can be exported |
| Uniform monthly contributions | The statement is comparable month to month; no per-transaction mess |
| Money at stake | KSh 2,000–10,000 per member per month — a missing KSh 4,000 is worth an argument and worth KSh 500 to avoid |
| One reachable buyer | The treasurer decides, not an AGM. One treasurer introduces you to their whole network |
| Pays for itself | Members are salaried; a KSh 500 statement is a rounding error against a disputed balance |

**Fallback rule:** if your first five warm conversations are church- or family-based rather than
workplace-based, keep the same kit and change the vocabulary (building fund, welfare fund). Do not
change the segment twice in one month.

## The strategic finding

The full-suite market is crowded and cheap. As listed in November 2026:

- **Chamasoft** — KSh 1,000/month, 30-day free trial
- **Simpat Systems** — KSh 500/month
- **Tekeleza** — KSh 100/member/month (Gold), KSh 300/member/month (Platinum) → KSh 2,000/month for 20 members
- **ChamaPro, Chama Systems, fibo360, modefin** — full suites: members, loans, fines, merry-go-round

So do not compete on features or undercut on price. **Your customer is the group that will never
migrate to a system.** They will not enter a year of history into Chamasoft, and they will not ask
30 members to install an app. They will pay once a month to have the books shown properly.

That is a narrower, defensible position: *the statement, not the system.* If a group does want a
system, refer them to Chamasoft — you lose one deal and gain a reputation.

## What's in this folder

| File | Use |
|---|---|
| `interview-script.md` | 10 questions, probes, and a scoring rubric. Use it verbatim. |
| `statement/statement.html` | Shell: stylesheet link + JSON payload + wiring. Double-click to use. |
| `statement/statement.css` | Screen and print styles, shared with the importer's preview (includes 360 px mobile rules) |
| `statement/render.js` | The engine — `compute`, `validate`, `render`, `toWhatsApp`. All arithmetic lives here. |
| `statement/schema.md` | The data contract and the five invariants |
| `statement/test/render.test.cjs` | 9 tests, no browser: `node --test .../render.test.cjs` |
| `importer/importer.html` | Step 2 page (mobile-friendly layout, verified at 360 px): upload CSV or locked PDF + group JSON, confirm columns, resolve unknowns, print. Double-click on desktop; for real phone use serve the folder from static hosting/PWA (`file://` is unreliable on Android). |
| `importer/import.js` | Step 2 engine: CSV or parsed table → statement JSON, plus a report of everything it cannot explain |
| `importer/pdf.js` | PDF reader: RC4 decrypt, inflate, ToUnicode text, x/y table reconstruction. No dependencies. |
| `importer/cli.cjs` | Run the importer from the command line: `node cli.cjs statement.csv group.json out.json` (or a PDF with `--password`) |
| `importer/fixtures/` | `mpesa-clean.csv` (reconciles at 58,000) and `mpesa-messy.csv` (four findings, 1,500 adrift) |
| `importer/test/import.test.cjs` | 19 tests, no browser: `node --test .../import.test.cjs` |
| `importer/test/pdf.test.cjs` | 12 tests for the PDF path: `node --test .../pdf.test.cjs` |
| `pricing.md` | Competitor scan, price ladder, quote template, objection handling |
| `sprint-14-days.md` | Day-by-day plan, Nov 16–29, with two kill checks |
| `leads.csv` | Pipeline tracker — 30 names target |
| `../../decisions/0001-chama-segment.md` | The decision record |

## Do this in the next 60 minutes

1. Open `leads.csv` and write **10 names** you can reach this week. Not 30 — 10. Family, church,
   workplace, alumni, your parents' friends, a boda SACCO.
2. Send this message to the five you know best:

   > Hi [name], I'm doing a short project on how chamas keep their records. Could I ask you 20
   > minutes about how yours works? I'm not selling anything — I'm trying to understand where the
   > record-keeping actually breaks.

3. Book two calls for Wednesday and two for Thursday.
4. Open `importer/importer.html` and load the two clean fixtures. You will see 58,000 reconcile; then
   do it again with the messy pair and watch it refuse to pretend. If the treasurer has the PDF from
   Safaricom instead of a CSV, drop that in: the page asks for the email password and reads the table
   in the tab. That is the demo you show a treasurer — not the file format, the moment the books
   disagree.

Do not build the product this week. The page and the importer exist to let you *deliver* the concierge
service by hand — one group, one month, KSh 500. Accounts, history and member logins can wait until
three people have paid for the manual version.
