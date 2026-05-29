import { getEncoding } from "js-tiktoken";
import type { RagConfig } from "./config";
import type { Article, Chunk } from "./types";

/**
 * chunk_size definition for this project:
 * - `chunk_size` is the maximum number of tokens in the clean article passage window.
 * - A compact metadata header (Title, Authors, Tags) is prepended to the passage
 *   ONLY in the embedding input, to improve retrieval for metadata-flavored queries.
 * - The API `chunk` field exposes only the clean passage (chunkText), never the header.
 *
 * We use cl100k_base as a practical token-aware approximation for chunking.
 */
const enc = getEncoding("cl100k_base");

export interface Passage {
  text: string;
  /** Number of tokens in the source window (<= chunkSize by construction). */
  tokenCount: number;
}

/**
 * Split text into overlapping token windows.
 * Window size = chunkSize tokens; overlap = floor(chunkSize * overlapRatio);
 * step = chunkSize - overlap. Returns trimmed passages, skipping empties.
 * tokenCount is the window length, so it is always <= chunkSize.
 */
export function splitIntoTokenChunks(text: string, chunkSize: number, overlapRatio: number): Passage[] {
  const tokens = enc.encode(text);
  if (tokens.length === 0) return [];

  const overlap = Math.floor(chunkSize * overlapRatio);
  const step = Math.max(1, chunkSize - overlap);

  const passages: Passage[] = [];
  for (let start = 0; start < tokens.length; start += step) {
    const window = tokens.slice(start, start + chunkSize);
    const passage = enc.decode(window).trim();
    if (passage) passages.push({ text: passage, tokenCount: window.length });
    if (start + chunkSize >= tokens.length) break;
  }
  return passages;
}

/** Build the text we embed: a compact metadata header followed by the passage. */
export function buildEmbedInput(article: Article, passage: string): string {
  const authors = article.authors.join(", ");
  const tags = article.tags.join(", ");
  return `Title: ${article.title}\nAuthors: ${authors}\nTags: ${tags}\n\nPassage:\n${passage}`;
}

/** Turn one article into its ordered list of chunks. */
export function articleToChunks(article: Article, config: RagConfig): Chunk[] {
  const passages = splitIntoTokenChunks(article.text, config.chunkSize, config.overlapRatio);
  return passages.map((passage, chunkIndex) => ({
    id: `${article.articleId}#${chunkIndex}`,
    articleId: article.articleId,
    chunkIndex,
    title: article.title,
    authors: article.authors,
    url: article.url,
    timestamp: article.timestamp,
    tags: article.tags,
    chunkText: passage.text,
    embedInput: buildEmbedInput(article, passage.text),
    tokenCount: passage.tokenCount,
  }));
}
