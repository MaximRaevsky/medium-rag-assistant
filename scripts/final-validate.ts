import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import OpenAI from "openai";
import { models } from "../lib/config";
import { retrieve, retrieveMulti, isMultiResultQuestion } from "../lib/retrieval";
import type { RetrievedChunk } from "../lib/retrieval";
import { SYSTEM_PROMPT, buildUserPrompt } from "../lib/prompt";
import { getNamespace } from "../lib/pinecone";
import { finalTests, usesFallback } from "./eval-final-set";
import type { FinalTest } from "./eval-final-set";

/**
 * Final-corpus end-to-end validation against the active namespace (expects `final`).
 *
 * Retrieval uses the EXACT production path: multi-result/list queries -> retrieveMulti
 * (topic-focused query + candidate_k=30 + dedupe, sliced to 3, no padding); all other
 * queries -> retrieve (top_k=5, original question, no dedupe).
 *
 * Generation runs through a LOCAL OpenAI client so an explicit candidate reasoning
 * mode can be tested WITHOUT modifying production lib/llmod.ts:
 *   CHAT_MODE=default  -> no reasoning params (production default behavior)
 *   CHAT_MODE=minimal  -> reasoning_effort: "minimal" for every question
 *   CHAT_MODE=hybrid   -> reasoning_effort: "minimal" ONLY for explicit multi-result
 *                         /list queries; default reasoning for everything else
 *
 * ONLY_CATEGORY=<precise|multi|summary|recommendation|fallback> restricts the run
 * to one category (used for the focused summary retest).
 *
 * PAID: question embeddings always; gpt-5-mini unless RETRIEVAL_ONLY=1.
 */
const RETRIEVAL_ONLY = process.env.RETRIEVAL_ONLY === "1";
const CHAT_MODE = (process.env.CHAT_MODE ?? "default").toLowerCase(); // default | minimal | hybrid
const ONLY_CATEGORY = (process.env.ONLY_CATEGORY ?? "").toLowerCase();

/** Reasoning params for a question under CHAT_MODE. hybrid = minimal for multi-result only. */
function paramsFor(question: string): Record<string, unknown> {
  if (CHAT_MODE === "minimal") return { reasoning_effort: "minimal" };
  if (CHAT_MODE === "hybrid") return isMultiResultQuestion(question) ? { reasoning_effort: "minimal" } : {};
  return {};
}

function client(): OpenAI {
  const apiKey = process.env.LLMOD_API_KEY!;
  const baseURL = process.env.LLMOD_BASE_URL!;
  return new OpenAI({ apiKey, baseURL, defaultHeaders: { "x-litellm-api-key": apiKey } });
}

interface ChatResult {
  text: string;
  ms: number;
  usage?: { prompt?: number; completion?: number; total?: number };
}

async function runChat(system: string, user: string, params: Record<string, unknown>): Promise<ChatResult> {
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

/** Production retrieval path + selected context (deduped multi list also returned for metrics). */
async function retrieveForTest(question: string): Promise<{ context: RetrievedChunk[]; distinct: RetrievedChunk[] }> {
  if (isMultiResultQuestion(question)) {
    const distinct = await retrieveMulti(question);
    return { context: distinct.slice(0, 3), distinct };
  }
  const r = await retrieve(question);
  return { context: r, distinct: r };
}

function ctxIds(chunks: RetrievedChunk[]): string[] {
  return chunks.map((c) => c.article_id);
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

interface Verdict {
  id: string;
  category: string;
  retrievalPass: boolean | null;
  generationPass: boolean | null;
  ms: number | null;
}

function scoreRetrieval(t: FinalTest, context: RetrievedChunk[], distinct: RetrievedChunk[]): { pass: boolean | null; note: string } {
  const ctx = new Set(ctxIds(context));
  switch (t.retrievalCheck) {
    case "single": {
      const target = t.targetIds[0];
      return { pass: ctx.has(target), note: `target ${target} ${ctx.has(target) ? "IN" : "NOT IN"} context` };
    }
    case "pool3": {
      const pool = new Set(t.targetIds);
      const hits = distinct.filter((c) => pool.has(c.article_id)).length;
      return { pass: hits >= 3, note: `distinct pool hits=${hits} (need >=3); context-3 ids=[${ctxIds(context).join(",")}]` };
    }
    case "cluster": {
      const hit = t.targetIds.some((id) => ctx.has(id));
      return { pass: hit, note: `cluster hit=${hit} (ids=[${t.targetIds.join(",")}])` };
    }
    case "absent":
      return { pass: null, note: `no acceptable target; context=[${ctxIds(context).join(",")}]` };
  }
}

function scoreGeneration(t: FinalTest, response: string): { pass: boolean | null; note: string } {
  const r = norm(response);
  if (t.category === "fallback") {
    return { pass: usesFallback(response), note: `fallback_line=${usesFallback(response)}` };
  }
  if (t.category === "precise") {
    const titleOk = t.expectedTitle ? r.includes(norm(t.expectedTitle)) : false;
    const authorOk = t.expectedAuthor ? r.includes(norm(t.expectedAuthor)) : false;
    return { pass: titleOk && authorOk, note: `title=${titleOk} author=${authorOk}` };
  }
  if (t.category === "multi") {
    const lines = response.split("\n").map((l) => l.trim()).filter(Boolean);
    const distinctLines = new Set(lines.map((l) => norm(l)));
    const authorLike = /\bby\b|—\s*\w+\s+\w+$/i.test(response);
    const exactly3 = lines.length === 3 && distinctLines.size === 3;
    return { pass: exactly3 && !authorLike, note: `lines=${lines.length} distinct=${distinctLines.size} authorlike=${authorLike}` };
  }
  // summary/recommendation: auto-check only non-fallback non-empty; grounding is manual.
  const nonEmpty = response.trim().length > 0;
  const notFallback = !usesFallback(response);
  return { pass: nonEmpty && notFallback ? null : false, note: `nonEmpty=${nonEmpty} notFallback=${notFallback} (manual grounding review)` };
}

async function main() {
  const ns = getNamespace();
  const tests = ONLY_CATEGORY ? finalTests.filter((t) => t.category === ONLY_CATEGORY) : finalTests;
  console.log(`final-validate | namespace=${ns} | chat_mode=${CHAT_MODE} | mode=${RETRIEVAL_ONLY ? "retrieval-only" : "retrieval+generation"} | tests=${tests.length}${ONLY_CATEGORY ? ` | only=${ONLY_CATEGORY}` : ""}`);
  if (ns !== "final") console.log(`WARNING: active namespace is "${ns}", not "final".`);
  console.log("");

  const verdicts: Verdict[] = [];
  let totalPrompt = 0;
  let totalCompletion = 0;
  const latencies: number[] = [];

  for (const t of tests) {
    const { context, distinct } = await retrieveForTest(t.question);

    console.log(`================ ${t.id.toUpperCase()} [${t.category}] ================`);
    console.log(`Q: ${t.question}`);
    console.log(`pass-criteria: ${t.pass}`);
    console.log(
      "context:\n" +
        context.map((c, i) => `  [#${i + 1}] id=${c.article_id} score=${c.score.toFixed(4)} title="${c.title}"`).join("\n"),
    );

    const ret = scoreRetrieval(t, context, distinct);
    console.log(`retrieval: ${ret.pass === null ? "n/a" : ret.pass ? "PASS" : "FAIL"} | ${ret.note}`);

    const v: Verdict = { id: t.id, category: t.category, retrievalPass: ret.pass, generationPass: null, ms: null };

    if (!RETRIEVAL_ONLY && t.needsGeneration) {
      const user = buildUserPrompt(t.question, context) + (t.instruction ?? "");
      const params = paramsFor(t.question);
      const effort = (params as { reasoning_effort?: string }).reasoning_effort ?? "default";
      const { text, ms, usage } = await runChat(SYSTEM_PROMPT, user, params);
      const gen = scoreGeneration(t, text);
      if (usage) {
        totalPrompt += usage.prompt ?? 0;
        totalCompletion += usage.completion ?? 0;
      }
      latencies.push(ms);
      v.generationPass = gen.pass;
      v.ms = ms;
      console.log(`response (${(ms / 1000).toFixed(1)}s, effort=${effort}${usage ? `, p=${usage.prompt} c=${usage.completion}` : ""}):\n${text}`);
      console.log(`generation: ${gen.pass === null ? "REVIEW" : gen.pass ? "PASS" : "FAIL"} | ${gen.note}`);
    }
    console.log("");
    verdicts.push(v);
  }

  // ---- Summary ----
  console.log("================ SUMMARY ================");
  const cats = ["precise", "multi", "summary", "recommendation", "fallback"] as const;
  for (const c of cats) {
    const rows = verdicts.filter((v) => v.category === c);
    const rp = rows.filter((v) => v.retrievalPass === true).length;
    const rTotal = rows.filter((v) => v.retrievalPass !== null).length;
    const gp = rows.filter((v) => v.generationPass === true).length;
    const gReview = rows.filter((v) => v.generationPass === null && !RETRIEVAL_ONLY).length;
    const gFail = rows.filter((v) => v.generationPass === false).length;
    console.log(
      `${c.padEnd(15)} retrieval ${rp}/${rTotal}` +
        (RETRIEVAL_ONLY ? "" : ` | generation pass=${gp} review=${gReview} fail=${gFail}`),
    );
  }

  if (!RETRIEVAL_ONLY && latencies.length) {
    const sorted = [...latencies].sort((a, b) => a - b);
    const p = (q: number) => (sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] / 1000).toFixed(1);
    console.log(`\nlatency (s): min=${(sorted[0] / 1000).toFixed(1)} p50=${p(0.5)} p90=${p(0.9)} max=${(sorted[sorted.length - 1] / 1000).toFixed(1)}`);
    console.log(`usage totals: prompt=${totalPrompt} completion=${totalCompletion} | chat calls=${latencies.length} | chat_mode=${CHAT_MODE}`);
  }
}

main().catch((err) => {
  console.error("final-validate failed:", err?.message ?? err);
  process.exit(1);
});
