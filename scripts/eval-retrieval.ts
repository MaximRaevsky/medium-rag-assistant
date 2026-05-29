import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { embedTexts } from "../lib/llmod";
import { getPinecone, getIndexName } from "../lib/pinecone";
import type { ChunkMetadata } from "../lib/types";
import { evalQuestions } from "./eval-set";

/**
 * Rank-aware retrieval evaluation (Stage 7B). Embeds each question once and
 * reuses the vector across namespaces (question vector is namespace-independent).
 * Queries each config namespace at topK=10 and derives metrics for k in 5/7/10.
 * Does NOT call gpt-5-mini.
 */
const NAMESPACES = [
  { ns: "eval_384_10", label: "384/0.10" },
  { ns: "eval_512_15", label: "512/0.15" },
  { ns: "eval_768_15", label: "768/0.15" },
];
const KS = [5, 7, 10];
const MAX_K = 10;

interface Match {
  articleId: string;
  title: string;
  score: number;
  chunk: string;
}

async function queryNs(ns: string, vector: number[]): Promise<Match[]> {
  const res = await getPinecone()
    .index<ChunkMetadata>(getIndexName())
    .namespace(ns)
    .query({ vector, topK: MAX_K, includeMetadata: true });
  return res.matches.map((m) => ({
    articleId: m.metadata?.article_id ?? "",
    title: m.metadata?.title ?? "",
    score: m.score ?? 0,
    chunk: m.metadata?.chunk_text ?? "",
  }));
}

/** First 1-based rank where a match's article is in targets (0 if none in top MAX_K). */
function bestRank(matches: Match[], targets: Set<string>): { rank: number; score: number } {
  for (let i = 0; i < matches.length; i++) {
    if (targets.has(matches[i].articleId)) return { rank: i + 1, score: matches[i].score };
  }
  return { rank: 0, score: 0 };
}

/** Distinct target articles present in matches[:k], in rank order. */
function distinctTargets(matches: Match[], targets: Set<string>, k: number): Match[] {
  const seen = new Set<string>();
  const out: Match[] = [];
  for (const m of matches.slice(0, k)) {
    if (targets.has(m.articleId) && !seen.has(m.articleId)) {
      seen.add(m.articleId);
      out.push(m);
    }
  }
  return out;
}

async function main() {
  const vectors = await embedTexts(evalQuestions.map((q) => q.question));
  const vecByQ = new Map(evalQuestions.map((q, i) => [q.id, vectors[i]]));

  // matches[questionId][namespace] = Match[]
  const all = new Map<string, Map<string, Match[]>>();
  for (const q of evalQuestions) {
    const perNs = new Map<string, Match[]>();
    for (const { ns } of NAMESPACES) perNs.set(ns, await queryNs(ns, vecByQ.get(q.id)!));
    all.set(q.id, perNs);
  }

  for (const q of evalQuestions) {
    console.log(`\n================ ${q.id.toUpperCase()} [${q.category}] ================`);
    console.log(q.question);
    const targets = new Set(q.targetIds);

    for (const { ns, label } of NAMESPACES) {
      const matches = all.get(q.id)!.get(ns)!;

      if (q.category === "precise" || q.category === "summary") {
        const { rank, score } = bestRank(matches, targets);
        const flags = KS.map((k) => `found@${k}=${rank > 0 && rank <= k ? "Y" : "N"}`).join(" ");
        console.log(`  ${label}: target_rank=${rank || "-"} score=${score.toFixed(4)} | ${flags}`);
      } else if (q.category === "multi") {
        const parts = KS.map((k) => `distinct_edu@${k}=${distinctTargets(matches, targets, k).length}`).join(" ");
        console.log(`  ${label}: ${parts}`);
        const top = distinctTargets(matches, targets, MAX_K).slice(0, 3);
        top.forEach((m) => console.log(`      - id=${m.articleId} score=${m.score.toFixed(4)} "${m.title}"`));
      } else {
        // recommendation: report any habit-cluster matches with rank/score + top evidence
        const hits = matches
          .map((m, i) => ({ ...m, rank: i + 1 }))
          .filter((m) => targets.has(m.articleId));
        const summary = hits.length
          ? hits.map((h) => `#${h.rank}(id=${h.articleId},${h.score.toFixed(3)})`).join(" ")
          : "none in top10";
        console.log(`  ${label}: habit hits: ${summary}`);
        if (hits.length) {
          const ev = hits[0];
          console.log(`      evidence id=${ev.articleId} "${ev.title}": ${ev.chunk.slice(0, 160).replace(/\s+/g, " ")}...`);
        }
      }
    }
  }

  // Compact comparison: rank of target for single-target questions across configs.
  console.log(`\n================ COMPACT COMPARISON (single-target rank within top10) ================`);
  console.log(`question  ${NAMESPACES.map((n) => n.label.padStart(10)).join("")}`);
  for (const q of evalQuestions) {
    if (q.category !== "precise" && q.category !== "summary") continue;
    const targets = new Set(q.targetIds);
    const cells = NAMESPACES.map(({ ns }) => {
      const { rank } = bestRank(all.get(q.id)!.get(ns)!, targets);
      return (rank ? `#${rank}` : "-").padStart(10);
    }).join("");
    console.log(`${q.id.padEnd(9)}${cells}`);
  }
}

main().catch((err) => {
  console.error("Eval retrieval failed:", err?.message ?? err);
  process.exit(1);
});
