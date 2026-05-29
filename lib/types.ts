/** A single article parsed from the dataset CSV. */
export interface Article {
  /** Stable id derived from the source CSV row index, as a string. */
  articleId: string;
  title: string;
  text: string;
  url: string;
  authors: string[];
  timestamp: string;
  tags: string[];
}

/** A chunk of one article, ready for embedding and storage. */
export interface Chunk {
  /** Pinecone vector id: `${articleId}#${chunkIndex}`. */
  id: string;
  articleId: string;
  chunkIndex: number;
  title: string;
  authors: string[];
  url: string;
  timestamp: string;
  tags: string[];
  /** Clean passage text, returned as `chunk` in the API response. */
  chunkText: string;
  /** Text actually embedded: metadata header + passage. */
  embedInput: string;
  /** Token count of the passage (chunkText). */
  tokenCount: number;
}

// ---- API contract types (field names/casing must match the PDF exactly) ----

export interface PromptRequest {
  question: string;
}

export interface ContextItem {
  article_id: string;
  title: string;
  chunk: string;
  score: number;
}

export interface AugmentedPrompt {
  System: string;
  User: string;
}

export interface PromptResponse {
  response: string;
  context: ContextItem[];
  Augmented_prompt: AugmentedPrompt;
}

export interface StatsResponse {
  chunk_size: number;
  overlap_ratio: number;
  top_k: number;
}
