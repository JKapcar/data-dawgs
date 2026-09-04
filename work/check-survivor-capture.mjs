import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

// Match the actual CLI refusals. Engine/JSON errors and missing games are failures.
export function classifyCapture(code, log) {
  if (code === 0 && /^wrote data\/survivor-receipts\.json .*week \d+ captured$/m.test(log)) return 'captured';
  if (code === 1 && /^REFUSED: a receipt already exists for \d{4} week \d+ \/ /m.test(log)) return 'already captured';
  if (code === 1 && /^REFUSED: week \d+ kicked off at /m.test(log)) return 'kickoff passed';
  // Season-not-started is handled by the proximity gate; the CLI has no such refusal.
  throw new Error(`Unexpected capture outcome (exit ${code}); see capture log`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(classifyCapture(Number(process.argv[2]), fs.readFileSync(process.argv[3], 'utf8')));
}
