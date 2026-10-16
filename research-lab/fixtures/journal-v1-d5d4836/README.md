# Journal fixture — research state v1, written by d5d4836

Synthetic only. Produced on 2026-10-16 by running the loopback runner (`server.mjs`) from
commit `d5d48369a412fd7263c751e42b6108ba498a798a` (PR 276): the three seed hypotheses and
tasks, one claim, one run over `syntheticTracking()`, one evidence row and one challenge.

At that commit `node research-lab/replay.mjs research-lab/fixtures/journal-v1-d5d4836 fc2a27c7-07b4-45fb-aedf-f8bd21fc726d`
reproduced the receipt (outcome `success`, code hash `7a32c779…`). `lab.test.mjs` pins what
must stay true under later code: the journal chain and receipt hash still verify, the input
still hashes to the receipt, the summary still recomputes byte-for-byte, replay refuses with
"Code changed" rather than claiming a reproduction, and the v1 state accepts new commands.
