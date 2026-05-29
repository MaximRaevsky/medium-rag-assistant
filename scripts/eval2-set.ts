/**
 * Stage 7C expanded evaluation set (grounded in real corpus articles).
 *
 * 14 questions, >=3 per required behavior category. Targets/pools were validated
 * by local keyword search over the full CSV (scripts/find-eval-articles.ts) and
 * author/title lookups (scripts/show-articles.ts).
 *
 * Deterministic subset (buildSubset2) = union of:
 *   - all question target/pool article ids,
 *   - a curated hard-distractor id list (top hits from fixed topic searches that
 *     are topically confusable with the targets but are NOT relevant answers),
 *   - a fixed general-background sample: the first BACKGROUND_COUNT row indices.
 * The whole subset is a fixed id set, so it is fully reproducible.
 */

export type EvalCategory = "precise" | "summary" | "multi" | "recommendation";

export interface EvalQuestion {
  id: string;
  category: EvalCategory;
  question: string;
  /** precise/summary: single expected id. multi/recommendation: relevant pool/cluster. */
  targetIds: string[];
  note?: string;
}

export const evalQuestions: EvalQuestion[] = [
  // ---- Precise single-article retrieval (4) ----
  {
    id: "p1",
    category: "precise",
    question:
      "I'm a writer who hates social media. Which article suggests other ways to promote my writing? Give the title and author.",
    targetIds: ["1934"],
    note: '"Hate Social Media? Here Are Other Ways To Promote Your Writing" by Jae Nichelle',
  },
  {
    id: "p2",
    category: "precise",
    question: "Which article is a book review of James Clear's 'Atomic Habits'? Give the title and author.",
    targetIds: ["5262"],
    note: '"Atomic Habits by James Clear" by Ilknur Eren (vs how-to id=1739)',
  },
  {
    id: "p3",
    category: "precise",
    question: "Which article explains how to simulate a pandemic using Python? Give the title and author.",
    targetIds: ["4365"],
    note: '"How to Simulate a Pandemic in Python" by Terence Shin',
  },
  {
    id: "p4",
    category: "precise",
    question: "Which article explains how Coursera uses psychology to make education addictive? Give the title and author.",
    targetIds: ["669"],
    note: '"How Coursera uses psychology to make education addictive" by Jennifer Clinehens',
  },

  // ---- Central-idea summary (3) ----
  {
    id: "s1",
    category: "summary",
    question: "Summarize the central idea of the article about improving mental health during the pandemic.",
    targetIds: ["5324"],
    note: '"I Improved My Mental Health During a Pandemic" by Tiffany Hsu',
  },
  {
    id: "s2",
    category: "summary",
    question: "Summarize the central idea of the article about what makes habits stick.",
    targetIds: ["899"],
    note: '"The Magic Key to Making Habits Sticky" by Shaunta Grimes',
  },
  {
    id: "s3",
    category: "summary",
    question: "Summarize the central idea of the article about the educational practices behind gamification.",
    targetIds: ["5997"],
    note: '"Educational Practices behind Gamification" by Kriti Khare',
  },

  // ---- Multi-result listing of 3 distinct (4 topics) ----
  {
    id: "m1",
    category: "multi",
    question: "List exactly 3 articles about education.",
    targetIds: ["5338", "5997", "6649", "6599", "5135", "1303", "1247"],
    note: "Education pool (7 distinct).",
  },
  {
    id: "m2",
    category: "multi",
    question: "List exactly 3 articles about building habits.",
    targetIds: ["899", "334", "1739", "5262", "4727", "1907"],
    note: "Habits pool (6 distinct).",
  },
  {
    id: "m3",
    category: "multi",
    question: "List exactly 3 articles about mental health.",
    targetIds: ["7", "190", "196", "218", "1471", "2353"],
    note: "Mental-health pool (6 distinct).",
  },
  {
    id: "m4",
    category: "multi",
    question: "List exactly 3 articles about dealing with anxiety.",
    targetIds: ["292", "313", "1505", "1681", "1730", "1372"],
    note: "Anxiety pool (6 distinct).",
  },

  // ---- Recommendation with evidence (3) ----
  {
    id: "r1",
    category: "recommendation",
    question:
      "I want beginner-friendly, practical advice on building habits that actually stick. Recommend one article and justify your choice using evidence from it.",
    targetIds: ["899", "334", "1739", "5262"],
    note: "Habit cluster; evidence = concrete, actionable habit-building steps.",
  },
  {
    id: "r2",
    category: "recommendation",
    question:
      "I'm launching an online store and want to start email marketing. Recommend one article and justify your choice using evidence from it.",
    targetIds: ["1846", "1599", "3272", "440"],
    note: "Email-marketing cluster; evidence = concrete email-marketing/list-building tactics.",
  },
  {
    id: "r3",
    category: "recommendation",
    question:
      "I struggle with everyday anxiety and want practical coping techniques. Recommend one article and justify your choice using evidence from it.",
    targetIds: ["313", "1505", "1730", "292"],
    note: "Anxiety-coping cluster; evidence = concrete coping techniques.",
  },
];

/**
 * Curated hard distractors: topically confusable with the targets but not valid
 * answers. Derived from fixed topic searches (marketing/social/writing,
 * social-media detox, productivity, python/data-science, other pandemic,
 * depression, climate, gamification/design). None overlap the target set.
 */
export const HARD_DISTRACTORS = [
  // marketing / social-media marketing / writing-promotion
  "113", "1767", "1967", "2249", "999", "1152", "1571", "1816", "1608", "518", "2611", "2076", "2709", "947", "7327", "6278", "6948",
  // social-media detox / "living without social media"
  "584", "631", "1750", "1297",
  // productivity (confusable with habits/recommendation)
  "117", "318", "687", "712", "1498", "1508", "1603",
  // python / data science (confusable with the python-pandemic precise question)
  "119", "153", "198", "230", "325", "367", "402", "591", "647",
  // other pandemic articles (confusable with the pandemic summary/precise)
  "4340", "6299", "4588", "4864", "4411", "1307", "7588",
  // depression (confusable with mental-health / anxiety pools)
  "676", "2148", "2877", "3609", "5266", "6568",
  // climate (general adjacent topic)
  "385", "678", "686", "693", "722", "835",
  // gamification / design (confusable with the gamification summary)
  "6048", "3877",
];

/** Fixed general-background sample: first N row indices. */
export const BACKGROUND_COUNT = 350;

/** Deterministic expanded subset id set. */
export function buildSubset2(): Set<string> {
  const ids = new Set<string>();
  for (let i = 0; i < BACKGROUND_COUNT; i++) ids.add(String(i));
  for (const q of evalQuestions) for (const t of q.targetIds) ids.add(t);
  for (const d of HARD_DISTRACTORS) ids.add(d);
  return ids;
}
