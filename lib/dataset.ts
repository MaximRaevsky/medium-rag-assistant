import { createReadStream } from "node:fs";
import { parse } from "csv-parse";
import { datasetPath } from "./config";
import type { Article } from "./types";

/**
 * Parse a Python-style list literal such as `['Mental Health', 'Health']`
 * into a string array. Handles empty lists and escaped quotes. Falls back to
 * an empty array on anything unrecognized.
 */
export function parseListLiteral(raw: string | undefined): string[] {
  const s = (raw ?? "").trim();
  if (s === "" || s === "[]") return [];

  const items: string[] = [];
  const re = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(s)) !== null) {
    const value = (match[1] ?? match[2] ?? "").replace(/\\(['"])/g, "$1").trim();
    if (value) items.push(value);
  }
  return items;
}

/**
 * Stream articles from the dataset CSV in file order. The articleId is the
 * 0-based row index as a string, so subset reads reproduce the same ids as a
 * full read. Pass `limit` to read only the first N rows.
 */
export async function* readArticles(limit?: number): AsyncGenerator<Article> {
  const parser = createReadStream(datasetPath).pipe(
    parse({ columns: true, skip_empty_lines: true, ...(limit ? { to: limit } : {}) })
  );

  let index = 0;
  for await (const row of parser) {
    const r = row as Record<string, string>;
    yield {
      articleId: String(index),
      title: (r.title ?? "").trim(),
      text: r.text ?? "",
      url: (r.url ?? "").trim(),
      authors: parseListLiteral(r.authors),
      timestamp: (r.timestamp ?? "").trim(),
      tags: parseListLiteral(r.tags),
    };
    index++;
  }
}
