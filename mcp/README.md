# @piratepress/mcp

MCP server for the [PiratePress](https://piratepress.fun) public API — generate viral short-form
videos straight from your AI agent (Claude Code, Kimi Code, Claude Desktop, Cursor, …).

The server talks to `https://api.piratepress.fun/public/v1` and exposes five tools:

| Tool | What it does |
|---|---|
| `generate_video` | Create a job with explicit params (`theme`/`theme_url`/`reference_url`, `lang`, `duration`, `placement`, `hook`, `cta`). Returns `{id, cost, eta_seconds}`. |
| `quick_video` | One free-form `prompt` — a server-side LLM maps it to parameters. Best default for one-shot requests. |
| `get_video_status` | Poll a job: `queued → running → done/error/refunded` (also `awaiting_review` in director mode; `refunded` = failed, doubloons auto-refunded). On `done`: `result_url` (signed mp4, TTL 7 days) + `metadata` (posting texts). |
| `wait_video` | Block until `done`/`error`/`refunded` (polls every 20 s, MCP progress notifications, default timeout 30 min). |
| `get_balance` | Wallet: `{dublones, subscription, fair_use_left}`. 1⛁ = 1₽. |

Generation takes minutes (usually 2–15). Money (dublones) is charged when the job is **created**.

## Getting an API key

In Telegram: **@piratepress_bot → `/apikey`**. The key looks like `pp_…` and is shown once.
Balance top-ups also happen in the bot.

## Install & configure

Requires Node.js 20+ (only for the MCP server; the agent skill works without it).

### One-liner (recommended)

```bash
curl -fsSL https://piratepress.fun/install.sh | PIRATEPRESS_API_KEY=pp_your_key_here bash
```

The installer puts the MCP server into `~/.piratepress/mcp/`, the agent skill into
`~/.agents/skills/piratepress-video/` (and `~/.claude/skills/` when present), and registers
the server with the `claude` CLI when available. Nothing outside `$HOME` is touched.

### Claude Desktop

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "piratepress": {
      "command": "node",
      "args": ["/home/you/.piratepress/mcp/index.js"],
      "env": {
        "PIRATEPRESS_API_KEY": "pp_your_key_here"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add piratepress --scope user \
  -e PIRATEPRESS_API_KEY=pp_your_key_here \
  -- node ~/.piratepress/mcp/index.js
```

### Kimi Code

Add to your MCP config (`~/.kimi-code/mcp.json` or via the CLI):

```json
{
  "mcpServers": {
    "piratepress": {
      "command": "node",
      "args": ["/home/you/.piratepress/mcp/index.js"],
      "env": {
        "PIRATEPRESS_API_KEY": "pp_your_key_here"
      }
    }
  }
}
```

### From source (this repo)

```json
{
  "mcpServers": {
    "piratepress": {
      "command": "node",
      "args": ["/path/to/content-farm/mcp/index.js"],
      "env": { "PIRATEPRESS_API_KEY": "pp_your_key_here" }
    }
  }
}
```

### Environment variables

| Variable | Required | Default |
|---|---|---|
| `PIRATEPRESS_API_KEY` | yes | — |
| `PIRATEPRESS_API_URL` | no | `https://api.piratepress.fun` |

## Example dialogues

**One video:**

> **You:** Make a 45-second English video about why houseplants die in winter.
> **Agent:** `quick_video(prompt="45s EN video about why houseplants die in winter")` → `{id: "…", cost: 100, eta_seconds: 420}` → `wait_video(id)` → `result_url`. Downloads the mp4.

**Batch with budget check:**

> **You:** Generate videos for these 5 topics and tell me the total cost.
> **Agent:** `get_balance()` → confirms 5 × ~100⛁ fits → 5 × `generate_video(...)` → polls each with `wait_video` → 5 mp4s + posting metadata.

## Errors

- `402 insufficient_funds` — not enough dublones; top up in @piratepress_bot (1⛁ = 1₽).
- `429 rate_limited` — limits are 10 active jobs and 30 POST/min; the server surfaces `Retry-After`.
- `401` — key missing/revoked; issue a new one via `/apikey` in the bot.

Full API reference: **https://docs.piratepress.fun** · OpenAPI: `https://api.piratepress.fun/docs`

---

## Кратко по-русски

MCP-сервер для публичного API PiratePress: агент (Claude Code, Kimi Code, Claude Desktop)
генерирует вирусные ролики инструментами `generate_video`, `quick_video`, `get_video_status`,
`wait_video`, `get_balance`.

- Ключ — в боте **@piratepress_bot**, команда `/apikey`. Туда же — пополнение баланса (1⛁ = 1₽).
- Установка одной строкой: `curl -fsSL https://piratepress.fun/install.sh | PIRATEPRESS_API_KEY=pp_… bash`
  (MCP-сервер в `~/.piratepress/mcp/`, скилл в `~/.agents/skills/`, авто-регистрация в Claude Code).
  Ручной конфиг — JSON выше (`node ~/.piratepress/mcp/index.js` + env `PIRATEPRESS_API_KEY`).
- Генерация идёт минуты: создали задачу → ждём `wait_video` → качаем `result_url` (ссылка живёт 7 дней).
- Лимиты: 10 активных задач, 30 POST/мин; при `429` сервер возвращает `Retry-After`.
- Документация: https://docs.piratepress.fun
