import { getEncoding } from "js-tiktoken";
import { ragConfig, models } from "../lib/config";
import { SYSTEM_PROMPT } from "../lib/prompt";
import { isMultiResultQuestion } from "../lib/retrieval";
import { finalTests, representativeIds } from "./eval-final-set";
import type { FinalTest } from "./eval-final-set";

/**
 * FREE local cost/usage estimate for the planned paid validation (no API calls).
 *
 * Planned paid phases (see final-reasoning-compare.ts and final-validate.ts):
 *   1. Reasoning-mode comparison: `representativeIds` questions x 2 modes.
 *      embeddings = #repr (retrieve once per question, reused across modes);
 *      chat calls = #repr x 2.
 *   2. Final generation validation (ONE selected mode): every test embedded once;
 *      gpt-5-mini called for each needsGeneration test.
 *
 * Token notes:
 *   - cl100k_base is used (matches the repo's chunker). gpt-5-mini actually uses
 *     o200k_base, so chat counts are approximate (typically within ~10-15%).
 *   - Context tokens are NOMINAL: top_k chunks (3 after dedupe for multi-result),
 *     each ~chunkSize passage tokens + a small metadata header. Real passages are
 *     often a bit shorter, so this biases the estimate slightly high (conservative).
 */
const enc = getEncoding("cl100k_base");

// Pricing. Embedding price is the repo constant. gpt-5-mini per-token price on
// LLMod is NOT officially confirmed here, so these are clearly-labeled ASSUMPTIONS,
// overridable via env, and will be reconciled against the real dashboard delta
// after the small comparison run.
const EMBED_PER_1M = 0.02;
const CHAT_INPUT_PER_1M = Number(process.env.GPT5_MINI_INPUT_PER_1M ?? "0.25");
const CHAT_OUTPUT_PER_1M = Number(process.env.GPT5_MINI_OUTPUT_PER_1M ?? "2.0");

// Nominal context sizing.
const PASSAGE_TOKENS = ragConfig.chunkSize; // upper-bound passage size
const HEADER_TOKENS = 30; // "[#i] article_id=.. Title: .. Author(s): .. Passage:"
const WRAPPER_TOKENS = 20; // "Context (Medium articles):" + "Question:" scaffolding

// Output-token scenarios for the reasoning model (visible + reasoning tokens).
const OUTPUT_TYPICAL = 700;
const OUTPUT_CONSERVATIVE = 2000; // matches eval2 max_completion_tokens cap

const tok = (s: string) => enc.encode(s).length;
const SYSTEM_TOKENS = tok(SYSTEM_PROMPT);

function contextChunks(t: FinalTest): number {
  return isMultiResultQuestion(t.question) ? 3 : ragConfig.topK;
}

/** Approx gpt-5-mini input tokens for one test's chat call. */
function chatInputTokens(t: FinalTest): number {
  const ctx = contextChunks(t) * (PASSAGE_TOKENS + HEADER_TOKENS);
  return SYSTEM_TOKENS + WRAPPER_TOKENS + ctx + tok(t.question) + tok(t.instruction ?? "");
}

function dollars(n: number): string {
  return `$${n.toFixed(5)}`;
}

function main() {
  const repr = finalTests.filter((t) => (representativeIds as readonly string[]).includes(t.id));
  const genTests = finalTests.filter((t) => t.needsGeneration);

  // ---- Phase 1: reasoning-mode comparison ----
  const cmpEmbedCalls = repr.length;
  const cmpEmbedTokens = repr.reduce((s, t) => s + tok(t.question), 0);
  const cmpChatCalls = repr.length * 2; // two modes
  const cmpInputTokens = repr.reduce((s, t) => s + chatInputTokens(t), 0) * 2;

  // ---- Phase 2: final generation validation (one mode) ----
  const valEmbedCalls = finalTests.length; // every test embeds its question
  const valEmbedTokens = finalTests.reduce((s, t) => s + tok(t.question), 0);
  const valChatCalls = genTests.length;
  const valInputTokens = genTests.reduce((s, t) => s + chatInputTokens(t), 0);

  const totalEmbedCalls = cmpEmbedCalls + valEmbedCalls;
  const totalEmbedTokens = cmpEmbedTokens + valEmbedTokens;
  const totalChatCalls = cmpChatCalls + valChatCalls;
  const totalInputTokens = cmpInputTokens + valInputTokens;

  const embedCost = (totalEmbedTokens / 1_000_000) * EMBED_PER_1M;
  const inputCost = (totalInputTokens / 1_000_000) * CHAT_INPUT_PER_1M;
  const outTypical = totalChatCalls * OUTPUT_TYPICAL;
  const outConservative = totalChatCalls * OUTPUT_CONSERVATIVE;
  const outCostTypical = (outTypical / 1_000_000) * CHAT_OUTPUT_PER_1M;
  const outCostConservative = (outConservative / 1_000_000) * CHAT_OUTPUT_PER_1M;

  const totalTypical = embedCost + inputCost + outCostTypical;
  const totalConservative = embedCost + inputCost + outCostConservative;

  console.log("================ FINAL VALIDATION COST ESTIMATE (free, no API calls) ================");
  console.log(`Config: chunk_size=${ragConfig.chunkSize}, overlap_ratio=${ragConfig.overlapRatio}, top_k=${ragConfig.topK}`);
  console.log(`Models: embed=${models.embedding}, chat=${models.chat}`);
  console.log(`System-prompt tokens: ${SYSTEM_TOKENS}\n`);

  console.log("Test inventory:");
  for (const c of ["precise", "multi", "summary", "recommendation", "fallback"] as const) {
    const n = finalTests.filter((t) => t.category === c).length;
    console.log(`  ${c.padEnd(15)} ${n}`);
  }
  console.log(`  ${"TOTAL".padEnd(15)} ${finalTests.length} (generation: ${genTests.length}, retrieval-embedded: ${finalTests.length})\n`);

  console.log("Phase 1 - reasoning-mode comparison (representative):");
  console.log(`  questions: ${repr.map((t) => t.id).join(", ")}`);
  console.log(`  embedding calls: ${cmpEmbedCalls} (${cmpEmbedTokens} tok)`);
  console.log(`  gpt-5-mini calls: ${cmpChatCalls} (input ~${cmpInputTokens} tok)\n`);

  console.log("Phase 2 - final generation validation (one selected mode):");
  console.log(`  embedding calls: ${valEmbedCalls} (${valEmbedTokens} tok)`);
  console.log(`  gpt-5-mini calls: ${valChatCalls} (input ~${valInputTokens} tok)\n`);

  console.log("Totals (Phase 1 + Phase 2):");
  console.log(`  embedding calls: ${totalEmbedCalls} (~${totalEmbedTokens} tok)`);
  console.log(`  gpt-5-mini calls: ${totalChatCalls} (input ~${totalInputTokens} tok)\n`);

  console.log(`Assumed prices: embed=$${EMBED_PER_1M}/1M, chat_in=$${CHAT_INPUT_PER_1M}/1M, chat_out=$${CHAT_OUTPUT_PER_1M}/1M (chat prices ASSUMED)`);
  console.log(`  embedding cost:        ${dollars(embedCost)}`);
  console.log(`  chat input cost:       ${dollars(inputCost)}`);
  console.log(`  chat output (typical ${OUTPUT_TYPICAL} tok/call):      ${dollars(outCostTypical)}`);
  console.log(`  chat output (conservative ${OUTPUT_CONSERVATIVE} tok/call): ${dollars(outCostConservative)}`);
  console.log("");
  console.log(`ESTIMATED TOTAL (typical):      ${dollars(totalTypical)}`);
  console.log(`ESTIMATED TOTAL (conservative): ${dollars(totalConservative)}`);
  console.log("");
  console.log("Note: a cheap RETRIEVAL_ONLY=1 pass of final-validate.ts costs only the");
  console.log(`${valEmbedCalls} embedding calls (~${dollars((valEmbedTokens / 1_000_000) * EMBED_PER_1M)}), no gpt-5-mini.`);
  console.log("Chat prices are assumptions; the true per-token cost will be reconciled from the");
  console.log("dashboard delta after Phase 1 (8 calls) before committing to Phase 2.");
}

main();
