import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import type { PineconeRecord } from "@pinecone-database/pinecone";
import { models } from "../lib/config";
import type { RagConfig } from "../lib/config";
import { readArticles } from "../lib/dataset";
import { articleToChunks } from "../lib/chunking";
import { embedTexts } from "../lib/llmod";
import { chunkToMetadata, upsertRecords } from "../lib/pinecone";
import type { Chunk, ChunkMetadata } from "../lib/types";
import { buildSubsetIds } from "./eval-set";

/**
 * Ingest the fixed Phase 7 evaluation subset into one namespace under a given
 * chunking config. The subset (buildSubsetIds) is identical across all configs;
 * only chunkSize/overlapRatio differ per namespace.
 *
 * Usage: NAMESPACE=eval_512_15 CHUNK_SIZE=512 OVERLAP=0.15 tsx scripts/eval-ingest.ts
 */
const EMBED_BATCH = 100;
const UPSERT_BATCH = 100;

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} env var is required`);
  return v;
}

async function main() {
  const namespace = required("NAMESPACE");
  const chunkSize = Number(required("CHUNK_SIZE"));
  const overlapRatio = Number(required("OVERLAP"));
  const cfg: RagConfig = { chunkSize, overlapRatio, topK: 10 };

  const subset = buildSubsetIds();
  console.log(`Eval ingest: namespace="${namespace}", chunkSize=${chunkSize}, overlap=${overlapRatio}`);
  console.log(`Subset size: ${subset.size} articles, model=${models.embedding}\n`);

  const chunks: Chunk[] = [];
  let matched = 0;
  for await (const article of readArticles()) {
    if (!subset.has(article.articleId)) continue;
    matched++;
    chunks.push(...articleToChunks(article, cfg));
    if (matched === subset.size) break;
  }
  console.log(`Matched ${matched}/${subset.size} subset articles, chunks: ${chunks.length}`);

  const records: PineconeRecord<ChunkMetadata>[] = [];
  for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
    const batch = chunks.slice(i, i + EMBED_BATCH);
    const vectors = await embedTexts(batch.map((c) => c.embedInput));
    batch.forEach((c, j) => records.push({ id: c.id, values: vectors[j], metadata: chunkToMetadata(c) }));
    console.log(`Embedded ${Math.min(i + EMBED_BATCH, chunks.length)}/${chunks.length}`);
  }

  await upsertRecords(records, namespace, UPSERT_BATCH);
  console.log(`\nUpserted ${records.length} vectors into namespace "${namespace}".`);
}

main().catch((err) => {
  console.error("Eval ingest failed:", err?.message ?? err);
  process.exit(1);
});
