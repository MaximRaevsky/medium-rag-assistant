import type { RetrievedChunk } from "./retrieval";

/**
 * Mandatory system-prompt section, copied verbatim from the assignment PDF
 * (curly quotes/apostrophes preserved). Interpretation note: the fallback
 * sentence is treated as content; the surrounding quotation marks in the PDF
 * are not assumed to be part of the model's literal output.
 */
export const MANDATORY_SYSTEM_PROMPT =
  "You are a Medium-article assistant that answers questions strictly and only based on the Medium articles dataset context provided to you (metadata and article passages). You must not use any external knowledge, the open internet, or information that is not explicitly contained in the retrieved context. If the answer cannot be determined from the provided context, respond: \u201CI don\u2019t know based on the provided Medium articles data.\u201D Always explain your answer using the given context, quoting or paraphrasing the relevant article passage or metadata when helpful.";

/** Allowed clarification (style/listing). Does not weaken the mandatory constraints. */
const STYLE_CLARIFICATION =
  "\n\nResponse style: Be concise. When asked to list multiple distinct articles, list at most 3 distinct article titles. When asked for an article's title and author, include both when present in the context.";

/** Full system prompt sent to the chat model. */
export const SYSTEM_PROMPT = MANDATORY_SYSTEM_PROMPT + STYLE_CLARIFICATION;

/** Build the user prompt: retrieved context (with title/author metadata) + the question. */
export function buildUserPrompt(question: string, context: RetrievedChunk[]): string {
  const blocks = context.map((c, i) => {
    const authors = c.authors.length ? c.authors.join(", ") : "Unknown";
    return `[#${i + 1}] article_id=${c.article_id}\nTitle: ${c.title}\nAuthor(s): ${authors}\nPassage: ${c.chunk}`;
  });
  const contextText = blocks.length ? blocks.join("\n\n---\n\n") : "(no context retrieved)";
  return `Context (Medium articles):\n\n${contextText}\n\nQuestion: ${question}`;
}
