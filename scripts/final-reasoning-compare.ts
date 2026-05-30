import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import OpenAI from "openai";
import { models } from "../lib/config";
import { retrieve, dedupeByArticle, isMultiResultQuestion } from "../lib/retrieval";
import type { RetrievedChunk } from "../lib/retrieval";
import { SYSTEM_PROMPT, buildUserPrompt } from "../lib/prompt";
import { getNamespace } from "../lib/pinecone";
import { finalTests, representativeIds, usesFallback } from "./eval-final-set";
import type { FinalTest } from "./eval-final-set";

/**
 * Small, gated reasoning-mode comparison on namespace `final`:
 *   production default chat  vs  reasoning_effort: "minimal".
 *
 * Uses a LOCAL OpenAI client so production lib/llmod.ts is NOT modified.
 * Retrieval is identical for both modes (same config: 512/0.10/top_k=5), so each
 * representative question is embedded once and reused.
 *
 * This is a PAID script. Run only after explicit approval. Decision rule: adopt
 * "minimal" in production only if it preserves correctness, grounding, and format;
 * latency is treated as noisy (high server-side variance) and is not decisive.
 */
type Mode = { name: string; params: Record<string, unknown> };
const MODES: Mode[] = [
  { name: "default", params: {} },
  { name: "minimal", params: { reasoning_effort: "minimal" } },
];

function client(): OpenAI {
  const apiKey = process.env.LLMOD_API_KEY!;
  const baseURL = process.env.LLMOD_BASE_URL!;
  return new OpenAI({ apiKey, baseURL, defaultHeaders: { "x-litellm-api-key": apiKey } });
}

function selectContext(question: string, retrieved: RetrievedChunk[]): RetrievedChunk[] {
  return isMultiResultQuestion(question) ? dedupeByArticle(retrieved).slice(0, 3) : retrieved;
}

interface CallResult {
  text: string;
  ms: number;
  usage?: { prompt?: number; completion?: number; total?: number };
}

async function callMode(system: string, user: string, params: Record<string, unknown>): Promise<CallResult> {
  const t0 = Date.now();
  const res = await client().chat.completions.create({
    model: models.chat,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    ...params,
  } as Parameters<OpenAI["chat"]["completions"]["create"]>[0]);
  const r = res as {
    choices: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  return {
    text: r.choices[0]?.message?.content ?? "",
    ms: Date.now() - t0,
    usage: r.usage
      ? { prompt: r.usage.prompt_tokens, completion: r.usage.completion_tokens, total: r.usage.total_tokens }
      : undefined,
  };
}

function quickChecks(t: FinalTest, text: string): string {
  const r = text.toLowerCase();
  if (t.category === "fallback") return `fallback_line=${usesFallback(text)}`;
  if (t.category === "precise") {
    const title = t.expectedTitle ? r.includes(t.expectedTitle.toLowerCase()) : false;
    const author = t.expectedAuthor ? r.includes(t.expectedAuthor.toLowerCase()) : false;
    return `title=${title} author=${author}`;
  }
  if (t.category === "multi") {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const distinct = new Set(lines.map((l) => l.toLowerCase()));
    const authorLike = /\bby\b|—\s*\w+\s+\w+$/i.test(text);
    return `lines=${lines.length} distinct=${distinct.size} authorlike=${authorLike}`;
  }
  return "manual grounding/quality review required";
}

async function main() {
  const ns = getNamespace();
  console.log(`final-reasoning-compare | namespace=${ns} | modes=${MODES.map((m) => m.name).join(" vs ")}`);
  if (ns !== "final") console.log(`WARNING: namespace is "${ns}", not "final".`);

  const repr = finalTests.filter((t) => (representativeIds as readonly string[]).includes(t.id));
  console.log(`representative questions: ${repr.map((t) => t.id).join(", ")}\n`);

  for (const t of repr) {
    const retrieved = await retrieve(t.question);
    const context = selectContext(t.question, retrieved);
    const user = buildUserPrompt(t.question, context) + (t.instruction ?? "");
    const ctxIds = context.map((c) => c.article_id).join(",");

    console.log(`================ ${t.id.toUpperCase()} [${t.category}] ================`);
    console.log(`Q: ${t.question}`);
    console.log(`context articles: [${ctxIds}]`);

    for (const m of MODES) {
      const { text, ms, usage } = await callMode(SYSTEM_PROMPT, user, m.params);
      const usageStr = usage ? `prompt=${usage.prompt} completion=${usage.completion} total=${usage.total}` : "usage n/a";
      console.log(`---- mode=${m.name} | latency ${(ms / 1000).toFixed(1)}s | ${usageStr} ----`);
      console.log(`checks: ${quickChecks(t, text)}`);
      console.log(`response:\n${text}\n`);
    }
  }

  console.log("Reminder: latency is noisy; gate on correctness + grounding + format parity.");
}

main().catch((err) => {
  console.error("final-reasoning-compare failed:", err?.message ?? err);
  process.exit(1);
});
