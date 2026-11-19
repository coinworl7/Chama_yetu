# M-Pesa importer

Step 2 of the build: turn a treasurer's M-Pesa statement export — CSV **or** the PDF
Safaricom emails — plus a member list into the JSON document described in `../statement/schema.md`.

The point is not convenience. It is **catching the month that does not add up before the members do.**

## The one rule

> The importer never decides that money arrived.

It proposes matches against the member list, and records everything it cannot explain in a report. It
will happily emit an unbalanced statement if that is what the data says — and then
`statement/render.js` refuses to call it reconciled. Two independent checks, so neither one has to be
trusted on its own.

## The pipeline

```
CSV text                                    PDF bytes (often password-locked)
  │  parseCsv()                               │  extractTable()
  │  quoted fields, escaped quotes,           │  decrypt (RC4), inflate, decode ToUnicode,
  │  CRLF, BOM                                │  rebuild the table from x/y positions
  ▼                                           ▼
{ headers, rows }  ◄───────────────  { headers, rows }
  │  guessMapping()    header → field, shown to a human who can override it
  ▼
transactions[]        line, receipt, date, details, status, paidIn, withdrawn
  │
  ├─ status ≠ COMPLETE .................... reported, not counted
  ├─ withdrawn > 0 ........................ reported as an outflow (not an expense — not yet)
  ├─ paidIn ≤ 0 ........................... ignored
  ├─ duplicate receipt ................... reported, second one ignored
  ├─ date unreadable ..................... reported as an error, ignored
  ├─ date outside period ................. reported, ignored
  ├─ assigned by a person ................ matched (only after the checks above pass)
  ├─ set aside by a person ............... reported, not counted
  ├─ phone matches a member .............. matched
  ├─ full name, or unique surname ........ matched
  └─ nothing matches ..................... reported as unknown
  ▼
tally per member → paid, date, ref
  │  phones stripped from the output
  ▼
{ statement, report }   statement is schema.md; report is the audit trail
```

## Files

| File | Role |
|---|---|
| `importer.html` | The page: drop the CSV or PDF and the group file, confirm columns, resolve unknowns, print |
| `import.js` | The engine. Pure functions, no DOM, no filesystem, loads in browser or Node |
| `pdf.js` | The PDF reader: decrypt, inflate, decode text, rebuild the transaction table |
| `cli.cjs` | Command line: CSV or PDF + group JSON → statement JSON, report on stderr |
| `fixtures/mpesa-clean.csv` | Five clean contributions; must reconcile |
| `fixtures/mpesa-messy.csv` | Duplicate receipt, unknown sender, an outflow, one October row |
| `fixtures/group-clean.json` | Five members, opening 48,000, M-Pesa 58,000 |
| `fixtures/group-messy.json` | Same members, M-Pesa 57,000 — deliberately 1,500 too high |
| `test/import.test.cjs` | 19 tests, no browser, no dependencies |
| `test/pdf.test.cjs` | 12 tests for the PDF path and the table hand-off |
| `test/make-pdf-fixture.py` | Regenerates the encrypted, PII-free PDF fixture (dev only) |

`group-*.json` is a statement payload **without** `paid` / `date` / `ref`. Those are what the importer
fills in. `phone` is optional and used only for matching.

## Run it

### The page (what a treasurer sees)

Double-click `importer.html`. No server, no install. Then:

The layout is usable at 360 px (stacked grids, 44 px+ touch targets, 16 px form controls, scrollable step strip and detail tables). On Android, opening a local `file://` HTML from a file manager often does not run scripts, so real phone use needs the folder served from free static hosting (or a PWA later). The reader still makes no network calls.

1. **Upload** — choose the CSV or the PDF, and the group JSON. For a PDF, type the password from the
   M-Pesa email (if the file is locked) and press **Read PDF**. The page shows the row count, member
   count, opening balance and what the accounts hold before it lets you continue.
2. **Columns** — the mapping it guessed, as dropdowns. Change one and the five-row preview updates.
   Required columns missing means the button stays disabled.
3. **Review** — the reconciliation strip (closes / holds / difference), every finding, and a decision
   dropdown for each payment it could not attribute. Assign it to a member or set it aside; either
   way the strip recomputes and the statement still has to add up. **Build anyway** is offered when it
   does not.
4. **Statement** — the real `render.js` output. Print or save as PDF, download the JSON, or go back.

The printed page is the same artifact the manual workflow produces. If it does not reconcile, the
error banner is on the page that would have been sent.

### The PDF path

The PDF is read inside the tab; neither the file nor the password is sent anywhere, stored, or
logged. `pdf.js` handles what Safaricom actually sends: the Standard security handler with RC4-40 or
RC4-128, Flate-compressed streams, Identity-H fonts with a ToUnicode map, and a receipt table whose
`Details` cell wraps onto one or two lines below the row.

The layout rule is small and explicit: a row is anchored by its date cell; everything to the right is
status, amount and balance; a later line with no date is a continuation of `Details`. Amounts are
signed and right-aligned, so the sign decides whether the row is paid in or withdrawn. The total is
then checked against the statement's own summary block by eye, once, during delivery.

When a PDF cannot be read, it fails with a message, never a best guess:

| Code | Meaning | What the treasurer does |
|---|---|---|
| `BAD_PASSWORD` | wrong or missing password | retype the password from the email |
| `UNSUPPORTED_ENCRYPTION` | AES or a non-Standard handler | export the CSV instead |
| `NO_TEXT` | scan or picture, no text layer | export the CSV instead |
| `NO_TABLE` | text, but not a transaction table | export the CSV instead |
| `BAD_PDF` / `NO_PAGES` | damaged or incomplete file | download the statement again |
| `NO_INFLATE` | browser too old for `DecompressionStream` | use current Chrome, Edge or Firefox |

### The command line

```powershell
cd "C:\Users\Administrator\Documents\Default Project\projects\chama-ledger\importer"

# The engines
node --test test/import.test.cjs
node --test test/pdf.test.cjs

# Clean month — reconciles, exit 0
node cli.cjs fixtures/mpesa-clean.csv fixtures/group-clean.json out-clean.json

# Messy month — four findings, exit 1
node cli.cjs fixtures/mpesa-messy.csv fixtures/group-messy.json out-messy.json

# A PDF — password as an argument or in the environment
node cli.cjs statement.pdf group.json out.json --password 123456
$env:STATEMENT_PDF_PASSWORD = "123456"; node cli.cjs statement.pdf group.json out.json
```

The report goes to **stderr**, the statement JSON to **stdout** (or the third argument). That means
you can pipe the JSON somewhere without the report contaminating it:

```powershell
node cli.cjs statement.csv group.json > statement.json
```

Exit code is `1` when the report contains an error, so a script can stop before printing anything.

## What the clean fixture produces

| Line | Amount | Matched to | How |
|---|---|---|---|
| 2 | 2,000 | Alice Mwangi | phone |
| 3 | 2,000 | Brian Kiptoo | phone |
| 4 | 2,000 | Caroline Njeri | name |
| 5 | 2,000 | David Ochieng | phone |
| 6 | 2,000 | Esther Wambui | name |

```
opening 48,000 + contributions 10,000 = 58,000
M-Pesa 58,000 + cash 0               = 58,000     ✓ reconciled
```

Note line 4: Caroline's row has no phone number, so matching fell back to her name. Both routes are
kept in the `via` field of the report so you can see how each shilling was attributed.

## What the messy fixture finds

```
ERROR  Receipt TGH1A2B3C4 appears more than once (KSh 2,000 ignored).
ERROR  KSh 3,000 from "Funds received from JOHN KAMAU 254799999999" on 7 Nov is not matched to a member.
ERROR  KSh 1,500 paid out on 5 Nov (Pay bill withdrawal to J. OTIENO) is not yet classified as an expense or a loan.
WARN   1 transaction outside this period ignored.
```

Then the emitted statement, fed through `render.js`, reports on its own:

```
ERROR  Accounts do not reconcile: the statement closes at KSh 55,500
       but the accounts hold KSh 57,000 (difference KSh 1,500).
```

The arithmetic behind that 1,500: the M-Pesa account rose by 9,000 over the month. The importer could
attribute 7,500 to members (Caroline paid 1,500 of 2,000; Esther's only two rows were a duplicate and
an October row). The remaining +3,000 (John Kamau) and −1,500 (the withdrawal) are the difference. The
report names both, so the treasurer has something to act on instead of a red number.

Esther being recorded at zero is correct and deliberate: her receipt was a duplicate of Alice's, and her
other row is dated 31 October. Paying her twice because a receipt repeated is how a chama loses money.

## How it decides a match

1. **Phone**, normalised to `2547XXXXXXXX`. `0712 000 001`, `+254712000001`, `254-712-000001` and
   `712000001` all become `254712000001`.
2. **Full name**, ignoring noise words like `FUNDS`, `RECEIVED`, `FROM`, `PAYBILL`.
3. **Unique surname** — but only if exactly one member has it. Two Mwangis and a bare `MWANGI` in the
   Details column matches nobody, on purpose.

Anything weaker than that is `unknown`, never a guess.

## Overriding the mapping

`guessMapping()` is a proposal, not a commitment. If a different export names its columns oddly, pass
a map as the third argument. This works the same for a table from `pdf.js`:

```js
importer.buildStatement(group, csvText, {
  receipt: 0,
  date: 1,
  details: 2,
  status: 3,
  paidIn: 4,
  withdrawn: 5,
});
```

That is the exact call the page's column screen makes.

## When a person has to decide

Automatic matching is deliberately conservative, so real rows will be left over. The importer accepts
a fourth argument: a map of line number to decision.

```js
importer.buildStatement(group, csvText, mapping, {
  "9": "Esther Wambui",   // attribute this row to a member
  "12": "__ignore__",     // set it aside, do not count it
});
```

Two rules keep this from becoming a way to fudge the books:

1. **It only applies where automatic matching would run.** A duplicate receipt, an out-of-period row,
   an outflow or a non-`COMPLETE` row is resolved before this point, so a decision cannot force any of
   them through.
2. **Ignoring money does not balance the month.** The row is left out of the statement, the closing
   balance drops, and reconciliation fails unless the money is accounted for elsewhere. The report
   says so in as many words.

The page exposes exactly this: the **Needs a decision** table, one dropdown per leftover row.

## One file, one period

The group file decides the period, not the statement export. `periodStart` and `periodEnd` are what the importer
filters on, and `openingBalance` must be the account balance **on the first day of that period**, not
whenever the export happens to start.

So a statement that runs from January to today has two honest uses:

**1. Monthly statement — what you sell.** Set `periodStart` to the first of the month and `periodEnd`
to the last, with the opening balance from that month's first day and `statementBalances` from the
account on the last day. Every January–October row is reported once as *"N transactions outside this
period ignored"*. That is a warning, not an error: those rows are genuinely outside the month. Costs
nothing, and the November statement is the same artifact as always.

**2. Year-to-date statement — a different deliverable.** Set the period to the whole span and
`members[].expected` to each member's total for the span, then classify **every** withdrawal in the
file into `expenses` or `loans`. It reconciles, and it answers "where did the year go", but it does not
answer "did November's money arrive" and it is much more work to prepare. Price it as its own job.

Leaving `periodStart` and `periodEnd` out disables the filter entirely: every row in the file counts.
That is a valid mode, but be deliberate about it.

In both cases the statement's `Balance` column is still ignored. A wrong opening balance therefore shows up
as a difference on the review strip, instead of being quietly absorbed.

## Deliberate limits

- **One account.** One statement at a time. A group with M-Pesa and a bank account imports twice and
  reconciles each; combining them is a later, explicit step.
- **PDF support is narrow on purpose.** One table layout (the M-Pesa receipt table), RC4 encryption
  only, text PDFs only. AES-encrypted files, scans, and a bank's own layout fail with a code instead
  of a wrong table. The CSV export is always the fallback.
- **No inference of loans or expenses.** A withdrawal is reported as an unclassified outflow. Naming
  it a loan or an expense is a decision for the committee, and the importer will not make it — nor
  does the page offer to. Add it to the group file's `expenses` or `loans` and import again.
- **No adding members from a payment.** A row can only be assigned to someone already on the list.
  Otherwise a typo in `Details` could quietly create a fictional member.
- **No persistence.** It reads text and returns JSON. Storage is a later step.
- **No phone in the output.** Matching uses the number; the statement that circulates does not carry
  it.

## What has been verified

| Check | Result |
|---|---|
| Clean fixture reconciles | 48,000 + 10,000 = 58,000 ✓ |
| Messy fixture flags all four findings | duplicate, unknown, outflow, outside period ✓ |
| Messy statement refused by the renderer | difference 1,500 ✓ |
| Duplicate receipt not counted twice | Esther 0, not 2,000 ✓ |
| Phone matching, name fallback, unique surname | ✓ |
| Ambiguous surname | matches nobody ✓ |
| Non-`COMPLETE` rows | reported, not counted ✓ |
| Two receipts from one member | summed, refs joined ✓ |
| Quoted commas, escaped quotes, CRLF, BOM | ✓ |
| Date variants: `2026-11-02 09:14`, `02/11/26`, `2-Nov-26` | ✓ |
| Impossible date (`31/02/2026`) | rejected, not rolled over ✓ |
| Unreadable date (wrong Date column) | error naming the line, not a silent drop ✓ |
| Mapping override | ✓ |
| Manual attribution | John's 3,000 moves to Esther; closing 58,500, still flagged ✓ |
| Set aside, then undo | returns to unknown, not silently dropped ✓ |
| A decision cannot force a duplicate | receipt still counted once ✓ |
| Page, clean file, all four screens | 58,000 reconciled, no console errors ✓ |
| Page, messy file | 55,500 vs 57,000, all findings, decisions work ✓ |
| Page, encrypted PDF | password prompt, 3 rows over 2 pages, columns mapped, statement built, no console errors ✓ |
| Page, 360 px mobile layout | no page overflow; stacked grids, 44 px+ targets, 16 px inputs/selects, scrollable step strip and detail tables, 2×2 step-4 bar; CSV and PDF flows work; no console errors, no phones ✓ |
| Page from `file://` (CSV flow) | all scripts and the stylesheet load on desktop; no server ✓ |
| PDF path in a browser | verified over a local static server; the reader uses no network calls, so `file://` behaves the same |
| Real Safaricom PDF, RC4-128, 2 pages | 54 rows in 121 ms; paid in 6,510.00 and paid out 6,317.57 exactly match the statement's summary ✓ |
| Real statement shape | every row has a receipt, a date-time, and a status; wrapped `Details` merged ✓ |
| Empty and wrong PDF passwords | rejected up front as `BAD_PASSWORD`, never as a garbled table ✓ |
| Non-PDF bytes | rejected as `NOT_PDF` ✓ |
| Downloaded JSON | no phone numbers, schema-valid ✓ |
| Tests | 19 importer + 12 PDF + 9 renderer ✓ |

## Next

The importer is complete for the concierge work: one statement, one member list, one printed
deliverable. It has now been run against one real encrypted Safaricom PDF and matched that
statement's own totals to the cent.

What it still needs is **variety**: statements from a few more groups, a longer date range, and any
layout change Safaricom ships. The table reader is deliberately strict, so a new layout fails loudly
rather than producing a plausible wrong table. Keep the CSV export as the fallback and add a test
fixture before supporting a new shape.

The honest next steps are business, not code: run the 10 interviews, deliver one statement for
KSh 500, and only then decide whether the page needs history, members stored between months, or a
server.

