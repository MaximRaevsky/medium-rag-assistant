import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import OpenAI from "openai";
import { models } from "../lib/config";
import { embedText } from "../lib/llmod";
import { getPinecone, getIndexName } from "../lib/pinecone";
import { dedupeByArticle, isMultiResultQuestion } from "../lib/retrieval";
import type { RetrievedChunk } from "../lib/retrieval";
import { SYSTEM_PROMPT, buildUserPrompt } from "../lib/prompt";
import type { ChunkMetadata } from "../lib/types";

/**
 * Stage 7C gated generation + latency validation on the finalist namespace.
 * Compares top_k=5 vs top_k=7. Uses a local OpenAI client so it can pass
 * latency-control params (reasoning_effort / max_completion_tokens) WITHOUT
 * touching the production lib. A probe first verifies reasoning_effort support.
 */
const NS = "eval2_512_10";
const MAX_TOKENS = 2000;

function client(): OpenAI {
  const apiKey = process.env.LLMOD_API_KEY!;
  const baseURL = process.env.LLMOD_BASE_URL!;
  return new OpenAI({ apiKey, baseURL, defaultHeaders: { "x-litellm-api-key": apiKey } });
}

type ChatParams = { reasoning_effort?: "minimal" | "low" | "medium" | "high"; max_completion_tokens?: number };

async function chatTimed(system: string, user: string, params: ChatParams): Promise<{ text: string; ms: number }> {
  const t0 = Date.now();
  const res = await client().chat.completions.create({
    model: models.chat,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    ...params,
  } as Parameters<OpenAI["chat"]["completions"]["create"]>[0]);
  const text = (res as { choices: { message?: { content?: string } }[] }).choices[0]?.message?.content ?? "";
  return { text, ms: Date.now() - t0 };
}

async function retrieveFrom(question: string, topK: number): Promise<RetrievedChunk[]> {
  const vector = await embedText(question);
  const res = await getPinecone()
    .index<ChunkMetadata>(getIndexName())
    .namespace(NS)
    .query({ vector, topK, includeMetadata: true });
  return res.matches.map((m) => ({
    article_id: m.metadata?.article_id ?? "",
    title: m.metadata?.title ?? "",
    authors: m.metadata?.authors ?? [],
    tags: m.metadata?.tags ?? [],
    chunk: m.metadata?.chunk_text ?? "",
    score: m.score ?? 0,
  }));
}

/** Probe reasoning_effort support; return the lowest setting that returns non-empty text. */
async function probe(): Promise<ChatParams> {
  for (const effort of ["minimal", "low"] as const) {
    try {
      const { text, ms } = await chatTimed("You are a test.", "Reply with the single word READY.", {
        reasoning_effort: effort,
        max_completion_tokens: MAX_TOKENS,
      });
      if (text.trim()) {
        console.log(`PROBE: reasoning_effort="${effort}" supported, non-empty reply in ${(ms / 1000).toFixed(1)}s -> "${text.trim().slice(0, 40)}"`);
        return { reasoning_effort: effort, max_completion_tokens: MAX_TOKENS };
      }
      console.log(`PROBE: reasoning_effort="${effort}" returned EMPTY; trying next.`);
    } catch (e) {
      console.log(`PROBE: reasoning_effort="${effort}" rejected: ${(e as Error).message.slice(0, 120)}`);
    }
  }
  console.log("PROBE: falling back to no reasoning_effort, no token cap.");
  return {};
}

const CHECKS = [
  {
    id: "A_precise",
    question: "I'm a writer who hates social media. Which article suggests other ways to promote my writing? Give the title and author.",
    instruction: "\n\nInstruction: Answer with only the article title and author. Do not add explanation.",
    topKs: [5],
  },
  {
    id: "B_multi",
    question: "List exactly 3 articles about education. Return only the titles.",
    instruction: "",
    topKs: [5, 7],
  },
  {
    id: "C_summary",
    question: "Summarize the central idea of the article about improving mental health during the pandemic.",
    instruction: "\n\nInstruction: Summarize the central idea in at most 3 sentences.",
    topKs: [5, 7],
  },
  {
    id: "D_recommendation",
    question: "I want beginner-friendly, practical advice on building habits that actually stick. Recommend one article and justify your choice using evidence from it.",
    instruction: "\n\nInstruction: Recommend exactly one article in one short paragraph, justified with concrete evidence from the retrieved context.",
    topKs: [5, 7],
  },
];

async function main() {
  const params = await probe();
  console.log(`Using params: ${JSON.stringify(params)}\n`);

  for (const c of CHECKS) {
    for (const topK of c.topKs) {
      const retrieved = await retrieveFrom(c.question, topK);
      const context = isMultiResultQuestion(c.question) ? dedupeByArticle(retrieved).slice(0, 3) : retrieved;
      const user = buildUserPrompt(c.question, context) + c.instruction;
      const { text, ms } = await chatTimed(SYSTEM_PROMPT, user, params);

      const ctxIds = context.map((x) => x.article_id).join(",");
      console.log(`======== ${c.id} | top_k=${topK} | latency ${(ms / 1000).toFixed(1)}s ========`);
      console.log(`context articles: [${ctxIds}]`);
      console.log(`response:\n${text}`);

      if (c.id === "B_multi") {
        const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
        const distinct = new Set(lines.map((l) => l.toLowerCase()));
        const hasAuthor = /\bby\b|—\s*\w+\s+\w+$/i.test(text);
        console.log(`  FORMAT: lines=${lines.length} distinct=${distinct.size} authorlike=${hasAuthor}`);
      }
      console.log("");
    }
  }
}

main().catch((err) => {
  console.error("Eval2 generate failed:", err?.message ?? err);
  process.exit(1);
});
