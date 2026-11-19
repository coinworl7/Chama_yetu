// Tests for render.js. No dependencies, no browser.
//
//   node --test projects/chama-ledger/statement/test
//
// The sample payload is read out of statement.html so the test and the page can
// never drift apart.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const renderer = require("../render.js");

function samplePayload() {
  const html = fs.readFileSync(path.join(__dirname, "..", "statement.html"), "utf8");
  const match = /<script id="payload" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(match, "payload block not found in statement.html");
  return JSON.parse(match[1]);
}

const clone = (value) => JSON.parse(JSON.stringify(value));

test("the sample month reconciles to the shilling", () => {
  const result = renderer.compute(samplePayload());

  assert.equal(result.totalExpected, 24000);
  assert.equal(result.totalPaid, 19000);
  assert.equal(result.arrears, 5000);
  assert.equal(result.loanRepayments, 6500);
  assert.equal(result.newLoans, 15000);
  assert.equal(result.totalExpenses, 2650);
  assert.equal(result.closing, 136850);
  assert.equal(result.stated, 136850);
  assert.equal(result.difference, 0);
  assert.equal(result.reconciled, true);
});

test("the sample month has no validation issues", () => {
  assert.deepEqual(renderer.validate(samplePayload()), []);
});

test("loan book derives outstanding and overdue from the movements", () => {
  const result = renderer.compute(samplePayload());
  assert.equal(result.loanOutstanding, 30500);
  assert.equal(result.loanOverdue, 3500);

  const grace = result.loanRows.find((l) => l.member === "Grace Achieng");
  assert.equal(grace.outstanding, 3500);
  assert.match(grace.status, /^Overdue \d+ days$/);
});

test("only loans disbursed inside the period count as money out", () => {
  const data = samplePayload();
  const result = renderer.compute(data);

  // Samuel's 15,000 is the only loan disbursed in November.
  assert.equal(result.newLoans, 15000);

  // Move it to October: nothing new is lent this month, so the closing balance rises by 15,000.
  const moved = clone(data);
  moved.loans.find((l) => l.member === "Samuel Kariuki").disbursedOn = "2026-10-09";
  assert.equal(renderer.compute(moved).newLoans, 0);
  assert.equal(renderer.compute(moved).closing, 151850);
});

test("a duplicated receipt is rejected", () => {
  const data = clone(samplePayload());
  data.members[1].ref = data.members[0].ref;

  const errors = renderer.validate(data).filter((i) => i.level === "error");
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /appears more than once/);
});

test("wrong account balances are reported as a reconciliation error", () => {
  const data = clone(samplePayload());
  data.statementBalances = { mpesa: 100000, cash: 10000 };

  const result = renderer.compute(data);
  assert.equal(result.closing, 136850);
  assert.equal(result.stated, 110000);
  assert.equal(result.difference, 26850);
  assert.equal(result.reconciled, false);

  const message = renderer.validate(data).find((i) => i.level === "error").message;
  assert.match(message, /do not reconcile/);
  assert.match(message, /26,850/);
});

test("an empty payload renders instead of throwing", () => {
  const html = renderer.render({});
  assert.equal(typeof html, "string");
  assert.ok(html.length > 200);
  assert.ok(renderer.validate({}).some((i) => i.level === "error"));
});

test("an overpayment is a note, not an error", () => {
  const data = clone(samplePayload());
  data.members[0].paid = 2500;
  // The extra 500 must show up in the accounts, otherwise the real error
  // (reconciliation) fires - which is the correct behaviour.
  data.statementBalances.mpesa += 500;

  const issues = renderer.validate(data);
  assert.equal(issues.filter((i) => i.level === "error").length, 0);
  assert.ok(issues.some((i) => i.level === "warn" && /more than expected/.test(i.message)));
});

test("the WhatsApp summary carries the closing balance and the reconciliation state", () => {
  const text = renderer.toWhatsApp(samplePayload());
  assert.match(text, /Closing balance: KSh 136,850/);
  assert.match(text, /reconciled/);
  assert.match(text, /Arrears: KSh 5,000 \(3 members\)/);
});
