import { NextResponse } from "next/server";
import { retrieve, dedupeByArticle, isMultiResultQuestion } from "@/lib/retrieval";
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
  const retrieved = await retrieve(trimmed);
  const context = isMultiResultQuestion(trimmed)
    ? dedupeByArticle(retrieved).slice(0, 3)
    : retrieved;

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
