/*
 * Chama statement renderer.
 *
 * Pure functions only. This file knows nothing about where the data comes from:
 * no fetch, no file reading, no DOM queries. Give it an object, get back HTML.
 *
 * Loads three ways:
 *   1. <script src="render.js"></script>      -> window.ChamaStatement      (browser, file:// safe)
 *   2. require("./render.js")                 -> { compute, validate, ... } (Node tests)
 *   3. future app: import the module / use the global
 *
 * Data contract: see schema.md in this folder.
 */
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ChamaStatement = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  /* ---------- primitives ---------- */

  function num(value) {
    var n = Number(value);
    return isFinite(n) ? n : 0;
  }

  function sum(list) {
    return (list || []).reduce(function (total, value) {
      return total + num(value);
    }, 0);
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function fmt(amount) {
    return "KSh " + new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 }).format(Math.round(num(amount)));
  }

  function toDate(iso) {
    if (!iso) return null;
    var parts = String(iso).split("-").map(Number);
    return parts.length === 3 ? new Date(parts[0], parts[1] - 1, parts[2]) : null;
  }

  function fmtDate(iso) {
    var d = toDate(iso);
    return d ? String(d.getDate()).padStart(2, "0") + " " + MONTHS[d.getMonth()] : "—";
  }

  function daysBetween(from, to) {
    var a = toDate(from);
    var b = toDate(to);
    if (!a || !b) return 0;
    return Math.round((b - a) / 86400000);
  }

  function inPeriod(data, iso) {
    return !!iso && iso >= data.periodStart && iso <= data.periodEnd;
  }

  /* ---------- normalise ---------- */
  // Missing fields must never crash the renderer. Everything becomes a safe default.
  function normalize(input) {
    var d = input || {};
    var balances = d.statementBalances || {};

    return {
      sample: Boolean(d.sample),
      group: d.group || "",
      period: d.period || "",
      periodStart: d.periodStart || "",
      periodEnd: d.periodEnd || "",
      preparedBy: d.preparedBy || "",
      verifiedBy: d.verifiedBy || "",
      openingBalance: num(d.openingBalance),
      statementBalances: { mpesa: num(balances.mpesa), cash: num(balances.cash) },
      members: (d.members || []).map(function (m) {
        return {
          name: m.name || "",
          expected: num(m.expected),
          paid: num(m.paid),
          date: m.date || "",
          ref: m.ref || "",
          note: m.note || "",
        };
      }),
      loans: (d.loans || []).map(function (l) {
        return {
          member: l.member || "",
          principal: num(l.principal),
          interest: num(l.interest),
          disbursedOn: l.disbursedOn || "",
          dueOn: l.dueOn || "",
          repaidToDate: num(l.repaidToDate),
          repaidThisPeriod: num(l.repaidThisPeriod),
        };
      }),
      otherIncome: (d.otherIncome || []).map(function (i) {
        return { date: i.date || "", item: i.item || "", amount: num(i.amount), ref: i.ref || "" };
      }),
      expenses: (d.expenses || []).map(function (e) {
        return { date: e.date || "", item: e.item || "", amount: num(e.amount), approvedBy: e.approvedBy || "" };
      }),
      notes: (d.notes || []).slice(),
    };
  }

  /* ---------- compute ---------- */
  // Every figure on the page comes from here. No arithmetic in the template.
  function compute(input) {
    var d = normalize(input);

    var totalExpected = sum(d.members.map(function (m) { return m.expected; }));
    var totalPaid = sum(d.members.map(function (m) { return m.paid; }));
    var arrears = totalExpected - totalPaid;
    var arrearsMembers = d.members.filter(function (m) { return m.paid < m.expected; });

    var loanRepayments = sum(d.loans.map(function (l) { return l.repaidThisPeriod; }));
    var newLoans = sum(d.loans.filter(function (l) { return inPeriod(d, l.disbursedOn); }).map(function (l) { return l.principal; }));
    var otherIncome = sum(d.otherIncome.map(function (i) { return i.amount; }));
    var totalExpenses = sum(d.expenses.map(function (e) { return e.amount; }));

    var closing = d.openingBalance + totalPaid + loanRepayments + otherIncome - newLoans - totalExpenses;
    var stated = d.statementBalances.mpesa + d.statementBalances.cash;
    var difference = closing - stated;

    var loanRows = d.loans.map(function (l) {
      var total = l.principal + l.interest;
      var outstanding = Math.max(total - l.repaidToDate, 0);
      var status, cls;
      if (outstanding === 0) {
        status = "Cleared";
        cls = "ok";
      } else if (l.dueOn && l.dueOn < d.periodEnd) {
        status = "Overdue " + daysBetween(l.dueOn, d.periodEnd) + " days";
        cls = "bad";
      } else {
        status = "Due " + fmtDate(l.dueOn);
        cls = "warn";
      }
      return {
        member: l.member,
        principal: l.principal,
        interest: l.interest,
        disbursedOn: l.disbursedOn,
        dueOn: l.dueOn,
        repaidToDate: l.repaidToDate,
        outstanding: outstanding,
        status: status,
        cls: cls,
      };
    });

    return {
      data: d,
      totalExpected: totalExpected,
      totalPaid: totalPaid,
      arrears: arrears,
      arrearsMembers: arrearsMembers,
      loanRepayments: loanRepayments,
      newLoans: newLoans,
      otherIncome: otherIncome,
      totalExpenses: totalExpenses,
      closing: closing,
      stated: stated,
      difference: difference,
      reconciled: Math.abs(difference) < 1,
      loanRows: loanRows,
      loanOutstanding: sum(loanRows.map(function (l) { return l.outstanding; })),
      loanOverdue: sum(
        loanRows
          .filter(function (l) { return l.outstanding > 0 && l.dueOn && l.dueOn < d.periodEnd; })
          .map(function (l) { return l.outstanding; })
      ),
    };
  }

  /* ---------- validate ---------- */
  // Returns [{ level: "error" | "warn", message }]. Errors mean: do not send this.
  function validate(input) {
    var d = normalize(input);
    var c = compute(d);
    var issues = [];
    var add = function (level, message) { issues.push({ level: level, message: message }); };

    if (!d.group) add("error", "Missing group name.");
    if (!d.period || !d.periodStart || !d.periodEnd) add("error", "Missing period name or start/end dates.");
    if (!d.members.length) add("error", "No members listed.");
    if (!d.statementBalances.mpesa && !d.statementBalances.cash) {
      add("error", "No account balances given — reconciliation cannot be checked.");
    }

    // The same M-Pesa receipt counted twice is the most common real-world error.
    var seen = {};
    d.members.forEach(function (m) {
      if (!m.ref) return;
      if (seen[m.ref]) {
        add("error", "Receipt " + m.ref + " appears more than once — the same payment may be counted twice.");
      }
      seen[m.ref] = true;
    });

    d.members.forEach(function (m) {
      if (m.paid > m.expected) add("warn", m.name + " paid " + fmt(m.paid - m.expected) + " more than expected.");
      if (m.date && !inPeriod(d, m.date)) add("warn", m.name + "'s payment date (" + fmtDate(m.date) + ") is outside this period.");
    });

    d.loans.forEach(function (l) {
      if (l.dueOn && l.disbursedOn && l.dueOn < l.disbursedOn) {
        add("error", l.member + "'s loan is due before it was disbursed.");
      }
      if (l.repaidToDate > l.principal + l.interest) {
        add("warn", l.member + " has repaid more than principal + interest.");
      }
    });

    d.expenses.forEach(function (e) {
      if (e.date && !inPeriod(d, e.date)) add("warn", "Expense \"" + e.item + "\" is dated outside this period.");
    });

    if (!c.reconciled) {
      add("error", "Accounts do not reconcile: the statement closes at " + fmt(c.closing) + " but the accounts hold " + fmt(c.stated) + " (difference " + fmt(Math.abs(c.difference)) + ").");
    }

    return issues;
  }

  /* ---------- render ---------- */

  function issuesBanner(issues) {
    if (!issues.length) return "";
    var errors = issues.filter(function (i) { return i.level === "error"; });
    var warns = issues.filter(function (i) { return i.level === "warn"; });
    var head = errors.length
      ? "<b>" + errors.length + " problem" + (errors.length === 1 ? "" : "s") + " must be fixed before this statement is sent.</b>"
      : "<b>Check these before sending.</b>";
    var items = issues
      .map(function (i) {
        return "<li><span style='font-weight:600'>" + (i.level === "error" ? "Error" : "Note") + ":</span> " + esc(i.message) + "</li>";
      })
      .join("");
    return (
      "<div class='issues " + (errors.length ? "issues-error" : "issues-warn") + "'>" +
      head +
      "<ul>" + items + "</ul>" +
      "</div>"
    );
  }

  function render(input) {
    var c = compute(input);
    var d = c.data;
    var issues = validate(d);

    var sampleBanner = d.sample
      ? "<div class='no-print sample-banner'>SAMPLE DATA — replace the payload before sending. Set <b>sample: false</b> to hide this notice.</div>"
      : "";

    var memberRows = d.members
      .map(function (m, index) {
        var balance = m.expected - m.paid;
        var badge =
          balance <= 0
            ? "<span class='badge ok'>Paid</span>"
            : m.paid > 0
            ? "<span class='badge warn'>Partial</span>"
            : "<span class='badge bad'>Unpaid</span>";
        return (
          "<tr>" +
          "<td class='n'>" + (index + 1) + "</td>" +
          "<td>" + esc(m.name) + (m.note ? "<br><span class='note-inline'>" + esc(m.note) + "</span>" : "") + "</td>" +
          "<td class='n'>" + fmt(m.expected) + "</td>" +
          "<td class='n'>" + fmt(m.paid) + "</td>" +
          "<td class='n" + (balance > 0 ? " neg" : "") + "'>" + (balance > 0 ? fmt(balance) : "—") + "</td>" +
          "<td class='n'>" + fmtDate(m.date) + "</td>" +
          "<td class='ref'>" + esc(m.ref) + "</td>" +
          "<td>" + badge + "</td>" +
          "</tr>"
        );
      })
      .join("");

    var loanTable = c.loanRows
      .map(function (l) {
        return (
          "<tr>" +
          "<td>" + esc(l.member) + "</td>" +
          "<td class='n'>" + fmt(l.principal) + "</td>" +
          "<td class='n'>" + fmt(l.interest) + "</td>" +
          "<td class='n'>" + fmtDate(l.disbursedOn) + "</td>" +
          "<td class='n'>" + fmtDate(l.dueOn) + "</td>" +
          "<td class='n'>" + fmt(l.repaidToDate) + "</td>" +
          "<td class='n'><b>" + fmt(l.outstanding) + "</b></td>" +
          "<td><span class='badge " + l.cls + "'>" + esc(l.status) + "</span></td>" +
          "</tr>"
        );
      })
      .join("");

    var expenseRows = d.expenses
      .map(function (e) {
        return (
          "<tr><td class='n'>" + fmtDate(e.date) + "</td><td>" + esc(e.item) + "</td><td>" + esc(e.approvedBy) + "</td><td class='n'>" + fmt(e.amount) + "</td></tr>"
        );
      })
      .join("");

    var incomeRows = d.otherIncome
      .map(function (e) {
        return (
          "<tr><td class='n'>" + fmtDate(e.date) + "</td><td>" + esc(e.item) + "</td><td class='ref'>" + esc(e.ref) + "</td><td class='n'>" + fmt(e.amount) + "</td></tr>"
        );
      })
      .join("");

    var arrearsText = c.arrearsMembers.length
      ? c.arrearsMembers.length + " member" + (c.arrearsMembers.length === 1 ? "" : "s") + " owe " + fmt(c.arrears)
      : "All members are up to date";

    var recon =
      "<div class='recon'>" +
      "<strong>Reconciliation</strong><br>" +
      "M-Pesa balance " + fmt(d.statementBalances.mpesa) +
      " &nbsp;+&nbsp; cash on hand " + fmt(d.statementBalances.cash) +
      " &nbsp;=&nbsp; <b>" + fmt(c.stated) + "</b><br>" +
      "Statement closing balance: <b>" + fmt(c.closing) + "</b><br>" +
      (c.reconciled
        ? "<span class='ok'>✓ Reconciled.</span> The books agree with the accounts."
        : "<span class='bad'>✗ Does not reconcile — difference of " + fmt(Math.abs(c.difference)) + ".</span> Fix the figures before sending.") +
      "</div>";

    var notes = d.notes.length
      ? d.notes.map(function (n) { return "<p class='note'>• " + esc(n) + "</p>"; }).join("")
      : "<p class='note'>None.</p>";

    return (
      sampleBanner +
      issuesBanner(issues) +
      "<header>" +
      "<div class='kicker'>Monthly accountability statement</div>" +
      "<h1>" + esc(d.group) + "</h1>" +
      "<div class='sub'>" + esc(d.period) + " &nbsp;·&nbsp; " + fmtDate(d.periodStart) + " – " + fmtDate(d.periodEnd) + "</div>" +
      "<div class='meta'>" +
      "<div><span>Prepared by</span>" + esc(d.preparedBy) + "</div>" +
      "<div><span>Verified by</span>" + esc(d.verifiedBy) + "</div>" +
      "<div><span>Members</span>" + d.members.length + "</div>" +
      "<div><span>Monthly contribution</span>" + (d.members.length ? fmt(d.members[0].expected) : "—") + "</div>" +
      "</div>" +
      "</header>" +

      "<h2>1. Money in and out</h2>" +
      "<table class='summary'>" +
      "<tr><td>Opening balance (" + fmtDate(d.periodStart) + ")</td><td class='n'>" + fmt(d.openingBalance) + "</td></tr>" +
      "<tr><td>Contributions received (" + fmt(c.totalPaid) + " of " + fmt(c.totalExpected) + " expected)</td><td class='n'>+ " + fmt(c.totalPaid) + "</td></tr>" +
      "<tr><td>Loan repayments received</td><td class='n'>+ " + fmt(c.loanRepayments) + "</td></tr>" +
      "<tr><td>Other income (fines, penalties)</td><td class='n'>+ " + fmt(c.otherIncome) + "</td></tr>" +
      "<tr><td>New loans disbursed</td><td class='n'>− " + fmt(c.newLoans) + "</td></tr>" +
      "<tr><td>Expenses</td><td class='n'>− " + fmt(c.totalExpenses) + "</td></tr>" +
      "<tr class='total'><td>Closing balance (" + fmtDate(d.periodEnd) + ")</td><td class='n'>" + fmt(c.closing) + "</td></tr>" +
      "</table>" +
      recon +

      "<h2>2. Contributions — " + esc(d.period) + "</h2>" +
      "<table>" +
      "<thead><tr><th class='n'>#</th><th>Member</th><th class='n'>Expected</th><th class='n'>Paid</th><th class='n'>Balance</th><th class='n'>Date paid</th><th>M-Pesa ref</th><th>Status</th></tr></thead>" +
      "<tbody>" + memberRows + "</tbody>" +
      "<tfoot><tr><td></td><td><b>Total</b></td><td class='n'><b>" + fmt(c.totalExpected) + "</b></td><td class='n'><b>" + fmt(c.totalPaid) + "</b></td><td class='n'><b>" + fmt(c.arrears) + "</b></td><td colspan='3'><b>" + esc(arrearsText) + "</b></td></tr></tfoot>" +
      "</table>" +

      "<h2>3. Loan book at " + fmtDate(d.periodEnd) + "</h2>" +
      "<table>" +
      "<thead><tr><th>Member</th><th class='n'>Principal</th><th class='n'>Interest</th><th class='n'>Disbursed</th><th class='n'>Due</th><th class='n'>Repaid</th><th class='n'>Outstanding</th><th>Status</th></tr></thead>" +
      "<tbody>" + loanTable + "</tbody>" +
      "<tfoot><tr><td colspan='6'><b>Total outstanding</b></td><td class='n'><b>" + fmt(c.loanOutstanding) + "</b></td><td>" +
      (c.loanOverdue > 0 ? "<span class='badge bad'>Overdue " + fmt(c.loanOverdue) + "</span>" : "<span class='badge ok'>None overdue</span>") +
      "</td></tr></tfoot>" +
      "</table>" +

      "<div class='grid2'>" +
      "<div><h2>4. Other income</h2>" +
      (d.otherIncome.length
        ? "<table><thead><tr><th class='n'>Date</th><th>Item</th><th>Ref</th><th class='n'>Amount</th></tr></thead><tbody>" + incomeRows + "</tbody></table>"
        : "<p class='note'>None this period.</p>") +
      "</div>" +
      "<div><h2>5. Expenses</h2>" +
      (d.expenses.length
        ? "<table><thead><tr><th class='n'>Date</th><th>Item</th><th>Approved by</th><th class='n'>Amount</th></tr></thead><tbody>" + expenseRows + "</tbody></table>"
        : "<p class='note'>None this period.</p>") +
      "</div>" +
      "</div>" +

      "<h2>6. Notes and decisions</h2>" + notes +

      "<div class='sign'>" +
      "<div><b>" + esc(d.preparedBy) + "</b>Prepared — signature and date</div>" +
      "<div><b>" + esc(d.verifiedBy) + "</b>Verified — signature and date</div>" +
      "</div>" +

      "<footer><span>Confidential to the members of " + esc(d.group) + ".</span><span>Statement v1 · " + esc(d.period) + "</span></footer>"
    );
  }

  /* ---------- WhatsApp summary ---------- */

  function toWhatsApp(input) {
    var c = compute(input);
    var d = c.data;
    var lines = [
      "*" + d.group + " — " + d.period + "*",
      "",
      "Opening: " + fmt(d.openingBalance),
      "Contributions: " + fmt(c.totalPaid) + " of " + fmt(c.totalExpected),
      "Arrears: " + fmt(c.arrears) + " (" + c.arrearsMembers.length + " member" + (c.arrearsMembers.length === 1 ? "" : "s") + ")",
      "Loan repayments in: " + fmt(c.loanRepayments),
      "New loans out: " + fmt(c.newLoans),
      "Expenses: " + fmt(c.totalExpenses),
      "*Closing balance: " + fmt(c.closing) + "*",
      "(M-Pesa " + fmt(d.statementBalances.mpesa) + " + cash " + fmt(d.statementBalances.cash) + (c.reconciled ? " — reconciled)" : " — DOES NOT RECONCILE)"),
      "",
      "Loans outstanding: " + fmt(c.loanOutstanding) + (c.loanOverdue > 0 ? " (overdue " + fmt(c.loanOverdue) + ")" : ""),
      "",
      "Full statement attached.",
    ];
    return lines.join("\n");
  }

  return {
    compute: compute,
    validate: validate,
    render: render,
    toWhatsApp: toWhatsApp,
    normalize: normalize,
    fmt: fmt,
    fmtDate: fmtDate,
  };
});
