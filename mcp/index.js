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
      "Create a PiratePress video generation job (POST /videos). RECOMMENDED DEFAULT — you pick the params " +
      "explicitly, so cost and config are predictable (quick_video's server-side mapping can drift off-topic " +
      "and is throttled). Money is charged on creation. " +
      "Returns {id, cost, eta_seconds}; generation takes minutes — poll with get_video_status or wait_video.",
    inputSchema: {
      // Контент
      theme: z.string().min(3).describe("What the video is about — a full sentence, not one word."),
      theme_url: z
        .array(z.string().url())
        .optional()
        .describe("Article/post URLs the story is based on (content source — the service fetches and reads them). Conflicts with theme: use one or the other."),
      reference_url: z
        .string()
        .url()
        .optional()
        .describe("A YouTube/TikTok/Instagram video URL to base the video on — the service downloads it, transcribes the speech and clones the format. Use when the user gives a video link; add theme only if they want a different topic."),
      lang: z.enum(["ru", "en"]).optional().describe("Narration language (default en)."),
      duration: z
        .string()
        .optional()
        .describe('Seconds or range, e.g. "30" or "15-45" (default "15-45").'),
      style: z.string().optional().describe("Delivery style (default: Reddit storytelling)."),
      genre: z.string().max(200).optional().describe("Story genre (e.g. horror, comedy, confession)."),
      // Реклама
      placement: z
        .string()
        .optional()
        .describe("Product/brand to weave natively into the story (adveristor placement)."),
      hook: z.boolean().optional().describe("Add a hook in the first seconds (default true)."),
      end_card: z.boolean().optional().describe("Add an end card (default true)."),
      cta: z.boolean().optional().describe("Add a simple call-to-action at the end (requires placement). Incompatible with cta_target_type/cta_target/cta_word/cta_limit — those are the targeted CTA mode, used WITHOUT cta."),
      cta_target_type: z.enum(["bot", "site"]).optional().describe("Targeted CTA: where it sends viewers (default bot). Do not combine with cta:true."),
      cta_target: z.string().optional().describe("CTA destination: bot handle or site URL."),
      cta_word: z.string().optional().describe("Code word for CTA attribution (viewers send it to the bot)."),
      cta_limit: z.number().int().min(1).optional().describe("Max redemptions of the code word."),
      // Фон и визуал
      bg_ai: z
        .enum(["illustrations", "lite"])
        .optional()
        .describe("AI-generated background instead of stock gameplay: 'illustrations' = AI art per scene; 'lite' = the same scenes animated image-to-video (living video — pricier, counts as a heavy job under the subscription fair-use quota)."),
      bg_preset: z.string().max(100).optional().describe("Stock background preset id (gameplay/satisfying packs) — get valid ids from list_bg_presets; omit for a random preset."),
      bg_fit: z.enum(["fill", "fit"]).optional().describe("Background framing: crop-fill (default) or fit whole frame."),
      overlays: z.boolean().optional().describe("Add infographic overlays (default false)."),
      overlay_count: z.number().int().min(1).max(5).optional().describe("How many overlays (1-5, default 3; needs overlays: true)."),
      overlay_level: z.number().int().min(1).max(3).optional().describe("Overlay richness level 1-3 (default 1)."),
      visual_style: z.string().max(200).optional().describe("Visual style prompt for AI scenes (e.g. 'knitted amigurumi, stop-motion')."),
      // Субтитры
      caption_mode: z.enum(["word", "karaoke", "line"]).optional().describe("Captions: current word only | karaoke word highlight | whole line."),
      caption_position: z.enum(["top", "center", "bottom"]).optional().describe("Caption placement on the frame."),
      caption_scale: z.number().gt(0.01).max(0.2).optional().describe("Caption size as a fraction of frame height (0.01-0.2)."),
      // Музыка и голос
      music: z.enum(["none", "ai", "song"]).optional().describe("Soundtrack: none (default) | AI background music | song — the story sung as a track."),
      music_mood: z.string().max(200).optional().describe("Music mood prompt (default: auto from the story)."),
      voice_asset_id: z.string().optional().describe("Voice clone asset id from the user's library (list via list_assets; clones are uploaded in the bot)."),
      // Прочее
      director_mode: z.boolean().optional().describe("Pause after the script for review: the job stops at awaiting_review — continue with review_video."),
      count: z.number().int().min(1).max(50).optional().describe("Batch: N videos of the same config in one order (1-50, default 1)."),
      watermark: z.string().optional().describe("Custom watermark text (paid orders; trial videos always carry the service watermark)."),
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
      "it to parameters. Links in the prompt are routed automatically: page/article URLs become the content " +
      "source, video URLs (YouTube/TikTok) clone the format. " +
      "Use ONLY for vague one-liners where the user does not care about the exact config: the mapping can " +
      "drift off-topic, the cost is known only after creation, and the mapper is throttled to a few calls " +
      "per hour (429) — for anything specific or batched prefer generate_video. " +
      "Same response as generate_video.",
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
      "Poll a generation job (GET /videos/{id}). Statuses: queued | running | awaiting_review | done | error | refunded " +
      "(refunded = failed with the doubloons auto-refunded to the balance). " +
      "On done returns result_url (signed mp4 link, TTL 7 days — download it) and metadata (posting texts). " +
      "On awaiting_review returns story_text — the script under review; show it to the user before deciding.",
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
      "Block until the job reaches done/error/refunded/awaiting_review (polls every 20s, respects eta and Retry-After). " +
      "Returns the final job object with result_url. If it stops at awaiting_review (director mode), the object includes " +
      "story_text — the script under review; show it to the user, then continue with review_video. " +
      "Generation usually takes 2–15 minutes.",
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

        // refunded — терминальный (0.56.0): фейл с авто-возвратом дублонов
        if (job.status === "done" || job.status === "error" || job.status === "refunded" || job.status === "awaiting_review") {
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
  "review_video",
  {
    title: "Review script (director mode)",
    description:
      "Answer a script review for a job paused at awaiting_review (POST /videos/{id}/review): " +
      "approve — continue as is; edit — continue with your edited script (text required); " +
      "regen — rewrite the script (note = your wish). 409 means the job is not awaiting review. " +
      "The script itself is in story_text of get_video_status/wait_video — read it first, never approve blind.",
    inputSchema: {
      id: z.string().describe("Job id in awaiting_review status."),
      action: z.enum(["approve", "edit", "regen"]),
      text: z.string().optional().describe("Full edited script text (required for action=edit)."),
      note: z.string().optional().describe("Wish for the rewrite (only for action=regen)."),
    },
  },
  async ({ id, action, text, note }) => {
    try {
      const body = { action };
      if (text !== undefined) body.text = text;
      if (note !== undefined) body.note = note;
      return ok(await api(`/videos/${encodeURIComponent(id)}/review`, { method: "POST", body }));
    } catch (err) {
      return fail(err);
    }
  }
);

server.registerTool(
  "list_assets",
  {
    title: "List media library",
    description:
      "List the user's media library (GET /assets): voice clones, banners, etc. " +
      "Use an asset id as voice_asset_id in generate_video. New assets are uploaded in the bot — " +
      "the public API has no upload.",
    inputSchema: {},
  },
  async () => {
    try {
      return ok(await api("/assets"));
    } catch (err) {
      return fail(err);
    }
  }
);

server.registerTool(
  "list_bg_presets",
  {
    title: "List background presets",
    description:
      "List stock background presets (GET /bg-presets): [{name, videos}] — valid ids for bg_preset " +
      "in generate_video. Live catalog from the generator; omit bg_preset for a random preset.",
    inputSchema: {},
  },
  async () => {
    try {
      return ok(await api("/bg-presets"));
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
