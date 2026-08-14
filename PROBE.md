# Forecast pipeline probe record

Build-time probes are deliberately limited to unauthenticated endpoints. OpenRouter
model availability and `response_format` support require an operator API key and must
be repeated at ratification; no consumer subscription is used by this pipeline.

- Gamma market list, CLOB midpoint, and drand quicknet are probed by `tests`/operator
  smoke runs before ratification.
- `pipeline/prompts/cold.txt` SHA-256 is recorded at ratification; it is empty and
  COLLECT omits the system message for this arm.
- Candidate OpenRouter lineages: Anthropic, OpenAI, Google, xAI, and DeepSeek. Slugs
  are intentionally unratified and therefore absent from runnable configuration.
