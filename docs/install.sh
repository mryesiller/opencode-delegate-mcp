#!/usr/bin/env bash
#
# opencode-delegate-mcp installer
#
# Installs the delegate MCP server and registers it with your chosen coding
# agents (Claude Code, Codex, OpenCode) so a primary agent can offload grunt
# work to a cheaper model via OpenCode.
#
# Usage:
#   bash install.sh --model "provider/model" [--targets claude,codex,opencode] \
#                   [--timeout 600] [--default-dir /path] [--opencode-bin /path]
#
# All flags are optional; missing required values are prompted interactively.
#
set -euo pipefail

# --- defaults ---------------------------------------------------------------
REPO_OWNER="mryesiller"
REPO_NAME="opencode-delegate-mcp"
SERVER_NAME="opencode-delegate"

REPO_URL_DEFAULT="https://github.com/${REPO_OWNER}/${REPO_NAME}.git"
INSTALL_DIR_DEFAULT="${XDG_DATA_HOME:-$HOME/.local/share}/${REPO_NAME}"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/opencode-delegate"
CONFIG_PATH="${CONFIG_DIR}/config.json"
OPENCODE_JSON="${XDG_CONFIG_HOME:-$HOME/.config}/opencode/opencode.json"

MODEL=""
TARGETS="claude,codex"
TIMEOUT_SEC="600"
DEFAULT_DIR=""
OPENCODE_BIN=""
AGENT=""
VARIANT=""
POLICY=""
REPO_URL="$REPO_URL_DEFAULT"
INSTALL_DIR="$INSTALL_DIR_DEFAULT"

# --- pretty logging ---------------------------------------------------------
if [ -t 1 ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GRN=$'\033[32m'; YLW=$'\033[33m'; BLU=$'\033[34m'; RST=$'\033[0m'
else
  BOLD=""; DIM=""; RED=""; GRN=""; YLW=""; BLU=""; RST=""
fi
info() { printf "%s==>%s %s\n" "$BLU$BOLD" "$RST" "$*"; }
ok()   { printf "%s✓%s %s\n" "$GRN" "$RST" "$*"; }
warn() { printf "%s!%s %s\n" "$YLW" "$RST" "$*" >&2; }
err()  { printf "%s✗%s %s\n" "$RED" "$RST" "$*" >&2; }
die()  { err "$*"; exit 1; }

usage() {
  cat <<EOF
${BOLD}opencode-delegate-mcp installer${RST}

  --model <provider/model>   Default model, e.g. minimax-coding-plan/MiniMax-M2.5-highspeed
  --targets <list>           Comma list of hosts to register: claude,codex,opencode (default: claude,codex)
  --timeout <seconds>        Per-delegation timeout in seconds (default: 600)
  --default-dir <path>       Default working directory for delegations (optional)
  --agent <name>             Default OpenCode agent (optional)
  --variant <name>           Default reasoning-effort variant, e.g. high (optional)
  --policy <list>            Append the delegation policy to instruction files: claude,codex (optional)
  --opencode-bin <path>      Path to the opencode binary (default: auto-detect)
  --repo <url>               Git repo URL to install from (default: $REPO_URL_DEFAULT)
  --install-dir <path>       Where to clone the server (default: $INSTALL_DIR_DEFAULT)
  -h, --help                 Show this help
EOF
}

# --- parse flags ------------------------------------------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    --model) MODEL="${2:-}"; shift 2;;
    --targets) TARGETS="${2:-}"; shift 2;;
    --timeout) TIMEOUT_SEC="${2:-}"; shift 2;;
    --default-dir) DEFAULT_DIR="${2:-}"; shift 2;;
    --agent) AGENT="${2:-}"; shift 2;;
    --variant) VARIANT="${2:-}"; shift 2;;
    --policy) POLICY="${2:-}"; shift 2;;
    --opencode-bin) OPENCODE_BIN="${2:-}"; shift 2;;
    --repo) REPO_URL="${2:-}"; shift 2;;
    --install-dir) INSTALL_DIR="${2:-}"; shift 2;;
    -h|--help) usage; exit 0;;
    *) die "Unknown option: $1 (try --help)";;
  esac
done

# --- prerequisites ----------------------------------------------------------
info "Checking prerequisites"
for cmd in node npm git; do
  command -v "$cmd" >/dev/null 2>&1 || die "'$cmd' is required but not found on PATH."
done
NODE_BIN="$(command -v node)"
ok "node: $NODE_BIN ($(node --version))"

# --- resolve opencode binary ------------------------------------------------
if [ -z "$OPENCODE_BIN" ]; then
  if command -v opencode >/dev/null 2>&1; then
    OPENCODE_BIN="$(command -v opencode)"
  else
    warn "opencode not found on PATH. Install it from https://opencode.ai (e.g. 'brew install sst/tap/opencode' or 'npm i -g opencode-ai')."
    warn "Continuing; the config will reference 'opencode' by name — fix it later with set_delegate_config or --opencode-bin."
    OPENCODE_BIN="opencode"
  fi
fi
[ "$OPENCODE_BIN" = "opencode" ] || ok "opencode: $OPENCODE_BIN"

# --- prompt for model if missing --------------------------------------------
if [ -z "$MODEL" ]; then
  printf "%sDefault provider/model%s (e.g. minimax-coding-plan/MiniMax-M2.5-highspeed): " "$BOLD" "$RST"
  read -r MODEL
fi
[ -n "$MODEL" ] || die "A default model is required."
case "$MODEL" in */*) ;; *) warn "Model '$MODEL' does not look like 'provider/model'.";; esac

# --- clone / update ---------------------------------------------------------
info "Installing server into $INSTALL_DIR"
if [ -d "$INSTALL_DIR/.git" ]; then
  git -C "$INSTALL_DIR" pull --ff-only >/dev/null 2>&1 || warn "Could not fast-forward existing checkout; using current version."
  ok "Updated existing checkout"
else
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone --depth 1 "$REPO_URL" "$INSTALL_DIR" >/dev/null 2>&1 || die "git clone failed for $REPO_URL"
  ok "Cloned $REPO_URL"
fi

# --- build ------------------------------------------------------------------
info "Building (npm install runs the TypeScript build)"
( cd "$INSTALL_DIR" && npm install --no-fund --no-audit >/dev/null 2>&1 ) || die "npm install/build failed. Run it manually in $INSTALL_DIR to see the error."
ENTRY="$INSTALL_DIR/dist/index.js"
[ -f "$ENTRY" ] || die "Build did not produce $ENTRY."
ok "Built $ENTRY"

# --- write delegate config --------------------------------------------------
info "Writing config to $CONFIG_PATH"
mkdir -p "$CONFIG_DIR"
TIMEOUT_MS=$(( TIMEOUT_SEC * 1000 ))
CFG="$CONFIG_PATH" OCBIN="$OPENCODE_BIN" MODEL="$MODEL" TMS="$TIMEOUT_MS" DDIR="$DEFAULT_DIR" AGENT="$AGENT" VARIANT="$VARIANT" \
node -e '
  const fs = require("fs");
  const p = process.env.CFG;
  let c = {};
  try { c = JSON.parse(fs.readFileSync(p, "utf8")); } catch {}
  c.opencodeBin = process.env.OCBIN;
  c.defaultModel = process.env.MODEL;
  c.timeoutMs = parseInt(process.env.TMS, 10);
  if (c.autoApprove === undefined) c.autoApprove = true;
  if (process.env.DDIR) c.defaultDirectory = process.env.DDIR;
  if (process.env.AGENT) c.defaultAgent = process.env.AGENT;
  if (process.env.VARIANT) c.defaultVariant = process.env.VARIANT;
  if (!c.profiles) c.profiles = {};
  fs.writeFileSync(p, JSON.stringify(c, null, 2) + "\n");
' || die "Failed to write config."
ok "Config written (default model: $MODEL)"

# --- register with hosts ----------------------------------------------------
register_claude() {
  command -v claude >/dev/null 2>&1 || { warn "claude CLI not found; skipping Claude Code registration."; return; }
  claude mcp remove "$SERVER_NAME" -s user >/dev/null 2>&1 || true
  if claude mcp add "$SERVER_NAME" -s user -- "$NODE_BIN" "$ENTRY" >/dev/null 2>&1; then
    ok "Registered with Claude Code (user scope)"
  else
    warn "claude mcp add failed; register manually: claude mcp add $SERVER_NAME -s user -- \"$NODE_BIN\" \"$ENTRY\""
  fi
}

register_codex() {
  command -v codex >/dev/null 2>&1 || { warn "codex CLI not found; skipping Codex registration."; return; }
  codex mcp remove "$SERVER_NAME" >/dev/null 2>&1 || true
  if codex mcp add "$SERVER_NAME" -- "$NODE_BIN" "$ENTRY" >/dev/null 2>&1; then
    ok "Registered with Codex"
  else
    warn "codex mcp add failed; register manually: codex mcp add $SERVER_NAME -- \"$NODE_BIN\" \"$ENTRY\""
  fi
}

register_opencode() {
  OCJSON="$OPENCODE_JSON" ENTRY="$ENTRY" NODE="$NODE_BIN" SNAME="$SERVER_NAME" \
  node -e '
    const fs = require("fs"), path = require("path");
    const p = process.env.OCJSON;
    let c = {};
    try { c = JSON.parse(fs.readFileSync(p, "utf8")); } catch {}
    if (!c["$schema"]) c["$schema"] = "https://opencode.ai/config.json";
    if (!c.mcp) c.mcp = {};
    c.mcp[process.env.SNAME] = { type: "local", command: [process.env.NODE, process.env.ENTRY], enabled: true };
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(c, null, 2) + "\n");
  ' && ok "Registered with OpenCode ($OPENCODE_JSON)" || warn "Failed to update $OPENCODE_JSON"
}

info "Registering MCP server with: $TARGETS"
IFS=',' read -ra TARR <<< "$TARGETS"
for t in "${TARR[@]}"; do
  case "$(echo "$t" | tr -d '[:space:]')" in
    claude|claude-code) register_claude;;
    codex) register_codex;;
    opencode) register_opencode;;
    "") ;;
    *) warn "Unknown target '$t' (valid: claude, codex, opencode)";;
  esac
done

# --- delegation policy (optional) -------------------------------------------
apply_policy_file() {
  local file="$1" name="$2"
  local tpl="$INSTALL_DIR/docs/delegation-policy.md"
  [ -f "$tpl" ] || { warn "Policy template not found at $tpl; skipping."; return; }
  mkdir -p "$(dirname "$file")"
  if [ -f "$file" ] && grep -q "opencode-delegate-mcp:policy:start" "$file" 2>/dev/null; then
    ok "$name already contains the delegation policy ($file)"
    return
  fi
  { printf "\n"; cat "$tpl"; } >> "$file"
  ok "Added delegation policy to $name ($file)"
}

if [ -n "$POLICY" ] && [ "$POLICY" != "none" ]; then
  echo
  info "Adding delegation policy to: $POLICY"
  IFS=',' read -ra PARR <<< "$POLICY"
  for pt in "${PARR[@]}"; do
    case "$(echo "$pt" | tr -d '[:space:]')" in
      claude|claude-code) apply_policy_file "$HOME/.claude/CLAUDE.md" "Claude Code (CLAUDE.md)";;
      codex) apply_policy_file "$HOME/.codex/AGENTS.md" "Codex (AGENTS.md)";;
      both) apply_policy_file "$HOME/.claude/CLAUDE.md" "Claude Code (CLAUDE.md)"; apply_policy_file "$HOME/.codex/AGENTS.md" "Codex (AGENTS.md)";;
      "") ;;
      *) warn "Unknown policy target '$pt' (valid: claude, codex)";;
    esac
  done
  printf "   %sEdit the policy any time to change what gets delegated.%s\n" "$DIM" "$RST"
fi

# --- provider auth reminder -------------------------------------------------
PROVIDER="${MODEL%%/*}"
echo
info "Provider auth"
warn "Make sure the '$PROVIDER' provider is authenticated in OpenCode."
printf "   %sCheck:%s %s auth list    %sAdd:%s %s auth login\n" "$DIM" "$RST" "$OPENCODE_BIN" "$DIM" "$RST" "$OPENCODE_BIN"

# --- done -------------------------------------------------------------------
echo
ok "${BOLD}Done.${RST}"
cat <<EOF

  Server:  $ENTRY
  Config:  $CONFIG_PATH
  Model:   $MODEL

  Try it from your primary agent:
    "Use delegate_task to create a file test.txt containing 'hi' in <your repo path>."

  When will it delegate on its own? See the policy you can edit:
    $INSTALL_DIR/docs/delegation-policy.md
    https://github.com/${REPO_OWNER}/${REPO_NAME}/blob/main/docs/DELEGATION.md

  Change the model/provider any time (no reinstall) — from the terminal:
    node "$ENTRY" config set --model openrouter/minimax/minimax-m2.5
    node "$ENTRY" config get
  …from your agent:
    set_delegate_config { "default_model": "openrouter/minimax/minimax-m2.5" }
  …or use the "Update settings" tab of the web configurator.

  Restart your agent (or reload MCP servers) so it picks up the new server.
EOF
