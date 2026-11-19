# Statement module

Step 1 of the build: separate the **data** from the **presentation**, so the same renderer can serve a
manual PDF today and the importer tomorrow.

## Files

| File | Role | Contains arithmetic? |
|---|---|---|
| `render.js` | The whole engine: `normalize`, `compute`, `validate`, `render`, `toWhatsApp` | **Yes — only here** |
| `statement.html` | Shell: the JSON payload + 6 lines of wiring | No |
| `statement.css` | Screen and print styles, shared with the importer's preview | No |
| `schema.md` | The data contract and the five invariants | — |
| `test/render.test.cjs` | 9 tests, no browser, no dependencies | — |

The rule that makes this useful: **`render.js` never learns where its data came from.** No `fetch`,
no file input, no DOM lookups. Give it an object, get back a string.

## Before and after

| | v0 (single file) | v1 (this) |
|---|---|---|
| Data | A literal buried mid-file | An argument: `render(data)` |
| Arithmetic | Inside template strings | `compute()` returns a result object |
| Checks | None — a wrong number printed happily | `validate()` returns errors; the page shows them |
| Duplicate receipts | Invisible | Rejected with a message |
| Testable | Only by opening a browser | `node --test`, no browser |
| Reusable | No | Same call from the app, a script, or a test |

## How to use it

**Manual, for the concierge work:**
1. Open `statement.html` (double-click works — no server needed). Keep `render.js` and
   `statement.css` in the same folder; the page loads both from beside it.
2. Edit the `<script id="payload">` block.
3. Print → Save as PDF → share to WhatsApp.

**With a separate data file:** toolbar → **Load JSON** → pick a `.json` file. That is the same call
the app will make, so the manual workflow already exercises the real code path.

**As a library:**

```js
// browser
document.getElementById("doc").innerHTML = ChamaStatement.render(statement);

// node
const { compute, validate } = require("./render.js");
compute(statement).closing;   // 136850
```

## Verify it (three commands)

```powershell
cd "C:\Users\Administrator\Documents\Default Project"

# 1. The money maths, without a browser
node --test projects/chama-ledger/statement/test/render.test.cjs

# 2. Serve it, then open http://127.0.0.1:8137/projects/chama-ledger/statement/statement.html
npx serve .

# 3. Or just double-click statement.html - it works from file://
```

Expected: `pass 9`, `fail 0`. If a number changes in the sample, the tests fail — that is the point.

## What was verified

| Check | Result |
|---|---|
| Same closing balance as v0 | KSh 136,850 ✓ |
| Reconciliation | M-Pesa 112,850 + cash 24,000 = 136,850 ✓ |
| Arrears / loans / overdue | KSh 5,000 · KSh 30,500 · KSh 3,500 ✓ |
| Console errors | none |
| Wrong account balances | error banner: "Accounts do not reconcile … difference KSh 26,850" ✓ |
| Duplicate receipt | error: "Receipt TGH4X8K2LM appears more than once" ✓ |
| Empty payload | renders 4 errors instead of crashing ✓ |
| Opens from `file://` | `render.js` loads, page renders ✓ |
| Node tests | 9 passed ✓ |

One test failed on the first run — the overpayment case — because increasing a member's payment
breaks reconciliation unless the extra money also appears in the account balances. The **test was
wrong, not the code**: the validator was correctly refusing an impossible month. Fixed by adding the
matching KSh 500 to the M-Pesa balance.

## The six moves, if you want to repeat this on another project

1. **Freeze the output.** Save a copy of the working page; note three numbers it prints.
2. **Lift the primitives.** Move `fmt`, date helpers, rounding into functions at the top.
3. **Lift the arithmetic into `compute()`.** It returns an object, not markup. No template string
   may contain a `+`, `-`, `*` or `/` after this step.
4. **Lift the markup into `render(data)`.** It calls `compute()` once and only formats the result.
5. **Add `validate(data)`.** Return `{ level, message }`. Every rule you had to explain to a treasurer
   becomes a check.
6. **Wire the shell.** The HTML loads the script, parses a payload, calls `render`. Nothing else.

Acceptance test for step 3: search the template for arithmetic operators. If you find one, the
refactor is not done.

## Limits, deliberately

- One statement per file. History and carry-forward come with the database, not here.
- No persistence, no login, no upload. That is Step 2.
- Currency is hard-coded to KSh. If a Ugandan group ever appears, that becomes a data field.

## Next: Step 2

The importer will produce exactly the shape in `schema.md`, then call:

```js
draw(statementFromImporter);
```

No changes to `render.js` should be needed. If Step 2 forces a change here, the contract in
`schema.md` was incomplete — fix the contract first, then the code.
