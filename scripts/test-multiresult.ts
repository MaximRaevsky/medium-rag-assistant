import { isMultiResultQuestion } from "../lib/retrieval";

/** Verify the multi-result heuristic on realistic phrasing variants (local, no paid calls). */
const cases: { q: string; expected: boolean }[] = [
  // Should be detected as multi-result:
  { q: "List exactly 3 articles about education.", expected: true },
  { q: "Can you list a few articles on productivity?", expected: true },
  { q: "Give me the titles of articles about habits.", expected: true },
  { q: "Show me three articles about mindfulness.", expected: true },
  { q: "I'd like several articles related to marketing.", expected: true },
  { q: "What are some article titles about pandemics?", expected: true },
  { q: "Recommend multiple articles on writing.", expected: true },
  // Should NOT be detected (single-article intent):
  { q: "Which article is a book review of Atomic Habits? Give the title and author.", expected: false },
  { q: "Summarize the central idea of the article about mental health during the pandemic.", expected: false },
  { q: "Recommend one article about building habits and justify it.", expected: false },
  { q: "What is the title of the article that discusses educational chatbots?", expected: false },
];

let pass = 0;
for (const c of cases) {
  const got = isMultiResultQuestion(c.q);
  const ok = got === c.expected;
  if (ok) pass++;
  console.log(`${ok ? "PASS" : "FAIL"} expected=${c.expected} got=${got} | ${c.q}`);
}
console.log(`\n${pass}/${cases.length} cases passed`);
