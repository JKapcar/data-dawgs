# Competition Sourcebook

`bdb-2027.json` is the public source of truth rendered by `../sourcebook.html`.
It contains public requirements, provenance and unknown readiness; it is not a private project record store.

Copy `competition-template.json` for another competition. Keep stable requirement IDs within each competition; the pair `(competition.id, requirement.id)` is the identity. Replace every placeholder, supply current official URLs and verify the new competition's rules. Do not carry BDB dates, constraints or completion forward. Point the renderer's fetch at the new document. No API or private write is implied.

Fields:
- `schema_version`: version of this portable document contract.
- `kind`: `competition` or `template`.
- `competition`: stable ID, name, official/rules URLs, objective and IANA display timezones.
- `requirements`: stable ID, category, text, classification (`required`, `recommended`, `internal`, `to_verify`), provenance, readiness (`unknown`, `not_started`, `in_progress`, `complete`, `blocked`), completion evidence and optional strict numeric constraint.
- `source`: official URL, exact section, checked date and evidence level (`live_official_page`, `official_indexed_extract`, `unverified`). Unknown template fields are null, never invented citations.
- `timeline`: stable ID, classification (`official`, `recommended`, `internal`), UTC instant OR date-only interval, note and provenance. Do not assign a time to date-only announcements. Display instants in UTC and America/New_York, respecting DST.
- `lifecycle`: internal setup checklist, required future record, optional existing surface, status. Links do not imply workflow automation or completion.
- `open_questions`: conflicts and unresolved interpretations; retain uncertainty until supported.
- `change_history`: dated summaries of meaningful changes; update source checked dates separately.

Readiness requires actual evidence. `complete` requires a nonempty completion evidence reference; documenting a rule is never that evidence. Public notebook publication and data rights review are separate gates. Role/contribution and AI disclosure are competition-specific questions to verify, not universal rules. Keep private hypotheses, datasets, credentials, owner IDs and personal details out of these public documents. Record private evidence in existing private systems and publish only a safe status if authorized.

Validation: `node --test research-lab/sourcebook.test.mjs`; browser/layout check: `node research-lab/sourcebook-browser.test.mjs`.
