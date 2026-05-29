import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import type { PineconeRecord } from "@pinecone-database/pinecone";
import { ragConfig, models } from "../lib/config";
import { readArticles } from "../lib/dataset";
import { articleToChunks } from "../lib/chunking";
import { embedTexts } from "../lib/llmod";
import { chunkToMetadata, getPinecone, getIndexName, getNamespace } from "../lib/pinecone";
import type { Chunk, ChunkMetadata } from "../lib/types";

/**
 * Corpus ingestion.
 *   - Full-corpus mode (no SUBSET): must target namespace "final" (guarded).
 *   - Dev/subset mode (SUBSET=N): ingests the first N articles into any namespace.
 *
 * Vector ids are deterministic (`${article_id}#${chunk_index}`), so rerunning the
 * same fixed config overwrites the same vectors instead of creating duplicates.
 * Progress logs report only counts/timings - never article text, vectors, or secrets.
 *
 * Full run: PINECONE_NAMESPACE=final EMBED_BATCH=200 tsx scripts/ingest.ts
 */
const SUBSET = process.env.SUBSET ? Number(process.env.SUBSET) : undefined;
const EMBED_BATCH = Number(process.env.EMBED_BATCH ?? 200);
const UPSERT_BATCH = 100;
const MAX_RETRIES = 3;

let cumulativeRetries = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** hh:mm:ss from milliseconds. */
function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/** Run fn with bounded retries. Logs only stage + batch number on retry (no payload/secrets). */
async function withRetry<T>(fn: () => Promise<T>, stage: string, batchNo: number): Promise<T> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === MAX_RETRIES) {
        const name = (err as Error)?.name ?? "Error";
        throw new Error(`[final ingestion] ${stage} batch ${batchNo} failed after ${MAX_RETRIES} attempts (${name})`);
      }
      cumulativeRetries++;
      console.log(`[final ingestion] retry | stage=${stage} | batch=${batchNo} | attempt ${attempt}/${MAX_RETRIES}`);
      await sleep(500 * attempt);
    }
  }
  throw new Error("unreachable");
}

async function main() {
  const namespace = getNamespace();
  const fullMode = SUBSET === undefined;

  // Namespace guard: full-corpus ingestion may only write to "final".
  if (fullMode && namespace !== "final") {
    throw new Error(
      `Full-corpus ingestion must target namespace "final" (got "${namespace}"). ` +
        `Set PINECONE_NAMESPACE=final, or pass SUBSET=N for dev/eval mode.`,
    );
  }

  // 1. Build chunks locally (single stream) so totals/ETA are accurate.
  const chunks: Chunk[] = [];
  let articleCount = 0;
  for await (const article of readArticles(SUBSET)) {
    articleCount++;
    chunks.push(...articleToChunks(article, ragConfig));
  }
  const totalChunks = chunks.length;
  const totalBatches = Math.ceil(totalChunks / EMBED_BATCH);
  const start = Date.now();

  console.log(
    `[final ingestion] start | namespace=${namespace} | mode=${fullMode ? "full" : `subset(${SUBSET})`} | ` +
      `config=${ragConfig.chunkSize}/${ragConfig.overlapRatio} | articles=${articleCount} | ` +
      `chunks=${totalChunks.toLocaleString()} | batches=${totalBatches} | embedBatch=${EMBED_BATCH} | model=${models.embedding}`,
  );

  const ns = getPinecone().index<ChunkMetadata>(getIndexName()).namespace(namespace);

  let done = 0;
  for (let b = 0; b < totalBatches; b++) {
    const batchNo = b + 1;
    const slice = chunks.slice(b * EMBED_BATCH, b * EMBED_BATCH + EMBED_BATCH);

    // Embed (retry around the embedding call only).
    const vectors = await withRetry(() => embedTexts(slice.map((c) => c.embedInput)), "embed", batchNo);
    const records: PineconeRecord<ChunkMetadata>[] = slice.map((c, j) => ({
      id: c.id,
      values: vectors[j],
      metadata: chunkToMetadata(c),
    }));

    // Upsert in sub-batches (retry around each upsert sub-batch only).
    for (let u = 0; u < records.length; u += UPSERT_BATCH) {
      const sub = records.slice(u, u + UPSERT_BATCH);
      await withRetry(() => ns.upsert({ records: sub }), "upsert", batchNo);
    }

    done += slice.length;
    const elapsed = Date.now() - start;
    const rate = done / (elapsed / 1000 || 1);
    const etaMs = rate > 0 ? ((totalChunks - done) / rate) * 1000 : 0;
    console.log(
      `[final ingestion] Batch ${batchNo}/${totalBatches} completed | ${done.toLocaleString()}/${totalChunks.toLocaleString()} chunks ` +
        `(${((done / totalChunks) * 100).toFixed(1)}%) | elapsed ${fmt(elapsed)} | avg ${rate.toFixed(2)} chunks/s | ` +
        `ETA ${fmt(etaMs)} | retries ${cumulativeRetries}`,
    );
  }

  // 2. Completion report + record-count validation.
  const elapsed = Date.now() - start;
  let recordCount = -1;
  try {
    const stats = await getPinecone().index<ChunkMetadata>(getIndexName()).describeIndexStats();
    recordCount = stats.namespaces?.[namespace]?.recordCount ?? 0;
  } catch {
    console.log(`[final ingestion] WARN: could not read index stats for record-count check`);
  }
  const match = recordCount === totalChunks;
  console.log(
    `[final ingestion] DONE | elapsed ${fmt(elapsed)} | chunks completed ${done.toLocaleString()}/${totalChunks.toLocaleString()} | retries ${cumulativeRetries}`,
  );
  console.log(
    `[final ingestion] namespace="${namespace}" recordCount=${recordCount} | expected=${totalChunks.toLocaleString()} | ` +
      `${match ? "MATCH" : "MISMATCH (note: index stats can lag a few seconds; re-check if just finished)"}`,
  );
}

main().catch((err) => {
  console.error("Ingestion failed:", err?.message ?? err);
  process.exit(1);
});
