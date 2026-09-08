#!/usr/bin/env node
/**
 * PiratePress MCP server — tools for the PiratePress public API.
 * Contract: https://docs.piratepress.fun (PRD-api §4, frozen /public/v1).
 *
 * Config via env:
 *   PIRATEPRESS_API_KEY  (required) — key from @piratepress_bot, /apikey
 *   PIRATEPRESS_API_URL  (optional) — default https://api.piratepress.fun
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const PKG = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "package.json"), "utf8")
);

const API_KEY = process.env.PIRATEPRESS_API_KEY;
const API_URL = (process.env.PIRATEPRESS_API_URL || "https://api.piratepress.fun").replace(/\/+$/, "");

if (!API_KEY) {
  console.error(
    "piratepress-mcp: PIRATEPRESS_API_KEY is not set. " +
      "Get a key in @piratepress_bot (Telegram) with the /apikey command."
  );
  process.exit(1);
}

const POLL_INTERVAL_MS = 20_000;

/** Extract Retry-After (seconds) from a 429 response. */
function retryAfterSeconds(res) {
  const h = res.headers.get("retry-after");
  const n = h ? Number.parseInt(h, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * One call against /public/v1. Throws Error with a user-readable message
 * (error envelope {error:{code,message}} is unpacked; 402 gets the
 * top-up hint; 429 keeps the Retry-After value in the message).
 */
async function api(path, { method = "GET", body, idempotencyKey } = {}) {
  const headers = { "X-API-Key": API_KEY };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  const res = await fetch(`${API_URL}/public/v1${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null;

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON body — fall through to status-based error */
  }

  if (res.ok) return data;

  const code = data?.error?.code;
  const message = data?.error?.message || `HTTP ${res.status}`;

  if (res.status === 402 || code === "insufficient_funds") {
    throw new Error(
      `Insufficient balance (${message}). Top up dublones in @piratepress_bot (Telegram) — 1⛁ = 1₽.`
    );
  }
  if (res.status === 429) {
    const ra = retryAfterSeconds(res);
    throw new Error(
      `Rate limited by the API.${ra ? ` Retry after ${ra}s (Retry-After).` : ""} ` +
        "Limits: 10 active jobs, 30 POST/min."
    );
  }
  if (res.status === 401) {
    throw new Error(
      "API key rejected (401). Check PIRATEPRESS_API_KEY or issue a new key in @piratepress_bot via /apikey."
    );
  }
  throw new Error(`PiratePress API error [${code || res.status}]: ${message}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ok(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function fail(err) {
  return { isError: true, content: [{ type: "text", text: err.message }] };
}

const server = new McpServer({
  name: "piratepress",
  version: PKG.version,
});

server.registerTool(
  "generate_video",
  {
    title: "Generate video",
    description:
      "Create a PiratePress video generation job (POST /videos). Money is charged on creation. " +
      "Returns {id, cost, eta_seconds}; generation takes minutes — poll with get_video_status or wait_video.",
    inputSchema: {
      theme: z.string().min(3).describe("What the video is about — a full sentence, not one word."),
      lang: z.enum(["ru", "en"]).optional().describe("Narration language (default en)."),
      duration: z
        .string()
        .optional()
        .describe('Seconds or range, e.g. "30" or "15-45" (default "15-45").'),
      placement: z
        .string()
        .optional()
        .describe("Product/brand to weave natively into the story (adveristor placement)."),
      hook: z.boolean().optional().describe("Add a hook in the first seconds (default true)."),
      cta: z.boolean().optional().describe("Add a call-to-action at the end (requires placement)."),
    },
  },
  async (args) => {
    try {
      const created = await api("/videos", {
        method: "POST",
        body: args,
        idempotencyKey: randomUUID(),
      });
      return ok({ id: created.id, status: created.status, cost: created.cost, eta_seconds: created.eta_seconds });
    } catch (err) {
      return fail(err);
    }
  }
);

server.registerTool(
  "quick_video",
  {
    title: "Quick video",
    description:
      "Create a video from a single free-form prompt (POST /videos:quick) — the server-side LLM maps " +
      "it to parameters. Best default for one-shot requests. Same response as generate_video.",
    inputSchema: {
      prompt: z
        .string()
        .min(3)
        .max(2000)
        .describe('Free-form brief, e.g. "60s EN vertical about our app launch, energetic, CTA to site".'),
      lang: z.enum(["ru", "en"]).optional().describe("Override the language detected from the prompt."),
    },
  },
  async ({ prompt, lang }) => {
    try {
      const body = { prompt };
      if (lang) body.lang = lang;
      const created = await api("/videos:quick", {
        method: "POST",
        body,
        idempotencyKey: randomUUID(),
      });
      return ok({ id: created.id, status: created.status, cost: created.cost, eta_seconds: created.eta_seconds });
    } catch (err) {
      return fail(err);
    }
  }
);

server.registerTool(
  "get_video_status",
  {
    title: "Get video status",
    description:
      "Poll a generation job (GET /videos/{id}). Statuses: queued | running | awaiting_review | done | error. " +
      "On done returns result_url (signed mp4 link, TTL 7 days — download it) and metadata (posting texts).",
    inputSchema: {
      id: z.string().describe("Job id returned by generate_video / quick_video."),
    },
  },
  async ({ id }) => {
    try {
      return ok(await api(`/videos/${encodeURIComponent(id)}`));
    } catch (err) {
      return fail(err);
    }
  }
);

server.registerTool(
  "wait_video",
  {
    title: "Wait for video",
    description:
      "Block until the job reaches done/error (polls every 20s, respects eta and Retry-After). " +
      "Returns the final job object with result_url. Generation usually takes 2–15 minutes.",
    inputSchema: {
      id: z.string().describe("Job id returned by generate_video / quick_video."),
      timeout_seconds: z
        .number()
        .int()
        .min(30)
        .max(7200)
        .optional()
        .describe("Give up after this many seconds (default 1800)."),
    },
  },
  async ({ id, timeout_seconds }, extra) => {
    const timeoutMs = (timeout_seconds ?? 1800) * 1000;
    const deadline = Date.now() + timeoutMs;
    const progressToken = extra?._meta?.progressToken;
    let waited = 0;

    const reportProgress = async (job) => {
      if (progressToken === undefined) return;
      try {
        await extra.sendNotification({
          method: "notifications/progress",
          params: {
            progressToken,
            progress: waited,
            total: timeout_seconds ?? 1800,
            message: `status=${job.status}${job.stage ? ` stage=${job.stage}` : ""}`,
          },
        });
      } catch {
        /* progress is best-effort */
      }
    };

    try {
      for (;;) {
        let job;
        try {
          job = await api(`/videos/${encodeURIComponent(id)}`);
        } catch (err) {
          // On 429 respect Retry-After and keep polling; other errors abort.
          if (err.message.startsWith("Rate limited")) {
            await sleep(POLL_INTERVAL_MS);
            waited += POLL_INTERVAL_MS / 1000;
            continue;
          }
          throw err;
        }

        await reportProgress(job);

        if (job.status === "done" || job.status === "error" || job.status === "awaiting_review") {
          return ok(job);
        }
        if (Date.now() + POLL_INTERVAL_MS > deadline) {
          return fail(
            new Error(
              `Timed out after ${timeout_seconds ?? 1800}s; job ${id} is still "${job.status}". ` +
                "Poll later with get_video_status — the job keeps running server-side."
            )
          );
        }
        await sleep(POLL_INTERVAL_MS);
        waited += POLL_INTERVAL_MS / 1000;
      }
    } catch (err) {
      return fail(err);
    }
  }
);

server.registerTool(
  "get_balance",
  {
    title: "Get balance",
    description:
      "Wallet state (GET /balance): {dublones, subscription, fair_use_left}. 1⛁ = 1₽; " +
      "top-ups happen in @piratepress_bot. Check this before batch generation.",
    inputSchema: {},
  },
  async () => {
    try {
      return ok(await api("/balance"));
    } catch (err) {
      return fail(err);
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("piratepress-mcp: ready (stdio)");
