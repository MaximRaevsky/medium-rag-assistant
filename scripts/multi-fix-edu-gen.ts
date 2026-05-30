import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import OpenAI from "openai";
import { models } from "../lib/config";
import { retrieveMulti, buildRetrievalQuery } from "../lib/retrieval";
import { SYSTEM_PROMPT, buildUserPrompt } from "../lib/prompt";
import { getNamespace } from "../lib/pinecone";

/**
 * Minimal post-fix generation check for the exact required education multi-result
 * query, default vs reasoning_effort:"minimal". Uses the PRODUCTION retrieval path
 * (retrieveMulti) and the ORIGINAL question in the prompt. Local client so
 * lib/llmod.ts is untouched. PAID: 1 embedding + 2 gpt-5-mini calls.
 */
const QUESTION = "List exactly 3 articles about education. Return only the titles.";
const MODES = [
  { name: "default", params: {} as Record<string, unknown> },
  { name: "minimal", params: { reasoning_effort: "minimal" } as Record<string, unknown> },
];

function client(): OpenAI {
  const apiKey = process.env.LLMOD_API_KEY!;
  const baseURL = process.env.LLMOD_BASE_URL!;
  return new OpenAI({ apiKey, baseURL, defaultHeaders: { "x-litellm-api-key": apiKey } });
}

async function main() {
  const ns = getNamespace();
  console.log(`multi-fix-edu-gen | namespace=${ns}`);
  if (ns !== "final") console.log(`WARNING: namespace is "${ns}", not "final".`);

  const distinct = await retrieveMulti(QUESTION); // 1 embedding
  const context = distinct.slice(0, 3);
  console.log(`derived retrieval query: "${buildRetrievalQuery(QUESTION)}"`);
  console.log("context (top 3 distinct):");
  context.forEach((c, i) => console.log(`  #${i + 1} id=${c.article_id} score=${c.score.toFixed(4)} "${c.title}"`));

  const user = buildUserPrompt(QUESTION, context); // ORIGINAL question

  for (const m of MODES) {
    const t0 = Date.now();
    const res = await client().chat.completions.create({
      model: models.chat,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: user },
      ],
      ...m.params,
    } as Parameters<OpenAI["chat"]["completions"]["create"]>[0]);
    const ms = Date.now() - t0;
    const r = res as {
      choices: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const text = r.choices[0]?.message?.content ?? "";
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const distinctLines = new Set(lines.map((l) => l.toLowerCase()));
    const authorLike = /\bby\b|—\s*\w+\s+\w+$/i.test(text);
    const usage = r.usage
      ? `prompt=${r.usage.prompt_tokens} completion=${r.usage.completion_tokens} total=${r.usage.total_tokens}`
      : "usage n/a";

    console.log(`\n======== mode=${m.name} | latency ${(ms / 1000).toFixed(1)}s | ${usage} ========`);
    console.log(`exactly 3 distinct lines: ${lines.length === 3 && distinctLines.size === 3} (lines=${lines.length} distinct=${distinctLines.size})`);
    console.log(`author/prose present: ${authorLike}`);
    console.log(`response:\n${text}`);
  }
  console.log("\nNote: confirm all 3 titles are genuinely education-related against the context titles above.");
}

main().catch((err) => {
  console.error("multi-fix-edu-gen failed:", err?.message ?? err);
  process.exit(1);
});
