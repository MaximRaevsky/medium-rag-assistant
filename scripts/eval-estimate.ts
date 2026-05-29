import { getEncoding } from "js-tiktoken";
import { readArticles } from "../lib/dataset";
import { articleToChunks } from "../lib/chunking";
import { models } from "../lib/config";
import { buildSubsetIds, DISTRACTOR_COUNT, evalQuestions } from "./eval-set";

/**
 * Local (free) estimate of chunk counts and embedding cost for the Phase 7
 * evaluation subset under each candidate chunking configuration.
 * No paid calls: token counts come from cl100k_base locally.
 * text-embedding-3-small price: $0.02 per 1M input tokens.
 */
const PRICE_PER_1M = 0.02;
const enc = getEncoding("cl100k_base");

const configs = [
  { chunkSize: 384, overlapRatio: 0.1 },
  { chunkSize: 512, overlapRatio: 0.15 },
  { chunkSize: 768, overlapRatio: 0.15 },
];

async function main() {
  const subset = buildSubsetIds();
  const articles = [];
  for await (const a of readArticles()) {
    if (subset.has(a.articleId)) articles.push(a);
    if (articles.length === subset.size) break;
  }

  console.log(
    `Eval subset: ${articles.length} articles (` +
      `${DISTRACTOR_COUNT} leading distractors + ${subset.size - DISTRACTOR_COUNT} target ids), ` +
      `${evalQuestions.length} questions\n`,
  );

  console.log("config            chunks  embed_tokens   est_cost");
  let grandTokens = 0;
  for (const cfg of configs) {
    let chunks = 0;
    let tokens = 0;
    for (const a of articles) {
      const cs = articleToChunks(a, { ...cfg, topK: 5 });
      chunks += cs.length;
      for (const c of cs) tokens += enc.encode(c.embedInput).length;
    }
    grandTokens += tokens;
    const cost = (tokens / 1_000_000) * PRICE_PER_1M;
    const label = `${cfg.chunkSize}/${cfg.overlapRatio}`.padEnd(16);
    console.log(`${label}  ${String(chunks).padStart(6)}  ${String(tokens).padStart(12)}   $${cost.toFixed(5)}`);
  }

  const total = (grandTokens / 1_000_000) * PRICE_PER_1M;
  console.log(`\nAll 3 configs combined embed cost (one-time, separate namespaces): ~$${total.toFixed(5)}`);
  console.log(`Embedding model: ${models.embedding}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
