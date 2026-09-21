#!/usr/bin/env bash
# Install dsh-agent-persona into a DSH profile.
#
#   bash scripts/install.sh                    # published package, profile "web"
#   bash scripts/install.sh my-profile         # another profile
#   bash scripts/install.sh web .              # this checkout (development)
#   bash scripts/install.sh web dsh-agent-persona@0.1.1   # a pinned version
set -euo pipefail

PROFILE="${1:-web}"
TARGET="${2:-dsh-agent-persona}"
PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v dsh >/dev/null 2>&1; then
  echo "dsh not found on PATH — install DeepSeek Harness first." >&2
  exit 1
fi

if [ "${TARGET}" = "." ] || [ "${TARGET}" = "${PLUGIN_DIR}" ]; then
  TARGET="${PLUGIN_DIR}"
fi

# A path target is checked before it reaches the CLI: `dsh plugin add <path>` writes a link: dependency for
# whatever it is given, including a path that does not exist, so a typo becomes a broken profile entry.
case "${TARGET}" in
  /*|.*)
    if [ ! -d "${TARGET}" ]; then
      echo "no such directory: ${TARGET}" >&2
      exit 1
    fi
    if [ ! -f "${TARGET}/package.json" ]; then
      echo "${TARGET} is not a plugin package (no package.json)." >&2
      exit 1
    fi
    ;;
esac

# Installing a checkout means installing its built half, which npm builds on install.
# A checkout that has never run `npm install` has no lib/, and the host would fail to load it.
if [ ! -f "${PLUGIN_DIR}/lib/index.js" ] || [ ! -f "${PLUGIN_DIR}/lib/client.js" ]; then
  if [ "${TARGET}" = "${PLUGIN_DIR}" ]; then
    echo "lib/ is missing — run 'npm install' in ${PLUGIN_DIR} first (its prepare step builds both halves)." >&2
    exit 1
  fi
fi

echo "==> dsh plugin --profile ${PROFILE} add ${TARGET}"
dsh plugin --profile "${PROFILE}" add "${TARGET}"

VERSION="$(node -e "try{process.stdout.write(require('${PLUGIN_DIR}/package.json').version)}catch{process.stdout.write('?')}" 2>/dev/null || echo '?')"
STATE="${DSH_HOME:-$HOME/.dsh}/dsh-agent-persona/state.json"

cat <<TIP

Installed into profile "${PROFILE}" (this checkout is v${VERSION}).

dsh.profile.bundles is read at STARTUP, so restart the host now:

    dsh web            # or stop the running one and start it again

Then check it loaded:

    cat "${STATE}"
    # 设置 → Agent 人设        the management page
    # 对话页顶部「人设」        the per-session view
    # 设置 → 通用设置           carries nothing from this plugin

Personas live in one file, shared by every profile unless you override config.storePath:

    ${DSH_HOME:-$HOME/.dsh}/dsh-agent-persona/personas.json

Later, from the same profile:

    dsh plugin --profile ${PROFILE} update dsh-agent-persona    # upgrade
    dsh plugin --profile ${PROFILE} remove dsh-agent-persona    # uninstall (the persona file stays)
TIP
