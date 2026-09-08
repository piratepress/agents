#!/usr/bin/env bash
# PiratePress agent installer — MCP server + agent skill for AI coding agents
# (Claude Code, Kimi Code, Claude Desktop, …).
#
# One-liner:
#   curl -fsSL https://piratepress.fun/install.sh | bash
# With API key (get one via /apikey in @PiratePressBot):
#   curl -fsSL https://piratepress.fun/install.sh | PIRATEPRESS_API_KEY=pp_... bash
#
# What it does:
#   1. MCP server  → ~/.piratepress/mcp/ (node deps installed there)
#   2. Agent skill → ~/.agents/skills/piratepress-video/ (Kimi Code & generic)
#                    ~/.claude/skills/piratepress-video/ (if ~/.claude exists)
#   3. Registers the MCP server with the `claude` CLI when available.
# Nothing outside $HOME is touched; no sudo.

set -euo pipefail

BASE_URL="${PIRATEPRESS_INSTALL_BASE:-https://piratepress.fun/piratepress}"
PP_DIR="$HOME/.piratepress"
MCP_DIR="$PP_DIR/mcp"

say()  { printf '%s\n' "$*"; }
ok()   { printf '  ✓ %s\n' "$*"; }
warn() { printf '  ! %s\n' "$*" >&2; }
die()  { printf 'error: %s\n' "$*" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || die "curl is required"

say "PiratePress installer"
say ""

# ---------- 1. MCP server ----------
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -e 'process.stdout.write(String(process.versions.node.split(".")[0]))' 2>/dev/null || echo 0)"
else
  NODE_MAJOR=0
fi

if [ "$NODE_MAJOR" -ge 20 ] 2>/dev/null; then
  mkdir -p "$MCP_DIR"
  curl -fsSL "$BASE_URL/mcp/index.js"     -o "$MCP_DIR/index.js"
  curl -fsSL "$BASE_URL/mcp/package.json" -o "$MCP_DIR/package.json"
  chmod +x "$MCP_DIR/index.js"
  if command -v npm >/dev/null 2>&1; then
    (cd "$MCP_DIR" && npm install --omit=dev --no-audit --no-fund --loglevel=error)
    ok "MCP server installed → $MCP_DIR"
  else
    warn "npm not found — run 'cd $MCP_DIR && npm install --omit=dev' manually"
  fi
else
  warn "node >= 20 not found — skipping MCP server (skill will still be installed;"
  warn "agents can use plain curl against the API). Install node and re-run."
fi

# ---------- 2. Agent skill ----------
install_skill() { # $1 — skills root
  mkdir -p "$1/piratepress-video"
  curl -fsSL "$BASE_URL/skill/SKILL.md" -o "$1/piratepress-video/SKILL.md"
  ok "skill installed → $1/piratepress-video"
}
install_skill "$HOME/.agents/skills"
[ -d "$HOME/.claude" ] && install_skill "$HOME/.claude/skills" || true

# ---------- 3. MCP registration ----------
MCP_REGISTERED=0
if [ "$NODE_MAJOR" -ge 20 ] 2>/dev/null && command -v claude >/dev/null 2>&1; then
  if [ -n "${PIRATEPRESS_API_KEY:-}" ]; then
    claude mcp add piratepress --scope user \
      --env "PIRATEPRESS_API_KEY=$PIRATEPRESS_API_KEY" \
      -- node "$MCP_DIR/index.js" >/dev/null 2>&1 \
      && { ok "MCP registered with Claude Code (user scope)"; MCP_REGISTERED=1; } \
      || warn "claude mcp add failed — register manually (see below)"
  else
    warn "PIRATEPRESS_API_KEY not set — skipping auto-registration"
  fi
fi

# ---------- done ----------
say ""
say "Done. Next steps:"
if [ -z "${PIRATEPRESS_API_KEY:-}" ]; then
  say "  1. Get an API key: /apikey in @PiratePressBot (Telegram)"
else
  say "  1. API key was taken from PIRATEPRESS_API_KEY env."
fi
if [ "$NODE_MAJOR" -ge 20 ] 2>/dev/null && [ "$MCP_REGISTERED" = "0" ]; then
  say "  2. Register the MCP server with your agent, e.g. Claude Code:"
  say "       claude mcp add piratepress --scope user \\"
  say "         --env PIRATEPRESS_API_KEY=pp_... \\"
  say "         -- node $MCP_DIR/index.js"
fi
say "  3. Docs: https://docs.piratepress.fun/api"
say ""
