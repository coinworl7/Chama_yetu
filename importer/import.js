/*
 * M-Pesa (or bank) statement importer.
 *
 * Pure functions. No DOM, no network, no filesystem. Give it CSV text, or a table
 * already parsed from a PDF ({ headers, rows }), plus a group config, and get back
 * a statement object in the shape documented in schema.md.
 *
 * The importer never decides that money arrived. It proposes matches, records what
 * it could not explain, and leaves the reconciliation check to refuse a bad month.
 *
 * Load: <script src="import.js"></script>  -> window.ChamaImport
 *       require("./import.js")            -> { parseCsv, ... }
 */
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ChamaImport = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* ---------- input ---------- */

  function isTable(value) {
    return Boolean(value) &&
      typeof value === "object" &&
      Array.isArray(value.headers) &&
      Array.isArray(value.rows);
  }

  // The PDF reader produces exactly the shape parseCsv() does, so both paths meet
  // here. Everything downstream sees strings and column indexes, never bytes.
  function parseTable(source) {
    if (isTable(source)) {
      return {
        headers: source.headers.map(function (h) { return String(h == null ? "" : h).trim(); }),
        rows: source.rows.map(function (row) {
          return (Array.isArray(row) ? row : []).map(function (cell) {
            return String(cell == null ? "" : cell).trim();
          });
        }),
      };
    }
    return parseCsv(source);
  }

  /* ---------- CSV ---------- */

  // RFC 4180-ish: quoted fields, escaped quotes, commas and newlines inside quotes,
  // CRLF, and a UTF-8 BOM. Hand-rolled so the demo has zero dependencies.
  function parseCsv(text) {
    var src = String(text == null ? "" : text).replace(/^\uFEFF/, "");
    var rows = [];
    var row = [];
    var field = "";
    var inQuotes = false;

    for (var i = 0; i < src.length; i += 1) {
      var ch = src[i];

      if (inQuotes) {
        if (ch === '"') {
          if (src[i + 1] === '"') {
            field += '"';
            i += 1;
          } else {
            inQuotes = false;
          }
        } else {
          field += ch;
        }
        continue;
      }

      if (ch === '"') inQuotes = true;
      else if (ch === ",") {
        row.push(field);
        field = "";
      } else if (ch === "\n") {
        row.push(field);
        field = "";
        rows.push(row);
        row = [];
      } else if (ch !== "\r") {
        field += ch;
      }
    }

    if (field.length || row.length) {
      row.push(field);
      rows.push(row);
    }

    var cleaned = rows.filter(function (r) {
      return r.some(function (cell) {
        return String(cell).trim() !== "";
      });
    });

    if (!cleaned.length) return { headers: [], rows: [] };

    var headers = cleaned[0].map(function (h) {
      return String(h).trim();
    });

    var data = cleaned.slice(1).map(function (r) {
      var out = r.slice(0, headers.length);
      while (out.length < headers.length) out.push("");
      return out;
    });

    return { headers: headers, rows: data };
  }

  var FIELD_PATTERNS = [
    ["receipt", [/receipt/i, /trans(?:action)?\s*id/i, /^code$/i, /reference/i]],
    ["date", [/completion\s*time/i, /^date/i, /date\s*time/i, /^time$/i]],
    ["details", [/details/i, /description/i, /narrative/i, /particulars/i]],
    ["paidIn", [/paid\s*in/i, /money\s*in/i, /^credit/i, /^deposit/i, /^in$/i]],
    ["withdrawn", [/withdrawn/i, /paid\s*out/i, /money\s*out/i, /^debit/i, /^out$/i]],
    ["status", [/status/i]],
  ];

  // Suggests which column is which. The UI shows this and lets a human override it.
  function guessMapping(headers) {
    var mapping = {};
    var used = {};

    FIELD_PATTERNS.forEach(function (pair) {
      var field = pair[0];
      var patterns = pair[1];
      for (var c = 0; c < headers.length; c += 1) {
        if (used[c]) continue;
        for (var p = 0; p < patterns.length; p += 1) {
          if (patterns[p].test(String(headers[c]).trim())) {
            mapping[field] = c;
            used[c] = true;
            return;
          }
        }
      }
    });

    return mapping;
  }

  /* ---------- values ---------- */

  function parseAmount(value) {
    var raw = String(value == null ? "" : value).trim();
    if (!raw) return 0;
    var negative = /^\(.*\)$/.test(raw) || raw.indexOf("-") >= 0;
    var digits = raw.replace(/[^0-9.]/g, "");
    if (!digits) return 0;
    var n = Number(digits);
    if (!isFinite(n)) return 0;
    return negative ? -n : n;
  }

  var MONTHS = {
    JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
    JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
  };

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  // A date that is impossible ("31/02/2026") is not silently moved to March.
  function isoOf(year, month, day) {
    var y = Number(year);
    var m = Number(month);
    var d = Number(day);
    if (y < 100) y += 2000;
    if (!(y >= 1900 && y <= 2200) || !(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return "";
    var probe = new Date(Date.UTC(y, m - 1, d));
    if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return "";
    return y + "-" + pad2(m) + "-" + pad2(d);
  }

  // ISO first; then DD/MM/YYYY (Kenyan statements use both), then "05-Nov-2026".
  // A 2-digit year is read as 20xx. Month names are accepted because exports vary.
  function parseDate(value) {
    var raw = String(value == null ? "" : value).trim();
    if (!raw) return "";

    var iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(raw);
    if (iso) return isoOf(iso[1], iso[2], iso[3]);

    var dmy = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/.exec(raw);
    if (dmy) return isoOf(dmy[3], dmy[2], dmy[1]);

    var named = /^(\d{1,2})[\s\-\/]([A-Za-z]{3,9})[\s\-\/](\d{2,4})/.exec(raw);
    if (named) {
      var month = MONTHS[named[2].slice(0, 3).toUpperCase()];
      if (month) return isoOf(named[3], month, named[1]);
    }

    return "";
  }

  function digitsOnly(value) {
    return String(value == null ? "" : value).replace(/\D/g, "");
  }

  // 0712 345 678 / +254712345678 / 254-712-345-678 / 712345678 -> 254712345678
  function normalizePhone(value) {
    var d = digitsOnly(value);
    if (d.length === 12 && d.indexOf("254") === 0) return d;
    if (d.length === 10 && d.charAt(0) === "0") return "254" + d.slice(1);
    if (d.length === 9 && (d.charAt(0) === "7" || d.charAt(0) === "1")) return "254" + d;
    return "";
  }

  var PHONE_RE = /(?:\+?254[\s-]?|0)((?:7|1)\d{2})[\s-]?(\d{3})[\s-]?(\d{3})/;

  function extractPhone(details) {
    var m = PHONE_RE.exec(String(details || ""));
    return m ? normalizePhone("0" + m[1] + m[2] + m[3]) : "";
  }

  /* ---------- name matching ---------- */

  var NAME_NOISE = [
    "MR", "MRS", "MS", "DR", "PROF", "CONFIRMED", "FUNDS", "RECEIVED", "FROM", "SENT",
    "TO", "PAY", "BILL", "PAYBILL", "DEPOSIT", "MOBILE", "MONEY", "TRANSFER", "FOR",
    "ACCOUNT", "THE", "AND", "LIMITED", "LTD", "COMPANY",
  ];

  function nameTokens(value) {
    return String(value || "")
      .toUpperCase()
      .replace(/[^A-Z\s]/g, " ")
      .split(/\s+/)
      .filter(function (t) {
        return t.length > 1 && NAME_NOISE.indexOf(t) === -1;
      });
  }

  function matchByName(details, members) {
    var text = " " + nameTokens(details).join(" ") + " ";
    var best = null;

    members.forEach(function (member) {
      var tokens = nameTokens(member.name);
      if (!tokens.length) return;
      var full = " " + tokens.join(" ") + " ";
      if (text.indexOf(full) !== -1) {
        best = { member: member, strength: "name" };
        return;
      }
      if (best) return;
      var surname = tokens[tokens.length - 1];
      var sameSurname = members.filter(function (m) {
        var t = nameTokens(m.name);
        return t.length && t[t.length - 1] === surname;
      });
      if (text.indexOf(" " + surname + " ") !== -1 && sameSurname.length === 1) {
        best = { member: member, strength: "surname" };
      }
    });

    return best;
  }

  /* ---------- transactions ---------- */

  function toTransactions(parsed, mapping) {
    var at = function (row, field) {
      var index = mapping[field];
      return index === undefined || index === null ? "" : row[index];
    };

    return parsed.rows.map(function (row, index) {
      return {
        line: index + 2,
        receipt: String(at(row, "receipt")).trim(),
        date: parseDate(at(row, "date")),
        rawDate: String(at(row, "date")).trim(),
        details: String(at(row, "details")).trim(),
        status: String(at(row, "status")).trim(),
        paidIn: parseAmount(at(row, "paidIn")),
        withdrawn: Math.abs(parseAmount(at(row, "withdrawn"))),
      };
    });
  }

  /* ---------- build ---------- */

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function money(n) {
    return "KSh " + new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 }).format(Math.round(n));
  }

  function shortDate(iso) {
    var parts = String(iso || "").split("-");
    if (parts.length !== 3) return iso || "";
    return Number(parts[2]) + " " + ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(parts[1]) - 1];
  }

  /*
   * group:        statement payload without members[].paid/date/ref (see schema.md)
   * source:       raw CSV export, or a { headers, rows } table from the PDF reader
   * mapping:      optional column map; guessed when omitted
   * resolutions:  optional { "<line>": "<member name>" | "__ignore__" }
   *               A human decision about a row the importer could not attribute.
   *               It is only consulted where automatic matching would run, so it can
   *               never override a duplicate, an out-of-period row or an outflow.
   * returns:      { statement, report }
   *
   * The statement always uses the group's own loans, expenses and opening balance.
   * The statement export is only trusted for contributions and for telling you what
   * it could not explain.
   */
  function buildStatement(group, source, mappingOverride, resolutions) {
    var parsed = parseTable(source);
    var mapping = mappingOverride || guessMapping(parsed.headers);
    var transactions = toTransactions(parsed, mapping);
    var decisions = resolutions || {};
    var statement = clone(group);

    statement.members = (statement.members || []).map(function (m) {
      return {
        name: m.name,
        phone: m.phone || "",
        expected: Number(m.expected) || 0,
        paid: 0,
        date: "",
        ref: "",
        note: m.note || "",
      };
    });

    var byPhone = {};
    statement.members.forEach(function (m, index) {
      var p = normalizePhone(m.phone);
      if (p) byPhone[p] = index;
    });

    var report = {
      totalTransactions: transactions.length,
      inflows: 0,
      outflows: [],
      duplicates: [],
      unparsedDates: [],
      unknown: [],
      outsidePeriod: [],
      incomplete: [],
      matched: [],
      multiPayment: [],
      ignored: [],
      mapping: mapping,
    };

    var seenReceipts = {};
    var tally = {}; // member index -> { total, refs: [], lastDate }

    transactions.forEach(function (t) {
      if (t.status && t.status.toUpperCase() !== "COMPLETE") {
        report.incomplete.push({ line: t.line, receipt: t.receipt, status: t.status, amount: t.paidIn });
        return;
      }

      if (t.withdrawn > 0) {
        report.outflows.push({ line: t.line, receipt: t.receipt, date: t.date, details: t.details, amount: t.withdrawn });
        return;
      }

      if (t.paidIn <= 0) return;

      report.inflows += 1;

      if (t.receipt) {
        if (seenReceipts[t.receipt]) {
          report.duplicates.push({ line: t.line, receipt: t.receipt, amount: t.paidIn, details: t.details });
          return;
        }
        seenReceipts[t.receipt] = true;
      }

      if (!t.date) {
        // Without a date the period check below would quietly treat the row as
        // "outside period" and drop it. A whole statement with a wrong Date column
        // would then fail reconciliation for a reason nobody could see.
        report.unparsedDates.push({ line: t.line, rawDate: t.rawDate, amount: t.paidIn, details: t.details });
        return;
      }

      if (statement.periodStart && statement.periodEnd && (t.date < statement.periodStart || t.date > statement.periodEnd)) {
        report.outsidePeriod.push({ line: t.line, date: t.date, amount: t.paidIn, details: t.details });
        return;
      }

      var decision = decisions[String(t.line)];
      if (decision === "__ignore__") {
        report.ignored.push({ line: t.line, date: t.date, amount: t.paidIn, details: t.details });
        return;
      }

      var index = -1;
      var via = "";
      var phone = extractPhone(t.details);

      if (decision) {
        // An explicit assignment by a person who knows the payer. Still only to an
        // existing member: rows that would change the member list are not accepted here.
        for (var mi = 0; mi < statement.members.length; mi += 1) {
          if (statement.members[mi].name === decision) {
            index = mi;
            via = "manual";
            break;
          }
        }
      }

      if (index < 0 && phone && byPhone[phone] !== undefined) {
        index = byPhone[phone];
        via = "phone";
      } else if (index < 0) {
        var byName = matchByName(t.details, statement.members);
        if (byName) {
          index = statement.members.indexOf(byName.member);
          via = byName.strength;
        }
      }

      if (index < 0) {
        report.unknown.push({ line: t.line, date: t.date, amount: t.paidIn, details: t.details, phone: phone });
        return;
      }

      if (!tally[index]) tally[index] = { total: 0, refs: [], lastDate: "" };
      tally[index].total += t.paidIn;
      if (t.receipt) tally[index].refs.push(t.receipt);
      if (!tally[index].lastDate || t.date > tally[index].lastDate) tally[index].lastDate = t.date;

      report.matched.push({
        line: t.line,
        member: statement.members[index].name,
        amount: t.paidIn,
        via: via,
        date: t.date,
        details: t.details,
      });
    });

    statement.members.forEach(function (m, index) {
      var entry = tally[index];
      if (!entry) return;
      m.paid = entry.total;
      m.date = entry.lastDate;
      m.ref = entry.refs.join(", ");
      if (entry.refs.length > 1) {
        report.multiPayment.push({ member: m.name, payments: entry.refs.length, total: entry.total });
      }
    });

    // Phone numbers were used for matching only. The statement is the artifact that
    // gets shared and printed, so it must not carry them out of here.
    statement.members = statement.members.map(function (m) {
      return {
        name: m.name,
        expected: m.expected,
        paid: m.paid,
        date: m.date,
        ref: m.ref,
        note: m.note,
      };
    });

    report.issues = describeIssues(report);
    return { statement: statement, report: report };
  }

  function describeIssues(report) {
    var issues = [];
    var add = function (level, message) {
      issues.push({ level: level, message: message });
    };

    report.duplicates.forEach(function (d) {
      add("error", "Receipt " + d.receipt + " appears more than once (" + money(d.amount) + " ignored).");
    });

    report.unknown.forEach(function (u) {
      add("error", money(u.amount) + " from \"" + u.details + "\" on " + shortDate(u.date) + " is not matched to a member.");
    });

    report.outflows.forEach(function (o) {
      add("error", money(o.amount) + " paid out on " + shortDate(o.date) + " (" + o.details + ") is not yet classified as an expense or a loan.");
    });

    if (report.outsidePeriod.length) {
      add("warn", report.outsidePeriod.length + " transaction" + (report.outsidePeriod.length === 1 ? "" : "s") + " outside this period ignored.");
    }

    if (report.unparsedDates.length) {
      var first = report.unparsedDates[0];
      add("error", report.unparsedDates.length + " transaction" + (report.unparsedDates.length === 1 ? "" : "s") +
        " has a date this tool cannot read (line " + first.line + ": \"" + first.rawDate + "\"). " +
        "Check the Date column on the Columns screen — those rows are not counted.");
    }

    if (report.incomplete.length) {
      add("warn", report.incomplete.length + " transaction" + (report.incomplete.length === 1 ? "" : "s") + " not marked COMPLETE ignored.");
    }

    report.multiPayment.forEach(function (m) {
      add("warn", m.member + " paid in " + m.payments + " receipts totalling " + money(m.total) + ".");
    });

    report.ignored.forEach(function (i) {
      add("warn", money(i.amount) + " from \"" + i.details + "\" on " + shortDate(i.date) + " was set aside by hand. It is not in the statement, so the month will only reconcile if the money is accounted for elsewhere.");
    });

    return issues;
  }

  return {
    parseCsv: parseCsv,
    parseTable: parseTable,
    guessMapping: guessMapping,
    toTransactions: toTransactions,
    parseAmount: parseAmount,
    parseDate: parseDate,
    normalizePhone: normalizePhone,
    extractPhone: extractPhone,
    matchByName: matchByName,
    buildStatement: buildStatement,
  };
});
