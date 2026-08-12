---
as_of: 2026-08-12
source: Data Dawgs public site and identity/connect handoff.
---

# Data Dawgs site guide

Data Dawgs is a public forecasting and fantasy-sports site. Most boards, models and
receipts can be read without an account. An account is for personal league membership,
account recovery, saved personal state and a personal AI connector.

## Start here

- **Draft:** the auction board, player pool, strategy and league rooms.
- **Games:** Bozo, Guillotine, Survivor, DFS and the live draft rig.
- **Lab:** dated models, calculators and experiments.
- **Receipts:** forecasts locked before the result and graded in public.
- **Your Dawgs:** after sign-in, a compact list of your real league memberships and
  personal connector status.

## Connect your own AI

Sign in at `/signon.html`, open **Connect Your Dawg**, confirm your email, and create a
personal MCP URL. Treat that URL like a password. The page shows it once; replacing it
immediately kills the previous URL. Copy the project instructions from
`/data/dawg-project-instructions.md`, then begin with `dd_site_map`. The live map—not a
tool name or remembered documentation—is the authority for what your credential may do.

## What the account does not change

Public draft boards remain public. Survivor ownership is modelled rather than personal,
and DFS slate inputs stay in the browser, so neither appears in Your Dawgs. Joining a
league still requires a manager's join link or code; creating an account alone does not
claim a seat.

All machine-readable data starts at `/data/index.json`. Every payload is dated; keep
observed results, market prices, model output, simulations and recommendations separate.
