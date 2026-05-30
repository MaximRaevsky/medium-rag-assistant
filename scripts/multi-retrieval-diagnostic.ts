import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { embedTexts } from "../lib/llmod";
import { getPinecone, getIndexName, getNamespace } from "../lib/pinecone";
import type { ChunkMetadata } from "../lib/types";

/**
 * Retrieval-only diagnostic for multi-result/list queries on namespace `final`.
 * No gpt-5-mini calls. Embeds each query variant once (batched), queries Pinecone
 * at the assignment cap (topK=30), and derives metrics for candidate widths
 * {5,10,15,30}.
 *
 * Question under test: for explicit multi-result requests, does an instruction-heavy
 * query ("List exactly 3 articles about X. Return only the titles.") retrieve >=3
 * genuinely-relevant distinct articles, or does a topic-focused / metadata-friendly
 * query do better? Config stays 512/0.10; this only probes the retrieval query.
 */
const WIDTHS = [5, 10, 15, 30];
const MAX_K = 30;

interface Topic {
  name: string;
  /** Curated grounded pool (lower-bound relevance flag; titles are shown for manual judgement). */
  pool: string[];
  variants: { label: string; text: string }[];
}

const topics: Topic[] = [
  {
    name: "education",
    pool: ["5338", "5997", "6649", "6599", "5135", "1303", "1247"],
    variants: [
      { label: "full", text: "List exactly 3 articles about education. Return only the titles." },
      { label: "topic-short", text: "education articles" },
      { label: "topic-expanded", text: "education learning teaching school students" },
      { label: "metadata", text: "education article title tags learning teaching school students" },
    ],
  },
  {
    name: "building habits",
    pool: ["899", "334", "1739", "5262", "4727", "1907"],
    variants: [
      { label: "full", text: "List exactly 3 articles about building habits. Return only the titles." },
      { label: "topic-short", text: "building habits articles" },
      { label: "topic-expanded", text: "habits routines productivity discipline behavior change" },
      { label: "metadata", text: "habits article title tags routine productivity behavior change" },
    ],
  },
  {
    name: "mental health",
    pool: ["7", "190", "196", "218", "1471", "2353"],
    variants: [
      { label: "full", text: "List exactly 3 articles about mental health. Return only the titles." },
      { label: "topic-short", text: "mental health articles" },
      { label: "topic-expanded", text: "mental health wellbeing therapy stress depression" },
      { label: "metadata", text: "mental health article title tags wellbeing therapy stress depression" },
    ],
  },
  {
    name: "anxiety",
    pool: ["292", "313", "1505", "1681", "1730", "1372"],
    variants: [
      { label: "full", text: "List exactly 3 articles about dealing with anxiety. Return only the titles." },
      { label: "topic-short", text: "anxiety articles" },
      { label: "topic-expanded", text: "anxiety stress worry panic coping calm" },
      { label: "metadata", text: "anxiety article title tags stress worry panic coping" },
    ],
  },
  {
    name: "email marketing",
    pool: ["1846", "1599", "3272", "440"],
    variants: [
      { label: "full", text: "List exactly 3 articles about email marketing. Return only the titles." },
      { label: "topic-short", text: "email marketing articles" },
      { label: "topic-expanded", text: "email marketing newsletter subscribers list campaigns" },
      { label: "metadata", text: "email marketing article title tags newsletter subscribers campaigns" },
    ],
  },
];

interface Match {
  id: string;
  title: string;
  score: number;
}

async function queryFinal(vector: number[], ns: string): Promise<Match[]> {
  const res = await getPinecone()
    .index<ChunkMetadata>(getIndexName())
    .namespace(ns)
    .query({ vector, topK: MAX_K, includeMetadata: true });
  return res.matches.map((m) => ({
    id: m.metadata?.article_id ?? "",
    title: m.metadata?.title ?? "",
    score: m.score ?? 0,
  }));
}

/** Distinct articles (best chunk per id) in rank order, within top-k. */
function distinct(matches: Match[], k: number): Match[] {
  const seen = new Set<string>();
  const out: Match[] = [];
  for (const m of matches.slice(0, k)) {
    if (!seen.has(m.id)) {
      seen.add(m.id);
      out.push(m);
    }
  }
  return out;
}

/** Count noise (non-pool) distinct articles encountered before the 3rd pool-distinct article. */
function noiseBefore3(distinctList: Match[], pool: Set<string>): number {
  let rel = 0;
  let noise = 0;
  for (const m of distinctList) {
    if (pool.has(m.id)) {
      rel++;
      if (rel >= 3) break;
    } else {
      noise++;
    }
  }
  return noise;
}

async function main() {
  const ns = getNamespace();
  console.log(`multi-retrieval-diagnostic | namespace=${ns} | widths=${WIDTHS.join(",")} | MAX_K=${MAX_K}`);
  if (ns !== "final") console.log(`WARNING: namespace is "${ns}", not "final".`);

  // Batch-embed every variant across all topics (one paid embeddings call).
  const allTexts: string[] = [];
  for (const t of topics) for (const v of t.variants) allTexts.push(v.text);
  const vectors = await embedTexts(allTexts);
  const vecByText = new Map(allTexts.map((s, i) => [s, vectors[i]]));
  console.log(`embeddings used: ${allTexts.length} (1 batched call)\n`);

  for (const t of topics) {
    const pool = new Set(t.pool);
    console.log(`\n################ TOPIC: ${t.name} (pool ids: ${t.pool.join(",")}) ################`);

    for (const v of t.variants) {
      const matches = await queryFinal(vecByText.get(v.text)!, ns);
      console.log(`\n---- variant=${v.label} | query="${v.text}" ----`);

      // Top-10 raw retrieved (chunk-level), with pool flag.
      console.log("  top-10 retrieved (rank id score pool title):");
      for (let i = 0; i < Math.min(10, matches.length); i++) {
        const m = matches[i];
        console.log(`    ${String(i + 1).padStart(2)} ${m.id.padStart(5)} ${m.score.toFixed(4)} ${pool.has(m.id) ? "P" : " "} ${m.title}`);
      }

      // Width metrics.
      console.log("  width  distinct  poolDistinct  >=3pool  noiseBefore3");
      for (const k of WIDTHS) {
        const d = distinct(matches, k);
        const poolDistinct = d.filter((m) => pool.has(m.id)).length;
        const nb3 = noiseBefore3(d, pool);
        console.log(
          `  ${String(k).padStart(5)}  ${String(d.length).padStart(8)}  ${String(poolDistinct).padStart(12)}  ${(poolDistinct >= 3 ? "yes" : "no").padStart(7)}  ${String(nb3).padStart(12)}`,
        );
      }
    }
  }
  console.log(`\nDONE | embeddings used: ${allTexts.length}`);
}

main().catch((err) => {
  console.error("multi-retrieval-diagnostic failed:", err?.message ?? err);
  process.exit(1);
});
