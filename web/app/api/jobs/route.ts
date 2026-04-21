import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { fileExists, runUvJob } from "@/lib/hf";
import { newMeta } from "@/lib/meta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_EXTS = new Set(["mp4", "mov", "webm", "mkv", "avi", "m4v"]);

interface Body {
  jobId?: string;
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
  const jobId = (body.jobId || "").trim();
  if (!/^[a-f0-9]{8,32}$/i.test(jobId)) {
    return NextResponse.json({ error: "invalid jobId" }, { status: 400 });
  }
  const videoName = (body.videoName || "").trim() || "input.mp4";
  const ext = (body.ext || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!ALLOWED_EXTS.has(ext)) {
    return NextResponse.json(
      { error: `unsupported ext: ${ext}` },
      { status: 400 },
    );
  }

  // Read-only check; scanning a file is an HTTP GET on the HF API and
  // does not count against the 128 commits/hour budget.
  if (!(await fileExists(`${jobId}/input.${ext}`))) {
    return NextResponse.json(
      { error: "video not uploaded yet" },
      { status: 409 },
    );
  }

  const e = env();
  const base = newMeta(jobId, videoName, ext);
  try {
    const hf = await runUvJob({
      scriptUrl: e.scriptUrl,
      scriptArgs: [e.datasetRepo, jobId],
      flavor: e.flavor,
      timeoutSec: e.timeoutSec,
      secrets: { HF_TOKEN: e.hfToken },
    });
    // No writeMeta here — meta is ephemeral and lives in the client.
    // Any state the poll route needs (hfJobId, ext) is passed by the
    // client via query string. This keeps server-side HF commits at 0.
    return NextResponse.json({
      ...base,
      status: "running" as const,
      message: `HF job ${hf.id} ${hf.status?.stage || "queued"}`,
      hfJobId: hf.id,
      hfStage: hf.status?.stage,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ...base, status: "error" as const, message: `launch failed: ${msg}` },
      { status: 500 },
    );
  }
}
