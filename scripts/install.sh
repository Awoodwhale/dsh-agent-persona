#!/usr/bin/env bash
# Install dsh-workspace-persona into a DSH profile.
#
#   bash scripts/install.sh                 # default profile: web
#   bash scripts/install.sh my-profile      # explicit profile
#   bash scripts/install.sh web .           # install this checkout (dev mode)
set -euo pipefail

PROFILE="${1:-web}"
TARGET="${2:-dsh-workspace-persona}"

if ! command -v dsh >/dev/null 2>&1; then
  echo "dsh not found on PATH — install DeepSeek Harness first." >&2
  exit 1
fi

echo "==> dsh plugin --profile ${PROFILE} add ${TARGET}"
dsh plugin --profile "${PROFILE}" add "${TARGET}"

cat <<'TIP'

Installed. `dsh.profile.bundles` is read at STARTUP, so restart the host now:

    dsh web            # or stop the running one and start it again

Then verify:
    cat "$DSH_HOME/workspace-persona.state.json"     # load heartbeat of the host half
    # Web → 设置 → 工作区人设
TIP
