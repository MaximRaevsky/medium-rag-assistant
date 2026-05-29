import { getEncoding } from "js-tiktoken";
import { ragConfig } from "../lib/config";
import { readArticles } from "../lib/dataset";
import { articleToChunks } from "../lib/chunking";
import type { Chunk } from "../lib/types";

const SUBSET = Number(process.env.SUBSET ?? 5);
const enc = getEncoding("cl100k_base");

function printExample(c: Chunk) {
  console.log(`\n=== Example chunk (id=${c.id}) ===`);
  console.log(`article_id: ${c.articleId}`);
  console.log(`title: ${c.title}`);
  console.log(`authors: ${JSON.stringify(c.authors)}`);
  console.log(`tags: ${JSON.stringify(c.tags)}`);
  console.log(`chunk_index: ${c.chunkIndex}`);
  console.log(`passage tokens (chunkText): ${c.tokenCount}`);
  console.log(`embedded text tokens (header + passage): ${enc.encode(c.embedInput).length}`);
  console.log(`-- embedInput (what we embed) --`);
  console.log(c.embedInput.slice(0, 420) + (c.embedInput.length > 420 ? " ..." : ""));
  console.log(`-- chunkText (returned as API "chunk") --`);
  console.log(c.chunkText.slice(0, 300) + (c.chunkText.length > 300 ? " ..." : ""));
}

/** Longest suffix of prev.chunkText that is also a prefix of next.chunkText. */
function sharedBoundaryChars(prev: Chunk, next: Chunk): number {
  const a = prev.chunkText;
  const b = next.chunkText;
  const max = Math.min(a.length, b.length);
  for (let len = max; len > 0; len--) {
    if (a.slice(a.length - len) === b.slice(0, len)) return len;
  }
  return 0;
}

async function main() {
  console.log(`Config: chunkSize=${ragConfig.chunkSize} tokens, overlapRatio=${ragConfig.overlapRatio}, topK=${ragConfig.topK}`);
  console.log(`Building chunks for first ${SUBSET} articles...\n`);

  let totalChunks = 0;
  let emptyChunks = 0;
  let oversize = 0;
  const allChunks: Chunk[] = [];

  for await (const article of readArticles(SUBSET)) {
    const chunks = articleToChunks(article, ragConfig);
    totalChunks += chunks.length;
    allChunks.push(...chunks);

    const counts = chunks.map((c) => c.tokenCount);
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    const avg = Math.round(counts.reduce((a, b) => a + b, 0) / counts.length);

    chunks.forEach((c) => {
      if (c.chunkText.trim() === "") emptyChunks++;
      if (c.tokenCount > ragConfig.chunkSize) oversize++;
    });

    let overlapNote = "n/a";
    if (chunks.length >= 2) {
      overlapNote = `${sharedBoundaryChars(chunks[0], chunks[1])} shared boundary chars between chunk 0 and 1`;
    }

    console.log(
      `article_id=${article.articleId} | "${article.title}" | authors=${JSON.stringify(article.authors)} | ` +
        `chunks=${chunks.length} | tokens(min/avg/max)=${min}/${avg}/${max} | overlap=${overlapNote}`
    );
  }

  console.log(`\nTotals: ${totalChunks} chunks, emptyChunks=${emptyChunks}, oversizeChunks=${oversize}`);

  // 2-3 representative chunks: first chunk, an overlapping second chunk, and a chunk from another article.
  const representatives = [
    allChunks.find((c) => c.id === "0#0"),
    allChunks.find((c) => c.id === "0#1"),
    allChunks.find((c) => c.id === "2#0"),
  ].filter((c): c is Chunk => Boolean(c));
  representatives.forEach(printExample);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
