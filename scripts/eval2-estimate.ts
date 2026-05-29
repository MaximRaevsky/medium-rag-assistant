import { getEncoding } from "js-tiktoken";
import { readArticles } from "../lib/dataset";
import { articleToChunks } from "../lib/chunking";
import { models } from "../lib/config";
import { buildSubset2, BACKGROUND_COUNT, HARD_DISTRACTORS, evalQuestions } from "./eval2-set";

/**
 * Free local estimate of chunks, embedding tokens, and cost for the Stage 7C
 * expanded subset under each of the 6 candidate configs. No paid calls.
 * text-embedding-3-small price: $0.02 per 1M input tokens.
 */
const PRICE_PER_1M = 0.02;
const enc = getEncoding("cl100k_base");

const configs = [
  { chunkSize: 384, overlapRatio: 0.1 },
  { chunkSize: 384, overlapRatio: 0.15 },
  { chunkSize: 512, overlapRatio: 0.1 },
  { chunkSize: 512, overlapRatio: 0.15 },
  { chunkSize: 512, overlapRatio: 0.2 },
  { chunkSize: 768, overlapRatio: 0.15 },
];

async function main() {
  const subset = buildSubset2();
  const targetIds = new Set<string>();
  for (const q of evalQuestions) for (const t of q.targetIds) targetIds.add(t);

  const articles = [];
  for await (const a of readArticles()) {
    if (subset.has(a.articleId)) articles.push(a);
    if (articles.length === subset.size) break;
  }

  console.log(
    `Expanded subset: ${articles.length} articles ` +
      `(background first ${BACKGROUND_COUNT} + ${targetIds.size} target/pool + ${HARD_DISTRACTORS.length} hard distractors, deduped)\n`,
  );
  console.log(`Questions: ${evalQuestions.length}\n`);

  console.log("config            chunks  embed_tokens   est_cost");
  let grand = 0;
  for (const cfg of configs) {
    let chunks = 0;
    let tokens = 0;
    for (const a of articles) {
      const cs = articleToChunks(a, { ...cfg, topK: 10 });
      chunks += cs.length;
      for (const c of cs) tokens += enc.encode(c.embedInput).length;
    }
    grand += tokens;
    const cost = (tokens / 1_000_000) * PRICE_PER_1M;
    const label = `${cfg.chunkSize}/${cfg.overlapRatio}`.padEnd(16);
    console.log(`${label}  ${String(chunks).padStart(6)}  ${String(tokens).padStart(12)}   $${cost.toFixed(5)}`);
  }
  const total = (grand / 1_000_000) * PRICE_PER_1M;
  console.log(`\nAll 6 configs combined embed cost (one-time): ~$${total.toFixed(5)}`);
  console.log(`Embedding model: ${models.embedding}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
