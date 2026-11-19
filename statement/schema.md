# Statement data contract

`render.js` turns one JSON object into the printed statement. This page is that object's
specification. If the app, the importer and the export all agree with this file, they agree with
each other.

Everything is a **whole Kenya shilling**, as a JSON number — `2000`, not `"KSh 2,000"` and not
`2000.00`. Formatting happens only at render time.

## Top level

| Field | Type | Required | Meaning |
|---|---|---|---|
| `group` | string | **yes** | Group name as members know it |
| `period` | string | **yes** | Display label, e.g. `"November 2026"` |
| `periodStart` | `YYYY-MM-DD` | **yes** | First day of the period |
| `periodEnd` | `YYYY-MM-DD` | **yes** | Last day; also the loan book "as at" date |
| `openingBalance` | number | **yes** | Balance carried from the previous statement |
| `statementBalances` | object | **yes** | `{ mpesa, cash }` — what the accounts actually hold |
| `members` | array | **yes** | See below |
| `loans` | array | no | Defaults to `[]` |
| `otherIncome` | array | no | Fines, penalties, interest received. Defaults to `[]` |
| `expenses` | array | no | Defaults to `[]` |
| `notes` | string[] | no | Committee decisions and explanations |
| `preparedBy` | string | no | Name and role |
| `verifiedBy` | string | no | Chair's name and role |
| `sample` | boolean | no | `true` shows the "SAMPLE DATA" banner |

## `members[]`

| Field | Type | Required | Meaning |
|---|---|---|---|
| `name` | string | **yes** | As it appears on the member list |
| `expected` | number | **yes** | What they owed this period |
| `paid` | number | **yes** | What actually arrived |
| `date` | `YYYY-MM-DD` | no | Date of the payment; `""` if unpaid |
| `ref` | string | no | M-Pesa receipt number; `""` if unpaid. Multiple receipts are comma-separated |
| `phone` | string | no | Member's M-Pesa number. Used **only** by the importer to match a transaction; never printed |
| `note` | string | no | Short clarification shown under the name |

`phone` is deliberately optional. With it, the importer matches on the number and never guesses a name.
Without it, it falls back to name matching and tells you when a name is ambiguous. It is accepted as
**input** in the group config and is never carried into the statement the importer emits — the phone
number stays with the treasurer's own file, not in a PDF that circulates on WhatsApp.

## `loans[]`

| Field | Type | Required | Meaning |
|---|---|---|---|
| `member` | string | **yes** | Borrower |
| `principal` | number | **yes** | Amount lent |
| `interest` | number | no | Interest charged; `0` if none |
| `disbursedOn` | `YYYY-MM-DD` | **yes** | Determines whether it counts as "new loans" this period |
| `dueOn` | `YYYY-MM-DD` | **yes** | Used to calculate "Overdue N days" |
| `repaidToDate` | number | **yes** | Total repaid since disbursement (not just this period) |
| `repaidThisPeriod` | number | **yes** | Repayments received inside this period |

Outstanding is **derived**: `principal + interest − repaidToDate`. Never store it; if you do, it will
eventually disagree with the movements table.

## `otherIncome[]`

| Field | Type | Required |
|---|---|---|
| `date` | `YYYY-MM-DD` | **yes** |
| `item` | string | **yes** |
| `amount` | number | **yes** |
| `ref` | string | no |

## `expenses[]`

| Field | Type | Required |
|---|---|---|
| `date` | `YYYY-MM-DD` | **yes** |
| `item` | string | **yes** |
| `amount` | number | **yes** |
| `approvedBy` | string | no |

## The invariants — what must always be true

1. **The movement identity.** This is the whole product:

   ```
   openingBalance
     + sum(members[].paid)
     + sum(loans[].repaidThisPeriod)
     + sum(otherIncome[].amount)
     − sum(loans[].principal where disbursedOn is in period)
     − sum(expenses[].amount)
     = statementBalances.mpesa + statementBalances.cash
   ```

   `validate()` returns an error when it fails, and the page prints the difference.

2. **No receipt number appears twice** in `members[].ref`. A duplicated receipt is the most common
   real-world error, and it silently inflates the balance.

3. **Dates are inside the period** for payments and expenses. Outside dates are flagged as notes,
   not silent.

4. **A loan is due after it is disbursed.** Anything else is a data-entry error.

5. **Never merge money in and money out.** A withdrawal to a member is a loan disbursement, not a
   negative contribution. Keeping them separate is what makes the reconciliation possible.

## Comparison with v0

The v0 file computed the same numbers. Three things changed:

| v0 | v1 |
|---|---|
| Arithmetic inline in the template | `compute()` returns a result object; the template only formats |
| No checks — a wrong figure printed happily | `validate()` returns errors; the page shows them |
| Duplicate receipts invisible | Duplicate receipts rejected |
| `render()` unreachable from code | `ChamaStatement.render(data)` — callable from the app and from Node |

## How the app will use it

```js
// Step 2 (importer) produces exactly this shape, then:
document.getElementById("doc").innerHTML = ChamaStatement.render(statement);

// Node test, no browser:
const { compute, validate } = require("./render.js");
const result = compute(fixture);
assert.equal(result.closing, 136850);
```

The renderer never learns where the data came from. That is the point of Step 1, and it is what lets
you test the money maths without a browser.
