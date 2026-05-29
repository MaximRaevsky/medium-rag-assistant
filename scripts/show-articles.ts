import { readArticles } from "../lib/dataset";

/** Print full details for specific article ids. Usage: tsx scripts/show-articles.ts 899 1934 5262 */
const ids = new Set(process.argv.slice(2));

async function main() {
  if (ids.size === 0) {
    console.error("Provide article ids, e.g. tsx scripts/show-articles.ts 899 1934");
    process.exit(1);
  }
  let found = 0;
  for await (const a of readArticles()) {
    if (!ids.has(a.articleId)) continue;
    found++;
    console.log(`id=${a.articleId} | "${a.title}" | authors=${JSON.stringify(a.authors)} | tags=${JSON.stringify(a.tags)}`);
    if (found === ids.size) break;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
