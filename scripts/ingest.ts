import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import type { PineconeRecord } from "@pinecone-database/pinecone";
import { ragConfig, models } from "../lib/config";
import { readArticles } from "../lib/dataset";
import { articleToChunks } from "../lib/chunking";
import { embedTexts } from "../lib/llmod";
import { chunkToMetadata, upsertRecords, getNamespace } from "../lib/pinecone";
import type { Chunk, ChunkMetadata } from "../lib/types";

const SUBSET = process.env.SUBSET ? Number(process.env.SUBSET) : undefined;
const EMBED_BATCH = 100;
const UPSERT_BATCH = 100;

async function main() {
  const namespace = getNamespace();
  console.log(`Ingest: subset=${SUBSET ?? "ALL"}, namespace="${namespace}", model=${models.embedding}`);
  console.log(`Config: chunkSize=${ragConfig.chunkSize}, overlapRatio=${ragConfig.overlapRatio}\n`);

  // 1. Build chunks locally.
  const chunks: Chunk[] = [];
  let articleCount = 0;
  for await (const article of readArticles(SUBSET)) {
    articleCount++;
    chunks.push(...articleToChunks(article, ragConfig));
  }
  console.log(`Articles: ${articleCount}, chunks: ${chunks.length}`);

  // 2. Embed in batches.
  const records: PineconeRecord<ChunkMetadata>[] = [];
  for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
    const batch = chunks.slice(i, i + EMBED_BATCH);
    const vectors = await embedTexts(batch.map((c) => c.embedInput));
    batch.forEach((c, j) => records.push({ id: c.id, values: vectors[j], metadata: chunkToMetadata(c) }));
    console.log(`Embedded ${Math.min(i + EMBED_BATCH, chunks.length)}/${chunks.length}`);
  }

  // 3. Upsert in batches (deterministic ids => idempotent).
  await upsertRecords(records, namespace, UPSERT_BATCH);
  console.log(`\nUpserted ${records.length} vectors into namespace "${namespace}".`);
}

main().catch((err) => {
  console.error("Ingestion failed:", err?.message ?? err);
  process.exit(1);
});
