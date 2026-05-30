/**
 * Final-corpus validation set (namespace `final`, full 7,682-article corpus).
 *
 * Grounded targets/pools/clusters were confirmed present in the corpus by local
 * keyword and author/title lookups. This set adds:
 *   - a robust fallback / no-answer category, and
 *   - per-test mode (retrieval-only vs generation) and machine-checkable
 *     pass criteria, used by scripts/final-validate.ts.
 *
 * No data here triggers any paid call; it is pure test definitions.
 */

export type FinalCategory =
  | "precise"
  | "multi"
  | "summary"
  | "recommendation"
  | "fallback";

/** How retrieved context should be checked for this test. */
export type RetrievalCheck =
  | "single" // a specific target article_id must appear in context
  | "pool3" // >= 3 distinct pool article_ids must appear in (deduped) context
  | "cluster" // >= 1 acceptable-cluster article_id must appear in context
  | "absent"; // fallback: no acceptable target exists; context cannot answer it

export interface FinalTest {
  id: string;
  category: FinalCategory;
  question: string;
  /**
   * precise/summary: single expected target id.
   * multi: relevant topic pool (any >= 3 distinct are acceptable).
   * recommendation: acceptable cluster.
   * fallback: empty (nothing in the corpus should satisfy it).
   */
  targetIds: string[];
  expectedTitle?: string;
  expectedAuthor?: string;
  /** How to score retrieval for this test. */
  retrievalCheck: RetrievalCheck;
  /** Whether this test needs a paid gpt-5-mini call (vs retrieval-only). */
  needsGeneration: boolean;
  /** Optional format-control instruction appended to the user prompt. */
  instruction?: string;
  /** Human-readable pass criteria (for the report and manual verdicts). */
  pass: string;
  note?: string;
}

const PRECISE_INSTRUCTION =
  "\n\nInstruction: Answer with only the article title and author. Do not add explanation.";
const SUMMARY_INSTRUCTION =
  "\n\nInstruction: Summarize the central idea in at most 3 sentences, using only the provided context.";
const RECOMMENDATION_INSTRUCTION =
  "\n\nInstruction: Recommend exactly one article in one short paragraph, justified with a concrete quote or paraphrase from the retrieved context.";

export const finalTests: FinalTest[] = [
  // ---------------- Precise single-article retrieval (4) ----------------
  {
    id: "p1",
    category: "precise",
    question:
      "I'm a writer who hates social media. Which article suggests other ways to promote my writing? Give the title and author.",
    targetIds: ["1934"],
    expectedTitle: "Hate Social Media? Here Are Other Ways To Promote Your Writing",
    expectedAuthor: "Jae Nichelle",
    retrievalCheck: "single",
    needsGeneration: true,
    instruction: PRECISE_INSTRUCTION,
    pass: "Target id 1934 in context; response states the exact title and author; no extra prose.",
  },
  {
    id: "p2",
    category: "precise",
    question:
      "Which article is a book review of James Clear's 'Atomic Habits'? Give the title and author.",
    targetIds: ["5262"],
    expectedTitle: "Atomic Habits by James Clear",
    expectedAuthor: "Ilknur Eren",
    retrievalCheck: "single",
    needsGeneration: true,
    instruction: PRECISE_INSTRUCTION,
    pass: "Target id 5262 (review, not how-to id 1739) in context; correct title + author.",
  },
  {
    id: "p3",
    category: "precise",
    question:
      "Which article explains how to simulate a pandemic using Python? Give the title and author.",
    targetIds: ["4365"],
    expectedTitle: "How to Simulate a Pandemic in Python",
    expectedAuthor: "Terence Shin",
    retrievalCheck: "single",
    needsGeneration: true,
    instruction: PRECISE_INSTRUCTION,
    pass: "Target id 4365 in context; correct title + author.",
  },
  {
    id: "p4",
    category: "precise",
    question:
      "Which article explains how Coursera uses psychology to make education addictive? Give the title and author.",
    targetIds: ["669"],
    expectedTitle: "How Coursera uses psychology to make education addictive",
    expectedAuthor: "Jennifer Clinehens",
    retrievalCheck: "single",
    needsGeneration: true,
    instruction: PRECISE_INSTRUCTION,
    pass: "Target id 669 in context; correct title + author.",
  },

  // ---------------- Central-idea summary (3) ----------------
  {
    id: "s1",
    category: "summary",
    question:
      "Summarize the central idea of the article about improving mental health during the pandemic.",
    targetIds: ["5324"],
    expectedTitle: "I Improved My Mental Health During a Pandemic",
    expectedAuthor: "Tiffany Hsu",
    retrievalCheck: "single",
    needsGeneration: true,
    instruction: SUMMARY_INSTRUCTION,
    pass: "Target id 5324 in context; concise summary grounded only in retrieved passages.",
  },
  {
    id: "s2",
    category: "summary",
    question: "Summarize the central idea of the article about what makes habits stick.",
    targetIds: ["899"],
    expectedTitle: "The Magic Key to Making Habits Sticky",
    expectedAuthor: "Shaunta Grimes",
    retrievalCheck: "single",
    needsGeneration: true,
    instruction: SUMMARY_INSTRUCTION,
    pass: "Target id 899 in context; concise grounded summary.",
  },
  {
    id: "s3",
    category: "summary",
    question:
      "Summarize the central idea of the article about the educational practices behind gamification.",
    targetIds: ["5997"],
    expectedTitle: "Educational Practices behind Gamification",
    expectedAuthor: "Kriti Khare",
    retrievalCheck: "single",
    needsGeneration: true,
    instruction: SUMMARY_INSTRUCTION,
    pass: "Target id 5997 in context; concise grounded summary.",
  },

  // ---------------- Multi-result listing, 3 distinct titles only (4) ----------------
  {
    id: "m_edu",
    category: "multi",
    // Exact required-style prompt.
    question: "List exactly 3 articles about education. Return only the titles.",
    targetIds: ["5338", "5997", "6649", "6599", "5135", "1303", "1247"],
    retrievalCheck: "pool3",
    needsGeneration: true,
    pass: "Exactly 3 lines = 3 distinct titles only (no authors/prose); each maps to a distinct context article_id; >=3 distinct education-pool ids appear in deduped context.",
    note: "Education pool (7 distinct).",
  },
  {
    id: "m_habits",
    category: "multi",
    question: "List exactly 3 articles about building habits. Return only the titles.",
    targetIds: ["899", "334", "1739", "5262", "4727", "1907"],
    retrievalCheck: "pool3",
    needsGeneration: true,
    pass: "Exactly 3 distinct titles only; >=3 distinct habit-pool ids in deduped context.",
    note: "Habits pool (6 distinct).",
  },
  {
    id: "m_mh",
    category: "multi",
    question: "List exactly 3 articles about mental health. Return only the titles.",
    targetIds: ["7", "190", "196", "218", "1471", "2353"],
    retrievalCheck: "pool3",
    needsGeneration: true,
    pass: "Exactly 3 distinct titles only; >=3 distinct mental-health-pool ids in deduped context.",
    note: "Mental-health pool (6 distinct).",
  },
  {
    id: "m_anx",
    category: "multi",
    question: "List exactly 3 articles about dealing with anxiety. Return only the titles.",
    targetIds: ["292", "313", "1505", "1681", "1730", "1372"],
    retrievalCheck: "pool3",
    needsGeneration: true,
    pass: "Exactly 3 distinct titles only; >=3 distinct anxiety-pool ids in deduped context.",
    note: "Anxiety pool (6 distinct).",
  },

  // ---------------- Recommendation with evidence (3) ----------------
  {
    id: "r_habits",
    category: "recommendation",
    question:
      "I want beginner-friendly, practical advice on building habits that actually stick. Recommend one article and justify your choice using evidence from it.",
    targetIds: ["899", "334", "1739", "5262"],
    retrievalCheck: "cluster",
    needsGeneration: true,
    instruction: RECOMMENDATION_INSTRUCTION,
    pass: "Recommends exactly one article from the habit cluster; justification quotes/paraphrases a retrieved passage.",
  },
  {
    id: "r_email",
    category: "recommendation",
    question:
      "I'm launching an online store and want to start email marketing. Recommend one article and justify your choice using evidence from it.",
    targetIds: ["1846", "1599", "3272", "440"],
    retrievalCheck: "cluster",
    needsGeneration: true,
    instruction: RECOMMENDATION_INSTRUCTION,
    pass: "Recommends one email-marketing article from the cluster; evidence-backed justification.",
  },
  {
    id: "r_anx",
    category: "recommendation",
    question:
      "I struggle with everyday anxiety and want practical coping techniques. Recommend one article and justify your choice using evidence from it.",
    targetIds: ["313", "1505", "1730", "292"],
    retrievalCheck: "cluster",
    needsGeneration: true,
    instruction: RECOMMENDATION_INSTRUCTION,
    pass: "Recommends one anxiety-coping article from the cluster; evidence-backed justification.",
  },

  // ---------------- Fallback / no-answer (5) ----------------
  {
    id: "f_sports",
    category: "fallback",
    question:
      "Who won the 2026 FIFA World Cup final, and what was the exact final score?",
    targetIds: [],
    retrievalCheck: "absent",
    needsGeneration: true,
    pass: "Context cannot answer (static Medium corpus); response is the exact fallback line; no invented result or source.",
    note: "Recent-event question: not groundable in a static dataset.",
  },
  {
    id: "f_stock_weather",
    category: "fallback",
    question:
      "What is Apple's stock price right now, and what's tomorrow's weather forecast for Tel Aviv?",
    targetIds: [],
    retrievalCheck: "absent",
    needsGeneration: true,
    pass: "Live/time-varying data not in corpus; response is the exact fallback line; no fabricated numbers.",
    note: "Live data: cannot be grounded in the corpus.",
  },
  {
    id: "f_unrelated",
    category: "fallback",
    question:
      "What is the recommended torque specification, in newton-meters, for the cylinder head bolts of a 2015 Toyota Corolla engine?",
    targetIds: [],
    retrievalCheck: "absent",
    needsGeneration: true,
    pass: "Clearly unrelated domain; response is the exact fallback line; no fabricated spec or source.",
    note: "Unrelated domain (automotive repair).",
  },
  {
    id: "f_madeup",
    category: "fallback",
    question:
      "Summarize the Medium article titled 'Quokka-Driven Development with the Znorflax Framework' by Dr. Penelope Vanderquill.",
    targetIds: [],
    retrievalCheck: "absent",
    needsGeneration: true,
    pass: "Made-up article/author; response is the exact fallback line; the model must not pretend the article exists or invent its contents.",
    note: "Highly specific fabricated entity unlikely to appear in the dataset.",
  },
  {
    id: "f_genknow",
    category: "fallback",
    question: "What is the capital of France?",
    targetIds: [],
    retrievalCheck: "absent",
    needsGeneration: true,
    pass: "Grounding-stress test: answerable from model priors but NOT from the Medium context, so the strictly-grounded assistant must return the exact fallback line rather than answering 'Paris'.",
    note: "General-knowledge stress test for strict grounding (prior-knowledge leakage check).",
  },
];

/** Representative subset for the small default-vs-minimal comparison (one per core category). */
export const representativeIds = ["p1", "m_edu", "s1", "r_habits"] as const;

/** The exact mandatory fallback wording required by the assignment. */
export const FALLBACK_SENTENCE = "I don't know based on the provided Medium articles data.";

/**
 * Normalize curly quotes/apostrophes and surrounding quotes so a fallback answer
 * matches regardless of the quote style the model emits.
 */
export function normalizeForFallback(text: string): string {
  return text
    .replace(/[\u2018\u2019\u02BC]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .trim();
}

/** True if the response contains the mandatory fallback sentence (quote-style agnostic). */
export function usesFallback(text: string): boolean {
  return normalizeForFallback(text)
    .toLowerCase()
    .includes(normalizeForFallback(FALLBACK_SENTENCE).toLowerCase());
}

export const byCategory = (c: FinalCategory): FinalTest[] =>
  finalTests.filter((t) => t.category === c);
