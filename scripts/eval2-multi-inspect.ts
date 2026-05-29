import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { embedText } from "../lib/llmod";
import { getPinecone, getIndexName } from "../lib/pinecone";
import type { ChunkMetadata } from "../lib/types";
import { evalQuestions } from "./eval2-set";

/**
 * Inspect the distinct articles retrieved for each multi-result question in a
 * given namespace, up to top_k=15, so relevance can be manually re-scored
 * (used to correct the too-narrow m3 mental-health pool). No generation calls.
 */
const NS = process.env.NAMESPACE ?? "eval2_512_10";
const MAX_K = 15;

async function main() {
  const multis = evalQuestions.filter((q) => q.category === "multi");
  for (const q of multis) {
    const vector = await embedText(q.question);
    const res = await getPinecone()
      .index<ChunkMetadata>(getIndexName())
      .namespace(NS)
      .query({ vector, topK: MAX_K, includeMetadata: true });

    const seen = new Set<string>();
    const distinct: { id: string; title: string; score: number; rank: number }[] = [];
    res.matches.forEach((m, i) => {
      const id = m.metadata?.article_id ?? "";
      if (seen.has(id)) return;
      seen.add(id);
      distinct.push({ id, title: m.metadata?.title ?? "", score: m.score ?? 0, rank: i + 1 });
    });

    console.log(`\n==== ${q.id.toUpperCase()} (${NS}): ${q.question}`);
    console.log(`pool=${JSON.stringify(q.targetIds)}`);
    distinct.forEach((d) => console.log(`  chunkRank#${d.rank} id=${d.id} score=${d.score.toFixed(4)} "${d.title}"`));
  }
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exit(1);
});
