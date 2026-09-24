#!/usr/bin/env bash
# Deploys the Fortify Daily Digest Copilot agent with the Power Platform CLI.
# Usage: deploy/deploy.sh https://contoso.crm.dynamics.com [tenant-id]
# See docs/admin-deployment-guide.md for the full runbook.
set -euo pipefail

ENV_URL="${1:?usage: deploy/deploy.sh <environment-url> [tenant-id]}"
TENANT_ID="${2:-}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BOT_SCHEMA="fc_DailyDigest"

command -v pac >/dev/null || { echo "Install the Power Platform CLI first: https://aka.ms/PowerPlatformCLI" >&2; exit 1; }

python3 "$ROOT/build/build_solution.py"
ZIP="$(ls -t "$ROOT"/out/FortifyDailyDigest_*.zip | head -1)"
echo "Solution: $ZIP"

echo "[1/3] Signing in to $ENV_URL (device code)..."
if [[ -n "$TENANT_ID" ]]; then
  pac auth create --name DailyDigestDeploy --environment "$ENV_URL" --tenant "$TENANT_ID" --deviceCode
else
  pac auth create --name DailyDigestDeploy --environment "$ENV_URL" --deviceCode
fi
pac auth select --name DailyDigestDeploy

echo "[2/3] Importing solution..."
pac solution import --path "$ZIP" --publish-changes --async --max-async-wait-time 30

echo "[3/3] Publishing the agent..."
pac copilot publish --bot "$BOT_SCHEMA"

cat <<EOF

Daily Digest is imported and published in $ENV_URL.
Finish the rollout in Copilot Studio and the Microsoft 365 admin center:
see docs/admin-deployment-guide.md, steps 4-6.
EOF
