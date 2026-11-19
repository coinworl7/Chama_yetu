// Tests for import.js. No browser, no dependencies.
//
//   node --test projects/chama-ledger/importer/test/import.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const importer = require("../import.js");
const renderer = require("../../statement/render.js");

const fixture = (name) => fs.readFileSync(path.join(__dirname, "..", "fixtures", name), "utf8");
const group = (name) => JSON.parse(fixture(name));

/* ---------- CSV ---------- */

test("parses quoted commas, escaped quotes, CRLF and a BOM", () => {
  const text = '\uFEFFa,b,c\r\n1,"Funds from DOE, J.","said ""hello"""\r\n2,x,y\r\n';
  const parsed = importer.parseCsv(text);

  assert.deepEqual(parsed.headers, ["a", "b", "c"]);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0][1], "Funds from DOE, J.");
  assert.equal(parsed.rows[0][2], 'said "hello"');
});

test("pads short rows and drops empty lines", () => {
  const parsed = importer.parseCsv('a,b,c\n1,2\n\n3,4,5\n');
  assert.equal(parsed.rows.length, 2);
  assert.deepEqual(parsed.rows[0], ["1", "2", ""]);
});

test("recognises a Safaricom header row", () => {
  const headers = ["Receipt No.", "Completion Time", "Details", "Transaction Status", "Paid In", "Withdrawn", "Balance"];
  assert.deepEqual(importer.guessMapping(headers), {
    receipt: 0,
    date: 1,
    details: 2,
    paidIn: 4,
    withdrawn: 5,
    status: 3,
  });
});

/* ---------- values ---------- */

test("parses amounts the way statements write them", () => {
  assert.equal(importer.parseAmount("2,000"), 2000);
  assert.equal(importer.parseAmount("KSh 1,000.00"), 1000);
  assert.equal(importer.parseAmount(""), 0);
  assert.equal(importer.parseAmount("(1,500)"), -1500);
  assert.equal(importer.parseAmount("-500"), -500);
});

test("parses both date formats", () => {
  assert.equal(importer.parseDate("2026-11-02 09:14:00"), "2026-11-02");
  assert.equal(importer.parseDate("02/11/2026"), "2026-11-02");
  assert.equal(importer.parseDate("not a date"), "");
});

test("reads the date variants a real export might use, and rejects impossible ones", () => {
  assert.equal(importer.parseDate("2/11/2026"), "2026-11-02");
  assert.equal(importer.parseDate("02/11/26"), "2026-11-02");
  assert.equal(importer.parseDate("02-11-2026"), "2026-11-02");
  assert.equal(importer.parseDate("2026-1-2"), "2026-01-02");
  assert.equal(importer.parseDate("02 Nov 2026"), "2026-11-02");
  assert.equal(importer.parseDate("2-Nov-26 09:14"), "2026-11-02");
  assert.equal(importer.parseDate("31/02/2026"), "");
  assert.equal(importer.parseDate("13/13/2026"), "");
});

test("an unreadable date is an error, not a silent out-of-period row", () => {
  const csv = [
    "Receipt No.,Completion Time,Details,Transaction Status,Paid In,Withdrawn,Balance",
    'SL1,5-Nov-26,"Funds received from ALICE MWANGI 254712000001",COMPLETE,2000,,0',
  ].join("\n");

  const data = group("group-clean.json");
  data.periodStart = "2026-11-01";
  data.periodEnd = "2026-11-30";

  // Date column pointing at the wrong field: every row becomes unreadable.
  const { statement, report } = importer.buildStatement(data, csv, {
    receipt: 0,
    date: 5, // Withdrawn, not a date
    details: 2,
    status: 3,
    paidIn: 4,
    withdrawn: 6,
  });

  assert.equal(report.unparsedDates.length, 1);
  assert.equal(report.outsidePeriod.length, 0);
  assert.equal(statement.members.find((m) => m.name === "Alice Mwangi").paid, 0);
  assert.ok(report.issues.some((i) => i.level === "error" && /cannot read/.test(i.message)));
});

test("normalises phone numbers to 2547XXXXXXXX", () => {
  assert.equal(importer.normalizePhone("0712000001"), "254712000001");
  assert.equal(importer.normalizePhone("+254712000001"), "254712000001");
  assert.equal(importer.normalizePhone("254-712-000001"), "254712000001");
  assert.equal(importer.normalizePhone("712000001"), "254712000001");
  assert.equal(importer.normalizePhone("12345"), "");
});

test("finds a phone inside a messy Details string", () => {
  assert.equal(importer.extractPhone("Funds received from 254712000002 - BRIAN KIPTOO"), "254712000002");
  assert.equal(importer.extractPhone("Funds received from DAVID OCHIENG, 0712 000 004"), "254712000004");
  assert.equal(importer.extractPhone("Deposit from CAROLINE NJERI"), "");
});

/* ---------- matching ---------- */

test("matches a full name, and a unique surname, but never a shared surname", () => {
  const members = [{ name: "Alice Mwangi" }, { name: "Brian Kiptoo" }];
  assert.equal(importer.matchByName("Funds received from ALICE MWANGI", members).strength, "name");

  const unique = [{ name: "Alice Mwangi" }, { name: "Brian Kiptoo" }];
  assert.equal(importer.matchByName("Deposit from KIPTOO", unique).member.name, "Brian Kiptoo");

  const shared = [{ name: "Alice Mwangi" }, { name: "Peter Mwangi" }];
  assert.equal(importer.matchByName("Deposit from MWANGI", shared), null);
});

/* ---------- build ---------- */

test("a clean statement assigns every contribution and reconciles", () => {
  const { statement, report } = importer.buildStatement(group("group-clean.json"), fixture("mpesa-clean.csv"));

  assert.equal(report.duplicates.length, 0);
  assert.equal(report.unknown.length, 0);
  assert.equal(report.outflows.length, 0);
  assert.equal(report.matched.length, 5);
  assert.deepEqual(report.issues, []);

  assert.equal(statement.members.find((m) => m.name === "Alice Mwangi").paid, 2000);
  assert.equal(statement.members.find((m) => m.name === "Esther Wambui").paid, 2000);

  // Matching used the numbers, but the emitted statement must not contain them.
  assert.equal(statement.members.every((m) => m.phone === undefined), true);

  const result = renderer.compute(statement);
  assert.equal(result.totalPaid, 10000);
  assert.equal(result.closing, 58000);
  assert.equal(result.reconciled, true);
  assert.deepEqual(renderer.validate(statement), []);
});

test("a messy statement refuses to hide what it could not explain", () => {
  const { statement, report } = importer.buildStatement(group("group-messy.json"), fixture("mpesa-messy.csv"));

  assert.equal(report.duplicates.length, 1);
  assert.equal(report.duplicates[0].receipt, "TGH1A2B3C4");
  assert.equal(report.unknown.length, 1);
  assert.equal(report.unknown[0].details.includes("JOHN KAMAU"), true);
  assert.equal(report.outflows.length, 1);
  assert.equal(report.outflows[0].amount, 1500);
  assert.equal(report.outsidePeriod.length, 1);

  // Caroline paid 1,500 of 2,000; Esther's only rows were a duplicate and an out-of-period one.
  assert.equal(statement.members.find((m) => m.name === "Caroline Njeri").paid, 1500);
  assert.equal(statement.members.find((m) => m.name === "Esther Wambui").paid, 0);

  const result = renderer.compute(statement);
  assert.equal(result.totalPaid, 7500);
  assert.equal(result.closing, 55500);
  assert.equal(result.stated, 57000);
  assert.equal(result.reconciled, false);
  // difference = closing - stated, so the statement closes 1,500 short of the accounts.
  assert.equal(result.difference, -1500);
  assert.equal(Math.abs(result.difference), 1500);

  const error = renderer.validate(statement).find((i) => i.level === "error");
  assert.match(error.message, /do not reconcile/);
  assert.match(error.message, /1,500/);
});

test("the report explains every error in words a treasurer can act on", () => {
  const { report } = importer.buildStatement(group("group-messy.json"), fixture("mpesa-messy.csv"));
  const messages = report.issues.map((i) => i.message).join("\n");

  assert.match(messages, /TGH1A2B3C4 appears more than once/);
  assert.match(messages, /JOHN KAMAU/);
  assert.match(messages, /not yet classified as an expense or a loan/);
  assert.match(messages, /outside this period/);
});

test("a human can override the column mapping", () => {
  const csv = [
    "Code,When,Narrative,Status,In,Out",
    "ABC1,2026-11-03,Alice Mwangi,COMPLETE,2000,",
  ].join("\n");

  const data = group("group-clean.json");
  data.members = [{ name: "Alice Mwangi", phone: "0712000001", expected: 2000 }];

  const { statement, report } = importer.buildStatement(data, csv, {
    receipt: 0,
    date: 1,
    details: 2,
    status: 3,
    paidIn: 4,
    withdrawn: 5,
  });

  assert.equal(report.matched.length, 1);
  assert.equal(statement.members[0].paid, 2000);
});

test("transactions that are not COMPLETE are reported, not counted", () => {
  const csv = [
    "Receipt No.,Completion Time,Details,Transaction Status,Paid In,Withdrawn,Balance",
    'XYZ1,2026-11-03 10:00:00,"Funds received from ALICE MWANGI 254712000001",FAILED,2000,,0',
  ].join("\n");

  const data = group("group-clean.json");
  const { statement, report } = importer.buildStatement(data, csv);

  assert.equal(report.incomplete.length, 1);
  assert.equal(statement.members.find((m) => m.name === "Alice Mwangi").paid, 0);
});

test("two receipts from one member are summed, not overwritten", () => {
  const csv = [
    "Receipt No.,Completion Time,Details,Transaction Status,Paid In,Withdrawn,Balance",
    'AAA1,2026-11-03 10:00:00,"Funds received from ALICE MWANGI 254712000001",COMPLETE,1000,,0',
    'BBB2,2026-11-20 10:00:00,"Funds received from ALICE MWANGI 254712000001",COMPLETE,1000,,0',
  ].join("\n");

  const data = group("group-clean.json");
  const { statement, report } = importer.buildStatement(data, csv);
  const alice = statement.members.find((m) => m.name === "Alice Mwangi");

  assert.equal(alice.paid, 2000);
  assert.equal(alice.ref, "AAA1, BBB2");
  assert.equal(report.multiPayment.length, 1);
});

/* ---------- human decisions ---------- */

test("a person can attribute an unknown payment to a member", () => {
  const { statement, report } = importer.buildStatement(
    group("group-messy.json"),
    fixture("mpesa-messy.csv"),
    null,
    { "9": "Esther Wambui" } // line 9 = the JOHN KAMAU row
  );

  assert.equal(report.unknown.length, 0);
  assert.equal(report.ignored.length, 0);

  const esther = statement.members.find((m) => m.name === "Esther Wambui");
  assert.equal(esther.paid, 3000);
  assert.match(esther.ref, /TGH8K9L0M1/);

  const manual = report.matched.find((m) => m.via === "manual");
  assert.equal(manual.member, "Esther Wambui");
  assert.equal(manual.amount, 3000);

  // The unclassified outflow is still unexplained, so the month still refuses to balance.
  const result = renderer.compute(statement);
  assert.equal(result.totalPaid, 10500);
  assert.equal(result.difference, 1500);
  assert.equal(result.reconciled, false);
});

test("a person can set a row aside without silencing it", () => {
  const { statement, report } = importer.buildStatement(
    group("group-messy.json"),
    fixture("mpesa-messy.csv"),
    null,
    { "9": "__ignore__" }
  );

  assert.equal(report.unknown.length, 0);
  assert.equal(report.ignored.length, 1);
  assert.equal(report.ignored[0].amount, 3000);

  // Ignoring money does not make the arithmetic agree; it only stops the guessing.
  const result = renderer.compute(statement);
  assert.equal(result.totalPaid, 7500);
  assert.equal(result.reconciled, false);
  assert.ok(report.issues.some((i) => /set aside by hand/.test(i.message)));
});

test("a human decision cannot force a duplicate through", () => {
  const { statement, report } = importer.buildStatement(
    group("group-messy.json"),
    fixture("mpesa-messy.csv"),
    null,
    { "7": "Alice Mwangi" } // line 7 repeats receipt TGH1A2B3C4
  );

  assert.equal(report.duplicates.length, 1);
  assert.equal(statement.members.find((m) => m.name === "Alice Mwangi").paid, 2000);
});
