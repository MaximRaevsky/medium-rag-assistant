import { readArticles } from "../lib/dataset";

/**
 * Local keyword search over the corpus (no paid calls). Scores each article by
 * how many of the given terms appear in its title/tags/text, with title and
 * tag hits weighted higher. Prints the top matches with their article_id.
 *
 * Usage: SCAN=4000 tsx scripts/find-eval-articles.ts "habit" "stick" "routine"
 */
const TERMS = process.argv.slice(2).map((t) => t.toLowerCase());
const SCAN = process.env.SCAN ? Number(process.env.SCAN) : undefined;
const TOP = Number(process.env.TOP ?? 8);

interface Hit {
  articleId: string;
  title: string;
  tags: string[];
  score: number;
}

async function main() {
  if (TERMS.length === 0) {
    console.error('Provide search terms, e.g. tsx scripts/find-eval-articles.ts "education" "learning"');
    process.exit(1);
  }

  const hits: Hit[] = [];
  for await (const a of readArticles(SCAN)) {
    const title = a.title.toLowerCase();
    const tags = a.tags.join(" ").toLowerCase();
    const text = a.text.toLowerCase();
    let score = 0;
    for (const term of TERMS) {
      if (title.includes(term)) score += 5;
      if (tags.includes(term)) score += 3;
      if (text.includes(term)) score += 1;
    }
    if (score > 0) hits.push({ articleId: a.articleId, title: a.title, tags: a.tags, score });
  }

  hits.sort((x, y) => y.score - x.score);
  console.log(`Terms: ${JSON.stringify(TERMS)} | scanned=${SCAN ?? "ALL"} | matches=${hits.length}`);
  hits.slice(0, TOP).forEach((h) => {
    console.log(`  id=${h.articleId} score=${h.score} | "${h.title}" | tags=${JSON.stringify(h.tags)}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
