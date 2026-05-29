import { getEncoding } from "js-tiktoken";
import { ragConfig } from "../lib/config";
import { readArticles } from "../lib/dataset";
import { articleToChunks } from "../lib/chunking";

const EMBED_INPUT_LIMIT = 1024;
const enc = getEncoding("cl100k_base");

async function main() {
  console.log(`Config: chunkSize=${ragConfig.chunkSize}, overlapRatio=${ragConfig.overlapRatio}`);
  console.log(`Scanning full corpus (local only, no paid calls)...\n`);

  let totalArticles = 0;
  let totalChunks = 0;
  let maxPassageTokens = 0;
  let maxEmbedTokens = 0;
  let overLimit = 0;
  let maxEmbed = { articleId: "", title: "", chunkIndex: -1, tokens: 0 };

  for await (const article of readArticles()) {
    totalArticles++;
    const chunks = articleToChunks(article, ragConfig);
    totalChunks += chunks.length;

    for (const c of chunks) {
      if (c.tokenCount > maxPassageTokens) maxPassageTokens = c.tokenCount;

      const embedTokens = enc.encode(c.embedInput).length;
      if (embedTokens > EMBED_INPUT_LIMIT) overLimit++;
      if (embedTokens > maxEmbedTokens) {
        maxEmbedTokens = embedTokens;
        maxEmbed = { articleId: c.articleId, title: c.title, chunkIndex: c.chunkIndex, tokens: embedTokens };
      }
    }
  }

  console.log("Full-corpus chunk-size safety analysis:");
  console.log({
    totalArticles,
    totalChunks,
    maxPassageTokens,
    maxEmbedInputTokens: maxEmbedTokens,
    embedInputsOver1024: overLimit,
  });
  console.log(
    `Largest embedding input: article_id=${maxEmbed.articleId}, chunk_index=${maxEmbed.chunkIndex}, ` +
      `tokens=${maxEmbed.tokens}, title="${maxEmbed.title}"`
  );

  if (overLimit > 0) {
    console.log(`\nWARNING: ${overLimit} embedding inputs exceed ${EMBED_INPUT_LIMIT} tokens. A safe handling rule is required.`);
  } else {
    console.log(`\nOK: no embedding input exceeds ${EMBED_INPUT_LIMIT} tokens.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
