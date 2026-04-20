import { NextResponse } from "next/server";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lists top-level directories in the HF dataset. Each directory is a jobId.
export async function GET() {
  const e = env();
  const url = `https://huggingface.co/api/datasets/${e.datasetRepo}/tree/main`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${e.hfToken}` },
  });
  if (!r.ok) {
    return NextResponse.json(
      { error: `tree ${r.status}`, body: await r.text() },
      { status: r.status },
    );
  }
  const items = (await r.json()) as Array<{
    type: string;
    path: string;
    oid?: string;
  }>;
  const jobs = items
    .filter((i) => i.type === "directory")
    .map((i) => i.path)
    .sort()
    .reverse()
    .slice(0, 30);
  return NextResponse.json({ jobs });
}
