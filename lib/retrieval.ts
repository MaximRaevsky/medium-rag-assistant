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

/** Embed the question and retrieve top_k chunks from the active namespace. */
export async function retrieve(question: string): Promise<RetrievedChunk[]> {
  const vector = await embedText(question);
  const res = await getPinecone()
    .index<ChunkMetadata>(getIndexName())
    .namespace(getNamespace())
    .query({ vector, topK: ragConfig.topK, includeMetadata: true });

  return res.matches.map((m) => {
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
