import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { embedTexts } from "../lib/llmod";
import { getPinecone, getIndexName } from "../lib/pinecone";
import type { ChunkMetadata } from "../lib/types";
import { evalQuestions } from "./eval2-set";
import type { EvalCategory } from "./eval2-set";

/**
 * Stage 7C expanded retrieval evaluation (no gpt-5-mini).
 * Embeds each question once, reuses the vector across all namespaces, queries
 * topK=15, and derives metrics for top_k in {5,7,10,15}.
 *
 * Multi-result contract: retrieve top_k, then dedupe by article_id (best chunk
 * per article). Precise/summary/recommendation: no dedup.
 */
const NAMESPACES = [
  { ns: "eval2_384_10", label: "384/0.10" },
  { ns: "eval2_384_15", label: "384/0.15" },
  { ns: "eval2_512_10", label: "512/0.10" },
  { ns: "eval2_512_15", label: "512/0.15" },
  { ns: "eval2_512_20", label: "512/0.20" },
  { ns: "eval2_768_15", label: "768/0.15" },
];
const KS = [5, 7, 10, 15];
const MAX_K = 15;

interface Match {
  articleId: string;
  title: string;
  score: number;
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
  }));
}

/** First 1-based rank where a match is in targets (0 if none in top MAX_K). */
function bestRank(matches: Match[], targets: Set<string>): { rank: number; score: number } {
  for (let i = 0; i < matches.length; i++) {
    if (targets.has(matches[i].articleId)) return { rank: i + 1, score: matches[i].score };
  }
  return { rank: 0, score: 0 };
}

/** Distinct articles in matches[:k] after dedup (best chunk per article), in rank order. */
function distinctArticles(matches: Match[], k: number): Match[] {
  const seen = new Set<string>();
  const out: Match[] = [];
  for (const m of matches.slice(0, k)) {
    if (!seen.has(m.articleId)) {
      seen.add(m.articleId);
      out.push(m);
    }
  }
  return out;
}

async function main() {
  const vectors = await embedTexts(evalQuestions.map((q) => q.question));
  const vecByQ = new Map(evalQuestions.map((q, i) => [q.id, vectors[i]]));

  const all = new Map<string, Map<string, Match[]>>();
  for (const q of evalQuestions) {
    const perNs = new Map<string, Match[]>();
    for (const { ns } of NAMESPACES) perNs.set(ns, await queryNs(ns, vecByQ.get(q.id)!));
    all.set(q.id, perNs);
  }

  // Aggregate scorecards per namespace.
  const score = new Map<string, { hit: Record<number, number>; rankSum: number; rankN: number }>();
  const multiSuccess = new Map<string, Record<number, number>>();
  const multiNoise = new Map<string, Record<number, number>>();
  for (const { ns } of NAMESPACES) {
    score.set(ns, { hit: { 5: 0, 7: 0, 10: 0, 15: 0 }, rankSum: 0, rankN: 0 });
    multiSuccess.set(ns, { 5: 0, 7: 0, 10: 0, 15: 0 });
    multiNoise.set(ns, { 5: 0, 7: 0, 10: 0, 15: 0 });
  }

  const byCat = (c: EvalCategory) => evalQuestions.filter((q) => q.category === c);

  // ---- Detailed per-question reporting ----
  for (const q of evalQuestions) {
    console.log(`\n================ ${q.id.toUpperCase()} [${q.category}] ================`);
    console.log(q.question);
    const targets = new Set(q.targetIds);

    for (const { ns, label } of NAMESPACES) {
      const matches = all.get(q.id)!.get(ns)!;

      if (q.category === "precise" || q.category === "summary") {
        const { rank, score: sc } = bestRank(matches, targets);
        const flags = KS.map((k) => (rank > 0 && rank <= k ? "Y" : "N")).join("");
        console.log(`  ${label}: rank=${rank || "-"} score=${sc.toFixed(4)} hit@[5,7,10,15]=${flags}`);
        const s = score.get(ns)!;
        for (const k of KS) if (rank > 0 && rank <= k) s.hit[k]++;
        if (rank > 0) {
          s.rankSum += rank;
          s.rankN++;
        }
      } else if (q.category === "multi") {
        const parts = KS.map((k) => {
          const dist = distinctArticles(matches, k);
          const rel = dist.filter((m) => targets.has(m.articleId)).length;
          const noise = dist.length - rel;
          if (rel >= 3) multiSuccess.get(ns)![k]++;
          multiNoise.get(ns)![k] += noise;
          return `k${k}:rel=${rel}/dist=${dist.length}/noise=${noise}`;
        }).join("  ");
        console.log(`  ${label}: ${parts}`);
      } else {
        // recommendation: strongest cluster article rank/score
        const { rank, score: sc } = bestRank(matches, targets);
        const distTop = distinctArticles(matches, MAX_K)
          .filter((m) => targets.has(m.articleId))
          .slice(0, 3)
          .map((m) => `${m.articleId}(${m.score.toFixed(3)})`)
          .join(",");
        console.log(`  ${label}: best_rank=${rank || "-"} score=${sc.toFixed(4)} cluster_top=[${distTop}]`);
        const s = score.get(ns)!;
        for (const k of KS) if (rank > 0 && rank <= k) s.hit[k]++;
        if (rank > 0) {
          s.rankSum += rank;
          s.rankN++;
        }
      }
    }
  }

  // ---- Compact comparison: single-target rank (precise+summary) per config ----
  console.log(`\n================ COMPACT: single-target rank (precise+summary) ================`);
  const singles = [...byCat("precise"), ...byCat("summary")];
  console.log(`question  ${NAMESPACES.map((n) => n.label.padStart(10)).join("")}`);
  for (const q of singles) {
    const targets = new Set(q.targetIds);
    const cells = NAMESPACES.map(({ ns }) => {
      const { rank } = bestRank(all.get(q.id)!.get(ns)!, targets);
      return (rank ? `#${rank}` : "-").padStart(10);
    }).join("");
    console.log(`${q.id.padEnd(9)}${cells}`);
  }

  // ---- Scorecards ----
  const nPreciseSummary = byCat("precise").length + byCat("summary").length;
  const nRec = byCat("recommendation").length;
  const nSingle = nPreciseSummary + nRec; // questions with a "rank" metric
  console.log(`\n================ SCORECARD (precise+summary+recommendation: ${nSingle} Qs) ================`);
  console.log(`config           hit@5  hit@7  hit@10 hit@15  mean_rank`);
  for (const { ns, label } of NAMESPACES) {
    const s = score.get(ns)!;
    const mean = s.rankN ? (s.rankSum / s.rankN).toFixed(2) : "-";
    console.log(
      `${label.padEnd(15)}  ${String(s.hit[5]).padStart(4)}  ${String(s.hit[7]).padStart(4)}  ` +
        `${String(s.hit[10]).padStart(5)}  ${String(s.hit[15]).padStart(5)}     ${mean}`,
    );
  }

  const nMulti = byCat("multi").length;
  console.log(`\n================ MULTI-RESULT SCORECARD (${nMulti} Qs; success = >=3 distinct relevant) ================`);
  console.log(`config           succ@5 succ@7 succ@10 succ@15 | avg_noise@[5,7,10,15]`);
  for (const { ns, label } of NAMESPACES) {
    const su = multiSuccess.get(ns)!;
    const no = multiNoise.get(ns)!;
    const noiseAvg = KS.map((k) => (no[k] / nMulti).toFixed(1)).join("/");
    console.log(
      `${label.padEnd(15)}  ${String(su[5]).padStart(4)}/${nMulti} ${String(su[7]).padStart(2)}/${nMulti} ` +
        `${String(su[10]).padStart(3)}/${nMulti} ${String(su[15]).padStart(3)}/${nMulti}  |  ${noiseAvg}`,
    );
  }
}

main().catch((err) => {
  console.error("Eval2 retrieval failed:", err?.message ?? err);
  process.exit(1);
});
