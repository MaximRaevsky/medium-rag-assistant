import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { models } from "../lib/config";
import { embedText, chat } from "../lib/llmod";

async function main() {
  console.log("LLMod connectivity test: exactly 1 embedding + 1 chat request\n");

  const embedding = await embedText("connectivity test");
  console.log(`Embedding: model=${models.embedding}`);
  console.log(`  dimensions=${embedding.length} (required ${models.embeddingDimensions}: ${embedding.length === models.embeddingDimensions})`);
  console.log(`  first values=[${embedding.slice(0, 3).map((n) => n.toFixed(5)).join(", ")}, ...]`);

  const reply = await chat(
    "You are a connectivity test. Answer in one short word.",
    "Reply with the word: pong"
  );
  console.log(`\nChat: model=${models.chat}`);
  console.log(`  replyChars=${reply.trim().length}`);
  console.log(`  reply="${reply.trim().slice(0, 60)}"`);

  console.log("\nConnectivity OK.");
}

main().catch((err) => {
  console.error("Connectivity test failed:", err?.message ?? err);
  process.exit(1);
});
