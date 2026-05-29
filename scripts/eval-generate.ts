import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { embedText, chat } from "../lib/llmod";
import { getPinecone, getIndexName } from "../lib/pinecone";
import { dedupeByArticle, isMultiResultQuestion } from "../lib/retrieval";
import type { RetrievedChunk } from "../lib/retrieval";
import { SYSTEM_PROMPT, buildUserPrompt } from "../lib/prompt";
import type { ChunkMetadata } from "../lib/types";
import { evalQuestions } from "./eval-set";

/**
 * Minimal generation checks (Stage 7B) on the chosen best config namespace.
 * Runs one gpt-5-mini call per required behavior (precise, multi, summary,
 * recommendation) and reports the answer + latency.
 *
 * Usage: NAMESPACE=eval_512_15 TOPK=7 tsx scripts/eval-generate.ts
 */
const NAMESPACE = process.env.NAMESPACE ?? "eval_512_15";
const TOPK = Number(process.env.TOPK ?? 7);
const BEHAVIORS = ["q1", "q3", "q4", "q5"]; // precise, multi, summary, recommendation

async function retrieveFrom(question: string): Promise<RetrievedChunk[]> {
  const vector = await embedText(question);
  const res = await getPinecone()
    .index<ChunkMetadata>(getIndexName())
    .namespace(NAMESPACE)
    .query({ vector, topK: TOPK, includeMetadata: true });
  return res.matches.map((m) => ({
    article_id: m.metadata?.article_id ?? "",
    title: m.metadata?.title ?? "",
    authors: m.metadata?.authors ?? [],
    tags: m.metadata?.tags ?? [],
    chunk: m.metadata?.chunk_text ?? "",
    score: m.score ?? 0,
  }));
}

async function main() {
  console.log(`Generation checks: namespace="${NAMESPACE}", top_k=${TOPK}\n`);
  for (const qid of BEHAVIORS) {
    const q = evalQuestions.find((x) => x.id === qid)!;
    let context = await retrieveFrom(q.question);
    if (isMultiResultQuestion(q.question)) context = dedupeByArticle(context);

    const user = buildUserPrompt(q.question, context);
    const t0 = Date.now();
    const answer = await chat(SYSTEM_PROMPT, user);
    const ms = Date.now() - t0;

    console.log(`================ ${q.id.toUpperCase()} [${q.category}] (latency ${(ms / 1000).toFixed(1)}s) ================`);
    console.log(`Q: ${q.question}`);
    console.log(`Context articles: ${[...new Set(context.map((c) => c.article_id))].join(", ")}`);
    console.log(`A: ${answer}\n`);
  }
}

main().catch((err) => {
  console.error("Eval generation failed:", err?.message ?? err);
  process.exit(1);
});
