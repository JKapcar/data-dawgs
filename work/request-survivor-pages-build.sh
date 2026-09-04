#!/usr/bin/env bash
# GITHUB_TOKEN pushes do not trigger branch-source Pages builds.
set -euo pipefail
gh api --method POST "repos/$GITHUB_REPOSITORY/pages/builds" --jq '"Pages build requested: " + .status'
