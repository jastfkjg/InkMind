#!/usr/bin/env bash
# The old script fetched main and deployed mutable tags without database recovery.
set -euo pipefail
echo 'Legacy deployment retired. Use the manual GitHub workflow and docs/DEPLOYMENT.md.' >&2
exit 1
