import { NextResponse } from "next/server";
import { retrieve, retrieveMulti, isMultiResultQuestion } from "@/lib/retrieval";
import { SYSTEM_PROMPT, buildUserPrompt } from "@/lib/prompt";
import { chat } from "@/lib/llmod";
import type { PromptResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// gpt-5-mini can take ~40s; allow headroom for the serverless function.
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const question = (body as { question?: unknown } | null)?.question;
  if (typeof question !== "string" || question.trim() === "") {
    return NextResponse.json(
      { error: "Field 'question' is required and must be a non-empty string." },
      { status: 400 }
    );
  }

  const trimmed = question.trim();
  // Multi-result/list queries use a topic-focused query + wide candidate pool +
  // dedupe (sliced to 3, no padding). All other queries keep the original
  // question and the configured top_k. The answer prompt always uses `trimmed`.
  const context = isMultiResultQuestion(trimmed)
    ? (await retrieveMulti(trimmed)).slice(0, 3)
    : await retrieve(trimmed);

  const system = SYSTEM_PROMPT;
  const user = buildUserPrompt(trimmed, context);
  const response = await chat(system, user);

  const payload: PromptResponse = {
    response,
    context: context.map((c) => ({
      article_id: c.article_id,
      title: c.title,
      chunk: c.chunk,
      score: c.score,
    })),
    Augmented_prompt: { System: system, User: user },
  };
  return NextResponse.json(payload);
}
