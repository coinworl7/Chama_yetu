#!/usr/bin/env node
/*
 * Turn one M-Pesa statement (CSV or PDF) plus a group config into an importable statement.
 *
 *   node projects/chama-ledger/importer/cli.cjs fixtures/mpesa-clean.csv fixtures/group-clean.json statement.json
 *   node projects/chama-ledger/importer/cli.cjs statement.pdf group.json out.json --password 123456
 *   STATEMENT_PDF_PASSWORD=123456 node cli.cjs statement.pdf group.json
 *
 * Prints the report to stderr so stdout stays pure JSON.
 * Exit code 1 when the report contains an error - useful in a script.
 * Exit code 2 when an input cannot be read at all.
 */

const fs = require("node:fs");
const path = require("node:path");
const importer = require("./import.js");
const pdf = require("./pdf.js");

const args = process.argv.slice(2);

let password = process.env.STATEMENT_PDF_PASSWORD || "";
const flag = args.indexOf("--password");
if (flag !== -1) {
  password = args[flag + 1] || "";
  args.splice(flag, 2);
}

if (args.length < 2) {
  console.error("usage: node cli.cjs <statement.csv|statement.pdf> <group.json> [out.json] [--password <pdf-password>]");
  process.exit(2);
}

const statementPath = path.resolve(args[0]);
const groupPath = path.resolve(args[1]);
const outPath = args[2] ? path.resolve(args[2]) : null;

for (const file of [statementPath, groupPath]) {
  if (!fs.existsSync(file)) {
    console.error("missing file: " + file);
    process.exit(2);
  }
}

async function readStatement(file) {
  if (!/\.pdf$/i.test(file)) return fs.readFileSync(file, "utf8");

  const bytes = new Uint8Array(fs.readFileSync(file));
  try {
    return await pdf.extractTable(bytes, password);
  } catch (err) {
    if (err && err.code === "BAD_PASSWORD") {
      throw new Error("could not open the PDF. Pass the password with --password or STATEMENT_PDF_PASSWORD.");
    }
    throw err;
  }
}

(async function main() {
  const group = JSON.parse(fs.readFileSync(groupPath, "utf8"));
  const source = await readStatement(statementPath);

  const { statement, report } = importer.buildStatement(group, source);

  const lines = [];
  lines.push("source: " + (typeof source === "string" ? "csv" : "pdf (" + source.pageCount + " pages)"));
  lines.push("transactions: " + report.totalTransactions);
  lines.push("mapping: " + JSON.stringify(report.mapping));
  lines.push("inflows: " + report.inflows + " | matched: " + report.matched.length);
  for (const m of report.matched) {
    lines.push("  ok  line " + m.line + "  " + m.amount + "  -> " + m.member + " (" + m.via + ")");
  }
  if (report.issues.length) {
    lines.push("issues:");
    for (const issue of report.issues) {
      lines.push("  " + issue.level.toUpperCase() + "  " + issue.message);
    }
  } else {
    lines.push("issues: none");
  }
  console.error(lines.join("\n"));

  const json = JSON.stringify(statement, null, 2);
  if (outPath) {
    fs.writeFileSync(outPath, json + "\n", "utf8");
    console.error("written: " + outPath);
  } else {
    console.log(json);
  }

  if (report.issues.some((i) => i.level === "error")) process.exitCode = 1;
})().catch(function (err) {
  console.error((err && err.code ? err.code + ": " : "") + (err && err.message ? err.message : err));
  process.exit(2);
});
