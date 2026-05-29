import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { getPinecone, getIndexName } from "../lib/pinecone";
import { models } from "../lib/config";

const CLOUD = "aws" as const;
const REGION = "us-east-1" as const;
const METRIC = "cosine" as const;

async function main() {
  const pc = getPinecone();
  const name = getIndexName();

  const list = await pc.listIndexes();
  const exists = list.indexes?.some((i) => i.name === name);

  if (!exists) {
    console.log(`Creating index "${name}": dim=${models.embeddingDimensions}, metric=${METRIC}, serverless ${CLOUD}/${REGION}...`);
    await pc.createIndex({
      name,
      dimension: models.embeddingDimensions,
      metric: METRIC,
      spec: { serverless: { cloud: CLOUD, region: REGION } },
      waitUntilReady: true,
    });
    console.log("Created.");
  } else {
    console.log(`Index "${name}" already exists; verifying config.`);
  }

  const desc = await pc.describeIndex(name);
  console.log("Index description:", {
    name: desc.name,
    dimension: desc.dimension,
    metric: desc.metric,
    spec: desc.spec,
    status: desc.status,
  });

  const stats = await pc.index(name).describeIndexStats();
  console.log("Index stats:", { totalRecordCount: stats.totalRecordCount, namespaces: stats.namespaces ?? {} });

  const ok = desc.dimension === models.embeddingDimensions && desc.metric === METRIC;
  console.log(`\nConfig matches required (dim ${models.embeddingDimensions}, metric ${METRIC}): ${ok}`);
}

main().catch((err) => {
  console.error("Pinecone setup failed:", err?.message ?? err);
  process.exit(1);
});
