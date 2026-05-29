import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { ragConfig } from "../lib/config";
import { embedText } from "../lib/llmod";
import { getPinecone, getIndexName, getNamespace } from "../lib/pinecone";
import type { ChunkMetadata } from "../lib/types";

async function main() {
  const query = (process.argv.slice(2).join(" ") || process.env.Q || "").trim();
  if (!query) {
    console.error('Usage: tsx scripts/query-dev.ts "your question"');
    process.exit(1);
  }

  const namespace = getNamespace();
  const vector = await embedText(query);
  const res = await getPinecone()
    .index<ChunkMetadata>(getIndexName())
    .namespace(namespace)
    .query({ vector, topK: ragConfig.topK, includeMetadata: true });

  console.log(`Query: "${query}" (namespace=${namespace}, topK=${ragConfig.topK})`);
  res.matches.forEach((m, i) => {
    const md = m.metadata;
    const excerpt = (md?.chunk_text ?? "").replace(/\s+/g, " ").slice(0, 140);
    console.log(`${i + 1}. score=${m.score?.toFixed(4)} | article_id=${md?.article_id} | chunk_index=${md?.chunk_index} | "${md?.title}"`);
    console.log(`     ${excerpt}...`);
  });
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exit(1);
});
