import path from "node:path";
import { loadAndValidate } from "./validate-ddcc-questions.mjs";

const WORKER = process.env.DDCC_WORKER_URL || "https://toto.jkapcar4.workers.dev";
const file = process.argv[2] || "private/ddcc-question-library.json";
if (process.env.DDCC_IMPORT_CONFIRM !== "replace-ddcc-question-bank") {
  console.error("Refusing: set DDCC_IMPORT_CONFIRM=replace-ddcc-question-bank after explicit production-data authorization.");
  process.exit(2);
}
if (!process.env.DDCC_IMPORT_TOKEN) {
  console.error("Refusing: DDCC_IMPORT_TOKEN is not present in this process.");
  process.exit(2);
}

const { rows, report, full } = loadAndValidate(file);
if (report.errors.length) {
  report.errors.forEach(x => console.error("FAIL " + x));
  process.exit(1);
}
const payload = rows.filter(q => q.status !== "draft");
const response = await fetch(`${WORKER}/ddcc/admin/questions`, { method: "POST", headers: {
  "Content-Type": "application/json", "X-DDCC-Import": process.env.DDCC_IMPORT_TOKEN,
}, body: JSON.stringify({ questions: payload }) });
if (!response.ok) throw new Error(`Worker import failed: HTTP ${response.status} ${await response.text()}`);
const result = await response.json();
console.log(`Imported ${result.imported} non-draft DDCC questions from ${path.relative(process.cwd(), full)}.`);
