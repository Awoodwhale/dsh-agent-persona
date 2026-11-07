#!/usr/bin/env bash
# Install dsh-agent-persona into a DSH profile.
#
#   bash scripts/install.sh                    # published package, profile "web"
#   bash scripts/install.sh my-profile         # another profile
#   bash scripts/install.sh web .              # this checkout (development)
#   bash scripts/install.sh web dsh-agent-persona@0.2.1   # a pinned version
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

    dsh web                                  # if you started the host by hand
    sudo systemctl restart <your-unit>       # if systemd runs it (use your unit name)

Then check it loaded:

    cat "${STATE}"
    # 设置 → Agent 人设        完整管理页（可在插件页的「界面与功能」里隐藏这个入口）
    # 对话页顶部「人设」        当前会话的人设 / 实际发送的提示词
    # 插件 → dsh-agent-persona 图标、README 和「界面与功能」开关；设置入口被隐藏后从这里回去
    # dsh-better-sidebar 右侧  「Agent 人设」卡片（装了那个插件才有）

The switches on the plugin page and in Settings write the same prefs, so either place works.

Personas live in one file, shared by every profile unless you override config.storePath:

    ${DSH_HOME:-$HOME/.dsh}/dsh-agent-persona/personas.json

Later, from the same profile:

    dsh plugin --profile ${PROFILE} update dsh-agent-persona    # upgrade
    dsh plugin --profile ${PROFILE} remove dsh-agent-persona    # uninstall (the persona file stays)
TIP
