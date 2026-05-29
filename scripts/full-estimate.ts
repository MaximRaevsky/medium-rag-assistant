import { getEncoding } from "js-tiktoken";
import { readArticles } from "../lib/dataset";
import { articleToChunks } from "../lib/chunking";
import { ragConfig, models } from "../lib/config";

/**
 * Free local estimate of the full-corpus ingestion under the final config.
 * No paid calls. text-embedding-3-small price: $0.02 per 1M input tokens.
 */
const PRICE_PER_1M = 0.02;
const enc = getEncoding("cl100k_base");

async function main() {
  let articles = 0;
  let chunks = 0;
  let tokens = 0;
  let maxEmbedTokens = 0;
  for await (const a of readArticles()) {
    articles++;
    for (const c of articleToChunks(a, ragConfig)) {
      chunks++;
      const t = enc.encode(c.embedInput).length;
      tokens += t;
      if (t > maxEmbedTokens) maxEmbedTokens = t;
    }
  }
  const cost = (tokens / 1_000_000) * PRICE_PER_1M;
  console.log(`Config: chunkSize=${ragConfig.chunkSize}, overlapRatio=${ragConfig.overlapRatio}`);
  console.log(`Articles: ${articles}`);
  console.log(`Chunks (vectors): ${chunks}`);
  console.log(`Embedding input tokens: ${tokens}`);
  console.log(`Max single embedding-input tokens: ${maxEmbedTokens}`);
  console.log(`Estimated embedding cost: $${cost.toFixed(4)}`);
  console.log(`Embedding model: ${models.embedding}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
