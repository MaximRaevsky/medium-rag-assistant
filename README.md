# Medium Article RAG Assistant

A retrieval-augmented generation (RAG) service that answers questions strictly from a dataset of Medium articles. It retrieves the most relevant passages from a vector database and asks an LLM to answer using only those passages. If the answer is not in the data, it returns a fixed fallback line.

- Live: https://medium-rag-assistant-umber.vercel.app
- Repo: https://github.com/MaximRaevsky/medium-rag-assistant

## Endpoints

### GET /api/stats

Returns the active RAG configuration:

```json
{"chunk_size":512,"overlap_ratio":0.1,"top_k":5}
```

### POST /api/prompt

Request:

```json
{"question":"..."}
```

Response:

```json
{
  "response": "string",
  "context": [
    {"article_id":"...","title":"...","chunk":"...","score":0.0}
  ],
  "Augmented_prompt": {"System":"...","User":"..."}
}
```

`context` items contain only `article_id`, `title`, `chunk`, and `score`. `Augmented_prompt` contains the exact `System` and `User` strings sent to the model.

## RAG configuration

- `chunk_size`: 512 tokens
- `overlap_ratio`: 0.1
- `top_k`: 5

## Models

Accessed through the LLMod (LiteLLM) proxy in the OpenAI format:

- Embeddings: `4UHRUIN-text-embedding-3-small` (1536 dimensions)
- Chat: `4UHRUIN-gpt-5-mini`

## Vector database (Pinecone)

- Index: `medium-rag`
- Dimension: 1536
- Metric: cosine
- Namespace: `final`
- Deletion protection: enabled

## How it works

1. Ingestion (one-time): the CSV is parsed, each article is split into ~512-token chunks (`cl100k_base`) with 10% overlap, and each chunk is embedded and upserted into Pinecone under namespace `final`. Vector ids are deterministic (`<article_id>#<chunk_index>`), so re-running is idempotent.
2. Query: the question is embedded, the `top_k` nearest chunks are retrieved, an augmented prompt is built from those passages, and the chat model answers using only that context. For questions not answerable from the retrieved context, the response starts with the fixed line `I don't know based on the provided Medium articles data.` and does not answer from outside the corpus.

## Multi-result (list) queries

For explicit list requests (for example, "List exactly 3 articles about education"), retrieval is adjusted so the result is a set of distinct articles rather than several chunks of the same one:

- the retrieval query is reduced to the topic (for example, "articles about education") instead of the instruction-heavy phrasing;
- a wider candidate pool (30) is fetched and deduplicated by `article_id`, then the top distinct articles are used.

Other query types are unchanged. List queries also run with minimal reasoning effort, which helped keep list responses concise and title-only in validation; all other query types use the default reasoning.

## Evaluation summary

Hyperparameters were selected with a controlled retrieval and generation evaluation over a labeled subset (`scripts/eval2-set.ts`, `scripts/eval2-retrieval.ts`, `scripts/eval2-generate.ts`). `chunk_size=512`, `overlap_ratio=0.1`, `top_k=5` performed best in our validation set while staying within the assignment limits (`chunk_size ≤ 1024`, `overlap_ratio ≤ 0.3`, `top_k ≤ 30`).

A final-corpus validation suite (`scripts/eval-final-set.ts`, `scripts/final-validate.ts`) covers all required query types: precise lookup, multi-result list, central-idea summary, recommendation with evidence, and fallback. The multi-result retrieval fix and its rationale are recorded in `scripts/multi-retrieval-diagnostic.ts`. The deployed endpoints were verified live against the same cases.

## Local development

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in the values.
3. `npm run dev`, then open http://localhost:3000

One-time data setup (requires the dataset CSV locally):

```bash
npx tsx scripts/setup-pinecone.ts   # create/verify the Pinecone index
npx tsx scripts/ingest.ts           # chunk, embed, and upsert into namespace "final"
```

The dataset CSV is only required for this one-time ingestion. Once Pinecone is populated, normal runtime (the dev server and both endpoints) needs only the environment variables above.

### Environment variables

| Variable | Description |
| --- | --- |
| `LLMOD_API_KEY` | LLMod proxy API key |
| `LLMOD_BASE_URL` | LLMod base URL (`https://api.llmod.ai/v1`) |
| `PINECONE_API_KEY` | Pinecone API key |
| `PINECONE_INDEX` | Pinecone index name (`medium-rag`) |
| `PINECONE_NAMESPACE` | Namespace to query (`final`) |

Secrets live only in `.env.local` (git-ignored) and in the Vercel project settings; the dataset CSV is not committed.

## UI

The root page is a minimal client over `POST /api/prompt`: a question box, the answer, and the retrieved context (title, score, and a short excerpt). It is a convenience layer and does not change the API contract.
