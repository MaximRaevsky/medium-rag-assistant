import { Pinecone } from "@pinecone-database/pinecone";

/** Build a Pinecone client from the environment. */
export function getPinecone(): Pinecone {
  const apiKey = process.env.PINECONE_API_KEY;
  if (!apiKey) throw new Error("PINECONE_API_KEY is not set");
  return new Pinecone({ apiKey });
}

export function getIndexName(): string {
  const name = process.env.PINECONE_INDEX;
  if (!name) throw new Error("PINECONE_INDEX is not set");
  return name;
}

/** Active namespace ("dev" for experiments, "final" for full ingestion). */
export function getNamespace(): string {
  return process.env.PINECONE_NAMESPACE || "dev";
}
