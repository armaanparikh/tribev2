import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { ensureDataset, writeMeta } from "@/lib/hf";
import { newMeta } from "@/lib/meta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_EXTS = new Set(["mp4", "mov", "webm", "mkv", "avi", "m4v"]);

interface Body {
  videoName?: string;
  ext?: string;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid json body" }, { status: 400 });
  }
  const videoName = (body.videoName || "").trim() || "input.mp4";
  const ext = (body.ext || videoName.split(".").pop() || "mp4")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (!ALLOWED_EXTS.has(ext)) {
    return NextResponse.json(
      { error: `unsupported ext: ${ext}` },
      { status: 400 },
    );
  }

  const jobId = randomUUID().replace(/-/g, "").slice(0, 12);
  const e = env();
  try {
    await ensureDataset();
    await writeMeta(newMeta(jobId, videoName, ext));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `hf setup failed: ${msg}` },
      { status: 500 },
    );
  }

  // Direct-to-HF upload: the browser sends the video straight to
  // huggingface.co, bypassing Vercel's 4.5 MB body cap. We ship the
  // HF token here — it MUST be narrowly scoped (write to the dataset
  // only) since any visitor can read it by calling this endpoint.
  return NextResponse.json({
    jobId,
    repo: e.datasetRepo,
    path: `${jobId}/input.${ext}`,
    token: e.hfToken,
  });
}
