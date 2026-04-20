import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { ensureDataset, fileExists, runUvJob, writeMeta } from "@/lib/hf";
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

  // Verify the browser already pushed input.<ext> to the dataset. That
  // upload itself auto-creates the dataset if it didn't exist, but keep
  // ensureDataset as a cheap idempotent safety net.
  await ensureDataset();
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
    const launched = {
      ...base,
      status: "running" as const,
      message: `HF job ${hf.id} ${hf.status?.stage || "queued"}`,
      hfJobId: hf.id,
      hfStage: hf.status?.stage,
    };
    // Single commit per job — never written again after this point.
    // The poll route is read-only; the Python script batches its outputs
    // into one `upload_folder` commit.
    await writeMeta(launched);
    return NextResponse.json(launched);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const failed = {
      ...base,
      status: "error" as const,
      message: `launch failed: ${msg}`,
    };
    try {
      await writeMeta(failed);
    } catch {
      /* commit may fail (rate limit); returning the snapshot is enough */
    }
    return NextResponse.json(failed, { status: 500 });
  }
}
