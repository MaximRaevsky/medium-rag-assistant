import { createReadStream } from "node:fs";
import { parse } from "csv-parse";

const FILE = process.env.DATASET_PATH ?? "data/medium-english-50mb.csv";
const SAMPLE = Number(process.env.SAMPLE ?? 3);
const PREVIEW = 200;

type Row = Record<string, string>;

async function main() {
  const rows: Row[] = [];
  const parser = createReadStream(FILE).pipe(
    parse({ columns: true, to: SAMPLE, skip_empty_lines: true })
  );

  for await (const rec of parser) {
    rows.push(rec as Row);
  }

  if (rows.length === 0) {
    console.log("No rows parsed.");
    return;
  }

  const columns = Object.keys(rows[0]);
  console.log(`File: ${FILE}`);
  console.log(`Columns (${columns.length}): ${columns.join(", ")}`);

  rows.forEach((row, i) => {
    console.log(`\n--- Record ${i} ---`);
    for (const col of columns) {
      const value = row[col] ?? "";
      const preview = value.slice(0, PREVIEW).replace(/\s+/g, " ").trim();
      const ellipsis = value.length > PREVIEW ? " ..." : "";
      console.log(`  ${col} (chars=${value.length}): ${preview}${ellipsis}`);
    }
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
