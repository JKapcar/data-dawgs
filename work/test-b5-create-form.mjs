/* work/test-b5-create-form.mjs — league-create form defaults and autofill hardening.
 * Assertions read the SHIPPED bozo.html, never a copy of the markup.
 */
import { readFileSync } from "fs";
import assert from "assert";

const PAGE = readFileSync(new URL("../bozo.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");
let PASS = 0;
const t = (n, f) => { f(); PASS++; console.log("  ok  " + n); };

const tagFor = id => {
  const re = new RegExp("<input[^>]*id=\"" + id + "\"[^>]*>");
  const m = re.exec(PAGE);
  assert.ok(m, "no <input> with id " + id);
  return m[0];
};

console.log("B5 — the re-deploy cost defaults to free");

t("THE DEFECT: #nlBuyback no longer ships value=\"25\"", () => {
  const tag = tagFor("nlBuyback");
  assert.ok(!/value="25"/.test(tag),
    "a pre-filled 25 charges a mulligan nobody chose, and contradicts the settings-panel rule");
  assert.ok(/value="0"/.test(tag));
});

t("it is still a real, editable price field", () => {
  const tag = tagFor("nlBuyback");
  assert.ok(/type="number"/.test(tag) && /min="0"/.test(tag));
  assert.ok(/placeholder="0 = free"/.test(tag));
});

t("THE FIELD IS NOT REMOVED — graded history depends on it", () => {
  assert.ok(PAGE.includes('id="nlBuyback"'), "removing the write path only would be a half-removal");
  assert.ok(PAGE.includes('id="sBuyback"'), "the settings control must survive too");
  assert.ok(PAGE.includes("0 means the re-deploy is free"),
    "the settings panel's explanation of the rule must stay");
});

t("the create label reads as optional", () => {
  assert.ok(/Re-deploy cost \(\$\) — optional/.test(PAGE));
});

console.log("\nautofill hardening");

for (const id of ["nlId", "nlName"]) {
  t(id + " is closed to autofill", () => {
    const tag = tagFor(id);
    assert.ok(/autocomplete="off"/.test(tag), id + " must set autocomplete");
    assert.ok(/name="dd-league-/.test(tag),
      id + " needs an explicit non-credential name — a bare input is what Chrome guessed at");
  });
}

t("the password field keeps its existing protection", () => {
  assert.ok(/autocomplete="new-password"/.test(tagFor("nlPassword")),
    "already correct before this commit — do not weaken it to off");
});

console.log("\nnothing else moved");

t("the create handler still reads the same three ids", () => {
  for (const id of ["nlBuyback", "nlId", "nlName"])
    assert.ok(PAGE.includes("getElementById('" + id + "')"),
      id + " is queried by the hub handlers; renaming an id silently breaks create");
});

t("the cost field still only appears for royale", () => {
  assert.ok(PAGE.includes("e.target.value === 'royale' ? '' : 'none'"));
  assert.ok(/id="nlBuybackWrap" style="display:none"/.test(PAGE));
});

console.log("\n" + PASS + " assertions passed.");
