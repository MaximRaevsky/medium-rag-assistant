/**
 * Phase 7 evaluation set (grounded in articles that exist in the corpus).
 *
 * Each question maps to expected relevant article id(s) discovered by local
 * keyword search over the full CSV. The evaluation subset is built
 * deterministically from row indices so it is fully reproducible:
 *   - distractors: the first DISTRACTOR_COUNT articles (indices 0..N-1)
 *   - targets: the relevant article ids referenced by the questions below
 * This keeps the subset small (~130 articles), varied, and reproducible.
 */

export type EvalCategory = "precise" | "multi" | "summary" | "recommendation";

export interface EvalQuestion {
  id: string;
  category: EvalCategory;
  question: string;
  /** Expected relevant article id(s). For "multi", any >= 3 distinct from this pool. */
  targetIds: string[];
  note?: string;
}

export const evalQuestions: EvalQuestion[] = [
  {
    id: "q1",
    category: "precise",
    question:
      "I'm a writer who hates social media. Which article suggests other ways to promote my writing? Give the title and author.",
    targetIds: ["1934"],
    note: '"Hate Social Media? Here Are Other Ways To Promote Your Writing" by Jae Nichelle',
  },
  {
    id: "q2",
    category: "precise",
    question: "Which article is a book review of James Clear's 'Atomic Habits'? Give the title and author.",
    targetIds: ["5262"],
    note: '"Atomic Habits by James Clear" by Ilknur Eren (distinct from the how-to article id=1739)',
  },
  {
    id: "q3",
    category: "multi",
    question: "List exactly 3 articles about education.",
    targetIds: ["5338", "5997", "6649", "6599", "5135", "1303"],
    note: "Six education-tagged articles available; expect 3 distinct titles.",
  },
  {
    id: "q4",
    category: "summary",
    question: "Summarize the central idea of the article about improving mental health during the pandemic.",
    targetIds: ["5324"],
    note: '"I Improved My Mental Health During a Pandemic" by Tiffany Hsu',
  },
  {
    id: "q5",
    category: "recommendation",
    question:
      "I want beginner-friendly, practical advice on building habits that actually stick. Recommend one article and justify your choice using evidence from it.",
    targetIds: ["899", "5262", "1739", "334"],
    note: "Habit cluster; expect one recommendation with justification grounded in the chosen article.",
  },
];

/** Number of leading articles (by row index) used as distractors. */
export const DISTRACTOR_COUNT = 120;

/** Deterministic subset: first DISTRACTOR_COUNT indices + all referenced target ids. */
export function buildSubsetIds(): Set<string> {
  const ids = new Set<string>();
  for (let i = 0; i < DISTRACTOR_COUNT; i++) ids.add(String(i));
  for (const q of evalQuestions) for (const t of q.targetIds) ids.add(t);
  return ids;
}
