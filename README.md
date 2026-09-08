# PiratePress for AI agents

Generate viral short-form videos straight from your AI agent (Claude Code, Kimi Code,
Claude Desktop, Cursor, …) via the [PiratePress](https://piratepress.fun) public API.

This repo ships two things:

- **`mcp/`** — an MCP server (`@piratepress/mcp`) exposing five tools:
  `generate_video`, `quick_video`, `get_video_status`, `wait_video`, `get_balance`.
- **`skill/piratepress-video/`** — an agent skill (`SKILL.md`) that teaches any
  coding agent the API flows: one-shot videos, explicit-param jobs
  (placement/hook/cta), batch generation, budget checks.

Docs: **https://docs.piratepress.fun** · OpenAPI: `https://api.piratepress.fun/docs`

## Get an API key

In Telegram: **[@piratepress_bot](https://t.me/piratepress_bot) → `/apikey`**.
The key looks like `pp_…` and is shown once. Balance top-ups also happen in the bot (1⛁ = 1₽).

## Install (one-liner)

```bash
curl -fsSL https://piratepress.fun/install.sh | PIRATEPRESS_API_KEY=pp_your_key_here bash
```

The installer puts the MCP server into `~/.piratepress/mcp/`, the skill into
`~/.agents/skills/piratepress-video/` (and `~/.claude/skills/` when present), and
registers the server with the `claude` CLI when available. Nothing outside `$HOME`
is touched; no sudo. `install.sh` is mirrored in this repo for inspection.

## Manual install

Requires Node.js 20+ (only for the MCP server; the skill is a plain markdown file).

```bash
git clone https://github.com/piratepress/agents.git
cd agents/mcp && npm install --omit=dev
```

Then point your agent at the server — configs for Claude Code, Claude Desktop and
Kimi Code are in [`mcp/README.md`](mcp/README.md). The skill can be copied into your
agent's skills directory (`~/.agents/skills/piratepress-video/SKILL.md`).

## What you can ask your agent

- "Make a 45-second English video about why houseplants die in winter."
- "Generate videos for these 5 topics and tell me the total cost first."
- "A vertical video about our launch with a natural placement of example.com in the middle."

Generation takes minutes (usually 2–15). The result is a signed mp4 URL (TTL 7 days)
plus posting metadata (title, description, hashtags).

## License

MIT — see [LICENSE](LICENSE).
