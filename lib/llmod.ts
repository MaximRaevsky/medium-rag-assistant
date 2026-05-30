import OpenAI from "openai";
import { models } from "./config";

/**
 * LLMod is a LiteLLM (OpenAI-format) proxy. We talk to it with the OpenAI client
 * pointed at LLMOD_BASE_URL. Credentials come only from the environment.
 */
function getClient(): OpenAI {
  const apiKey = process.env.LLMOD_API_KEY;
  const baseURL = process.env.LLMOD_BASE_URL;
  if (!apiKey) throw new Error("LLMOD_API_KEY is not set");
  if (!baseURL) throw new Error("LLMOD_BASE_URL is not set");
  // Authorization: Bearer is sent by the SDK; x-litellm-api-key is the documented header.
  return new OpenAI({ apiKey, baseURL, defaultHeaders: { "x-litellm-api-key": apiKey } });
}

/** Embed a batch of strings; preserves input order. */
export async function embedTexts(inputs: string[]): Promise<number[][]> {
  const client = getClient();
  const res = await client.embeddings.create({
    model: models.embedding,
    input: inputs,
    dimensions: models.embeddingDimensions,
  });
  return res.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

/** Embed a single string and return its vector. */
export async function embedText(input: string): Promise<number[]> {
  const [vector] = await embedTexts([input]);
  return vector;
}

export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

export interface ChatOptions {
  /** When set, forwarded to the model as `reasoning_effort`. Omitted -> model default. */
  reasoningEffort?: ReasoningEffort;
}

/** Run a single chat completion with a system and user message. */
export async function chat(system: string, user: string, opts?: ChatOptions): Promise<string> {
  const client = getClient();
  const params = {
    model: models.chat,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    ...(opts?.reasoningEffort ? { reasoning_effort: opts.reasoningEffort } : {}),
  } as Parameters<OpenAI["chat"]["completions"]["create"]>[0];
  const res = (await client.chat.completions.create(params)) as OpenAI.Chat.Completions.ChatCompletion;
  return res.choices[0]?.message?.content ?? "";
}
