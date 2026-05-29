export interface RagConfig {
  /** Target size of each text passage chunk, in tokens (cl100k_base). */
  chunkSize: number;
  /** Fraction of chunkSize that consecutive chunks overlap (0..0.3). */
  overlapRatio: number;
  /** Number of chunks retrieved from Pinecone per query (1..30). */
  topK: number;
}

/**
 * Single source of truth for RAG hyperparameters.
 * Used by ingestion, retrieval, /api/stats, and evaluation.
 * Provisional starting values; finalized after Phase 7 evaluation.
 */
export const ragConfig: RagConfig = {
  chunkSize: 512,
  overlapRatio: 0.15,
  topK: 5,
};

// Hard limits mandated by the assignment PDF.
const LIMITS = { maxChunkSize: 1024, maxOverlapRatio: 0.3, maxTopK: 30 };

function assertConfig(c: RagConfig): void {
  if (!Number.isInteger(c.chunkSize) || c.chunkSize < 1 || c.chunkSize > LIMITS.maxChunkSize) {
    throw new Error(`chunkSize must be an integer in 1..${LIMITS.maxChunkSize}, got ${c.chunkSize}`);
  }
  if (c.overlapRatio < 0 || c.overlapRatio > LIMITS.maxOverlapRatio) {
    throw new Error(`overlapRatio must be in 0..${LIMITS.maxOverlapRatio}, got ${c.overlapRatio}`);
  }
  if (!Number.isInteger(c.topK) || c.topK < 1 || c.topK > LIMITS.maxTopK) {
    throw new Error(`topK must be an integer in 1..${LIMITS.maxTopK}, got ${c.topK}`);
  }
}

assertConfig(ragConfig);

/** LLMod model identifiers required by the assignment. */
export const models = {
  embedding: "4UHRUIN-text-embedding-3-small",
  chat: "4UHRUIN-gpt-5-mini",
  embeddingDimensions: 1536,
} as const;

/** Local path to the dataset (gitignored). Overridable for tests/subsets. */
export const datasetPath = process.env.DATASET_PATH ?? "data/medium-english-50mb.csv";
