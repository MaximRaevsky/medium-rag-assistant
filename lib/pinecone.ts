import { Pinecone } from "@pinecone-database/pinecone";
import type { PineconeRecord } from "@pinecone-database/pinecone";
import type { Chunk, ChunkMetadata } from "./types";

/** Build a Pinecone client from the environment. */
export function getPinecone(): Pinecone {
  const apiKey = process.env.PINECONE_API_KEY;
  if (!apiKey) throw new Error("PINECONE_API_KEY is not set");
  return new Pinecone({ apiKey });
}

export function getIndexName(): string {
  const name = process.env.PINECONE_INDEX;
  if (!name) throw new Error("PINECONE_INDEX is not set");
  return name;
}

/** Active namespace ("dev" for experiments, "final" for full ingestion). */
export function getNamespace(): string {
  return process.env.PINECONE_NAMESPACE || "dev";
}

/** Map a chunk to stored metadata, omitting empty arrays (Pinecone rejects them). */
export function chunkToMetadata(c: Chunk): ChunkMetadata {
  const meta: ChunkMetadata = {
    article_id: c.articleId,
    title: c.title,
    url: c.url,
    timestamp: c.timestamp,
    chunk_index: c.chunkIndex,
    chunk_text: c.chunkText,
    authors: c.authors,
    tags: c.tags,
  };
  if (c.authors.length === 0) delete (meta as Record<string, unknown>).authors;
  if (c.tags.length === 0) delete (meta as Record<string, unknown>).tags;
  return meta;
}

/** Upsert vectors into a namespace in batches. Deterministic ids make this idempotent. */
export async function upsertRecords(
  records: PineconeRecord<ChunkMetadata>[],
  namespace: string,
  batchSize = 100
): Promise<void> {
  const ns = getPinecone().index<ChunkMetadata>(getIndexName()).namespace(namespace);
  for (let i = 0; i < records.length; i += batchSize) {
    await ns.upsert({ records: records.slice(i, i + batchSize) });
  }
}
