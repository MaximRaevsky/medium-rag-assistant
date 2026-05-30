import { ragConfig } from "./config";
import { embedText } from "./llmod";
import { getPinecone, getIndexName, getNamespace } from "./pinecone";
import type { ChunkMetadata } from "./types";

/** A retrieved chunk with internal metadata (authors/tags used only for prompting). */
export interface RetrievedChunk {
  article_id: string;
  title: string;
  authors: string[];
  tags: string[];
  chunk: string;
  score: number;
}

/** Map raw Pinecone matches to RetrievedChunk[]. */
function toChunks(
  matches: { metadata?: ChunkMetadata; score?: number }[]
): RetrievedChunk[] {
  return matches.map((m) => {
    const md = m.metadata;
    return {
      article_id: md?.article_id ?? "",
      title: md?.title ?? "",
      authors: md?.authors ?? [],
      tags: md?.tags ?? [],
      chunk: md?.chunk_text ?? "",
      score: m.score ?? 0,
    };
  });
}

/**
 * Default retrieval (precise/summary/recommendation): embed the original question
 * and retrieve the configured top_k chunks from the active namespace. No dedupe.
 */
export async function retrieve(question: string): Promise<RetrievedChunk[]> {
  const vector = await embedText(question);
  const res = await getPinecone()
    .index<ChunkMetadata>(getIndexName())
    .namespace(getNamespace())
    .query({ vector, topK: ragConfig.topK, includeMetadata: true });
  return toChunks(res.matches);
}

/**
 * Internal candidate width for explicit multi-result/list queries. Capped at the
 * assignment's top_k limit (30). NOT part of the public /api/stats contract.
 */
export const CANDIDATE_K = 30;

/**
 * Multi-result/list retrieval: embed a topic-focused query, pull a wide candidate
 * pool (CANDIDATE_K), and dedupe by article_id (best chunk per article). The caller
 * slices to the answer limit; no padding is performed here.
 */
export async function retrieveMulti(question: string): Promise<RetrievedChunk[]> {
  const vector = await embedText(buildRetrievalQuery(question));
  const res = await getPinecone()
    .index<ChunkMetadata>(getIndexName())
    .namespace(getNamespace())
    .query({ vector, topK: CANDIDATE_K, includeMetadata: true });
  return dedupeByArticle(toChunks(res.matches));
}

/** Keep the highest-scoring chunk per article (matches arrive in score order). */
export function dedupeByArticle(chunks: RetrievedChunk[]): RetrievedChunk[] {
  const seen = new Set<string>();
  const out: RetrievedChunk[] = [];
  for (const c of chunks) {
    if (seen.has(c.article_id)) continue;
    seen.add(c.article_id);
    out.push(c);
  }
  return out;
}

/** Heuristic: does the question explicitly ask for multiple distinct articles/titles? */
export function isMultiResultQuestion(question: string): boolean {
  const q = question.toLowerCase();
  return (
    /\blist\b/.test(q) ||
    /\btitles\b/.test(q) ||
    /\b(\d+|two|three|several|multiple)\s+(distinct\s+)?articles?\b/.test(q)
  );
}

/**
 * Strip list/count/format boilerplate from a multi-result question to a bare topic
 * phrase. Example: "List exactly 3 articles about education. Return only the
 * titles." -> "education". Deterministic, no model call.
 */
export function extractMultiResultTopic(question: string): string {
  return question
    .toLowerCase()
    .replace(/return only.*$/s, " ")
    .replace(/\b(please|kindly)\b/g, " ")
    .replace(/\b(list|show|give|find|name|provide|suggest|recommend)\b/g, " ")
    .replace(/\bexactly\b/g, " ")
    .replace(/\ba few\b/g, " ")
    .replace(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|several|multiple|some)\b/g, " ")
    .replace(/\bdistinct\b/g, " ")
    .replace(/\barticles?\b/g, " ")
    .replace(/\btitles?\b/g, " ")
    .replace(/\bonly\b/g, " ")
    .replace(/\babout\b/g, " ")
    .replace(/[.,;:!?'"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Retrieval query for a question. Precise/summary/recommendation use the original
 * question. Explicit multi-result/list queries use "articles about <topic>"
 * (falling back to the original question if stripping leaves nothing). The final
 * answer prompt always uses the original user question.
 */
export function buildRetrievalQuery(question: string): string {
  if (!isMultiResultQuestion(question)) return question;
  const topic = extractMultiResultTopic(question);
  return topic ? `articles about ${topic}` : question;
}
