import { NextResponse } from "next/server";
import { ragConfig } from "@/lib/config";
import type { StatsResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const body: StatsResponse = {
    chunk_size: ragConfig.chunkSize,
    overlap_ratio: ragConfig.overlapRatio,
    top_k: ragConfig.topK,
  };
  return NextResponse.json(body);
}
