import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import {
  buildRetrievalQuery,
  extractMultiResultTopic,
  isMultiResultQuestion,
  retrieve,
  retrieveMulti,
  CANDIDATE_K,
} from "../lib/retrieval";
import { getNamespace } from "../lib/pinecone";

/**
 * Verifies the multi-result retrieval fix. Two parts:
 *   1) PURE (free): topic extraction / query building / routing assertions.
 *   2) RETRIEVAL-ONLY (cheap embeddings, no gpt-5-mini): for each multi-result
 *      topic, show the derived query and the deduped distinct context from `final`.
 */

// ---- Part 1: pure-function checks (no API calls) ----
const pureCases: { q: string; topic: string; query: string; multi: boolean }[] = [
  { q: "List exactly 3 articles about education. Return only the titles.", topic: "education", query: "articles about education", multi: true },
  { q: "List exactly 3 articles about building habits. Return only the titles.", topic: "building habits", query: "articles about building habits", multi: true },
  { q: "List exactly 3 articles about dealing with anxiety. Return only the titles.", topic: "dealing with anxiety", query: "articles about dealing with anxiety", multi: true },
  { q: "List exactly 3 articles about email marketing. Return only the titles.", topic: "email marketing", query: "articles about email marketing", multi: true },
  // Non-multi must be unchanged (query == original question).
  { q: "Which article is a book review of James Clear's 'Atomic Habits'? Give the title and author.", topic: "", query: "Which article is a book review of James Clear's 'Atomic Habits'? Give the title and author.", multi: false },
  { q: "Summarize the central idea of the article about what makes habits stick.", topic: "", query: "Summarize the central idea of the article about what makes habits stick.", multi: false },
];

function runPure(): boolean {
  console.log("================ PURE CHECKS (no API) ================");
  let ok = true;
  for (const c of pureCases) {
    const multi = isMultiResultQuestion(c.q);
    const query = buildRetrievalQuery(c.q);
    const topic = multi ? extractMultiResultTopic(c.q) : "";
    const pass = multi === c.multi && query === c.query && (!multi || topic === c.topic);
    if (!pass) ok = false;
    console.log(`  [${pass ? "PASS" : "FAIL"}] multi=${multi} topic="${topic}" query="${query}"`);
    if (!pass) console.log(`         expected multi=${c.multi} topic="${c.topic}" query="${c.query}"`);
  }
  console.log("");
  return ok;
}

// ---- Part 2: retrieval-only verification ----
const topics: { name: string; question: string }[] = [
  { name: "education", question: "List exactly 3 articles about education. Return only the titles." },
  { name: "building habits", question: "List exactly 3 articles about building habits. Return only the titles." },
  { name: "mental health", question: "List exactly 3 articles about mental health. Return only the titles." },
  { name: "anxiety", question: "List exactly 3 articles about dealing with anxiety. Return only the titles." },
  { name: "email marketing", question: "List exactly 3 articles about email marketing. Return only the titles." },
];

async function main() {
  const pureOk = runPure();

  const ns = getNamespace();
  console.log(`================ RETRIEVAL-ONLY VERIFICATION | namespace=${ns} | candidate_k=${CANDIDATE_K} ================`);
  if (ns !== "final") console.log(`WARNING: namespace is "${ns}", not "final".`);

  let embeddings = 0;
  for (const t of topics) {
    const derived = buildRetrievalQuery(t.question);
    const distinct = await retrieveMulti(t.question); // 1 embedding each
    embeddings++;
    const context = distinct.slice(0, 3);

    console.log(`\n#### ${t.name} ####`);
    console.log(`  original question: "${t.question}"`);
    console.log(`  derived retrieval query: "${derived}"`);
    console.log(`  candidate_k used: ${CANDIDATE_K} | distinct after dedupe: ${distinct.length}`);
    console.log("  selected context (top 3 distinct):");
    context.forEach((c, i) =>
      console.log(`    #${i + 1} id=${c.article_id} score=${c.score.toFixed(4)} "${c.title}"`),
    );
    console.log("  next distinct candidates (4-6):");
    distinct.slice(3, 6).forEach((c, i) =>
      console.log(`    #${i + 4} id=${c.article_id} score=${c.score.toFixed(4)} "${c.title}"`),
    );
    console.log(`  >=3 distinct articles available: ${distinct.length >= 3 ? "yes" : "no"} (manual relevance check on titles above)`);
  }

  // Sanity: a non-multi query must still use the original question + retrieve() path.
  const nonMulti = "Summarize the central idea of the article about what makes habits stick.";
  const r = await retrieve(nonMulti); // 1 embedding
  embeddings++;
  console.log(`\n#### non-multi sanity (retrieve, top_k) ####`);
  console.log(`  question: "${nonMulti}"`);
  console.log(`  retrieved chunks: ${r.length} (no dedupe) | top id=${r[0]?.article_id} score=${r[0]?.score.toFixed(4)} "${r[0]?.title}"`);

  console.log(`\nPURE CHECKS: ${pureOk ? "ALL PASS" : "FAILURES PRESENT"}`);
  console.log(`embeddings used: ${embeddings} | gpt-5-mini calls: 0`);
}

main().catch((err) => {
  console.error("multi-fix-verify failed:", err?.message ?? err);
  process.exit(1);
});
