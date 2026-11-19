# 14-day validation sprint — Nov 16 to Nov 29, 2026

**Budget:** ~20 hours total. **Deliverable:** three statements delivered, and a yes or no on whether
anyone pays KSh 500.

Rules for the two weeks:

- No application code. The only file you touch is `statement/statement.html`.
- Every conversation gets a note within an hour, in their words.
- You are allowed to be wrong about the segment. You are not allowed to skip the kill checks.

---

## Week 1 — conversations (Nov 16–22)

| Day | Time | Task | Output |
|---|---|---|---|
| **Mon 16** | 2 h | Write 10 reachable names in `leads.csv`. Find phone numbers. Rank by how easily they'd take your call. | 10 rows, at least 7 with a number |
| **Tue 17** | 1 h | Send the intro message to the top 5. Do not pitch. Ask for 20 minutes about record-keeping. | 5 messages sent |
| **Wed 18** | 2 h | Two interviews, 20 min each, plus notes. Use `interview-script.md` verbatim. | 2 notes, 2 scores |
| **Thu 19** | 2 h | Two interviews. | 4 total |
| **Fri 20** | 2 h | Two interviews. Follow up with Tuesday's non-responders once. | 6 total |
| **Sat 21** | 2 h | Two interviews. Start filling the statement template with the worst case you heard. | 8 total |
| **Sun 22** | 2 h | Two interviews. Score all ten. | 10 notes, scores |

**KILL CHECK 1 (Sun 22):** of ten treasurers, **at least 6** must describe a specific money dispute or
a monthly reconciliation problem, and **at least 4** must say they would pay something to avoid it.

- Pass → week 2.
- Fail → do not build. Change one variable and repeat: (a) different segment, e.g. church building
  funds; (b) different entry offer, e.g. a free arrears reminder service; (c) different buyer, e.g.
  the accountant who serves several groups.

## Week 2 — money (Nov 23–29)

| Day | Time | Task | Output |
|---|---|---|---|
| **Mon 23** | 2 h | Pick the 3 highest scores. Ask for last month's records: member list, contribution amount, M-Pesa statement (redact balances if they want). | 3 datasets, or 3 refusals |
| **Tue 24** | 3 h | Build all three statements in `statement.html`. Force the reconciliation to balance — that is the whole product. | 3 PDFs |
| **Wed 25** | 2 h | Walk group 1 through theirs live. Ask: "what is wrong, what is missing, what would the chair ask?" | Revised template |
| **Thu 26** | 2 h | Deliver 2 and 3. Then ask for **KSh 500**, to your Till, no apology and no discount. | 2 asks |
| **Fri 27** | 1 h | Follow up. If they hesitate, ask what it would take — not for a discount, for the missing feature. | Answers |
| **Sat 28** | 1 h | One revision each. Note which fields they actually looked at; delete the ones they ignored. | Final 3 |
| **Sun 29** | 2 h | Count payments. Write the decision record. | Decision |

**KILL CHECK 2 (Sun 29):** **at least 1 of 3 pays KSh 500.**

- 1–3 paid → you have a business hypothesis with evidence. Next step is repeatability: 10 more
  groups, same offer, same script. Then build the automation that removes your manual work.
- 0 paid but strong engagement → the *statement* is valued and the *price or payer* is wrong. Test
  KSh 200 once, or move the buyer to the chair, or sell the bookkeeping retainer instead.
- 0 paid and no engagement → stop. You learned it in 14 days for the cost of one statement template.
  That is a good outcome, not a failure.

---

## If you cannot find 10 names

In order:

1. **Family.** A parent, aunt or cousin is almost always in a welfare group. Ask for an introduction,
   not for their data.
2. **Church or mosque.** Ask the welfare or building-fund committee treasurer. One conversation often
   leads to two more committees.
3. **Your university.** Alumni associations, staff welfare groups, hostel committees.
4. **Market or transport associations.** Harder to reach, higher stakes, cash-heavy.
5. **An accountant.** Someone who already prepares returns for small groups serves five or ten. Offer
   them KSh 200 per introduction, or a free statement for their own group. This is the highest-leverage
   route and it is worth doing in week 1 even if you already have names.

## What "done" looks like on Nov 29

- 10 interview notes with scores.
- 3 real statements, reconciled.
- At least one payment, or a documented reason why not.
- One paragraph: *who pays, for what, and how often.*

If you have those four things, the product decision writes itself.
