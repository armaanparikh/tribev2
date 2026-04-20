import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";

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

  // No HF commits here. The browser uploads input.<ext> directly to the
  // dataset (that's 1 commit). meta.json is written later by /api/jobs
  // after the HF Job is launched. This keeps us well under HF's
  // 128 commits/hour rate limit per repo.
  return NextResponse.json({
    jobId,
    repo: e.datasetRepo,
    path: `${jobId}/input.${ext}`,
    token: e.hfToken,
  });
}
