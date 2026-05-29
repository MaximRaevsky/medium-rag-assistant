import { createReadStream } from "node:fs";
import { parse } from "csv-parse";
import { datasetPath } from "../lib/config";
import { parseListLiteral } from "../lib/dataset";

/** A parse failure = raw is non-empty and not "[]", yet parses to zero items. */
function isParseFailure(raw: string | undefined): boolean {
  const s = (raw ?? "").trim();
  if (s === "" || s === "[]") return false;
  return parseListLiteral(s).length === 0;
}

async function main() {
  const parser = createReadStream(datasetPath).pipe(
    parse({ columns: true, skip_empty_lines: true })
  );

  let total = 0;
  let missingTitle = 0;
  let missingText = 0;
  let missingUrl = 0;
  let emptyAuthors = 0;
  let authorsParseFailures = 0;
  let tagsParseFailures = 0;
  const urlCounts = new Map<string, number>();
  const failureExamples: string[] = [];

  for await (const row of parser) {
    const r = row as Record<string, string>;
    total++;

    if (!(r.title ?? "").trim()) missingTitle++;
    if (!(r.text ?? "").trim()) missingText++;

    const url = (r.url ?? "").trim();
    if (!url) missingUrl++;
    else urlCounts.set(url, (urlCounts.get(url) ?? 0) + 1);

    if (parseListLiteral(r.authors).length === 0) emptyAuthors++;
    if (isParseFailure(r.authors)) {
      authorsParseFailures++;
      if (failureExamples.length < 3) failureExamples.push(`authors=${JSON.stringify((r.authors ?? "").slice(0, 120))}`);
    }
    if (isParseFailure(r.tags)) {
      tagsParseFailures++;
      if (failureExamples.length < 3) failureExamples.push(`tags=${JSON.stringify((r.tags ?? "").slice(0, 120))}`);
    }
  }

  let distinctDuplicatedUrls = 0;
  let redundantUrlRows = 0;
  for (const count of urlCounts.values()) {
    if (count > 1) {
      distinctDuplicatedUrls++;
      redundantUrlRows += count - 1;
    }
  }

  console.log("Full CSV validation:");
  console.log({
    totalArticles: total,
    missingTitle,
    missingText,
    missingUrl,
    emptyAuthorsArrays: emptyAuthors,
    authorsParseFailures,
    tagsParseFailures,
    distinctDuplicatedUrls,
    redundantUrlRows,
  });
  if (failureExamples.length) {
    console.log("Parse-failure examples:");
    failureExamples.forEach((e) => console.log("  " + e));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
