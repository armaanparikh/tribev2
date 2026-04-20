import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { fileExists, readMeta, runUvJob, writeMeta } from "@/lib/hf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  jobId?: string;
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

  const meta = await readMeta(jobId);
  if (!meta) {
    return NextResponse.json({ error: "unknown jobId" }, { status: 404 });
  }

  if (!(await fileExists(`${jobId}/input.${meta.videoExt}`))) {
    return NextResponse.json(
      { error: "video not uploaded yet" },
      { status: 409 },
    );
  }

  const e = env();
  try {
    const hf = await runUvJob({
      scriptUrl: e.scriptUrl,
      scriptArgs: [e.datasetRepo, jobId],
      flavor: e.flavor,
      timeoutSec: e.timeoutSec,
      secrets: { HF_TOKEN: e.hfToken },
    });
    const updated = {
      ...meta,
      status: "running" as const,
      message: `HF job ${hf.id} ${hf.status?.stage || "queued"}`,
      hfJobId: hf.id,
      hfStage: hf.status?.stage,
    };
    await writeMeta(updated);
    return NextResponse.json(updated);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const updated = {
      ...meta,
      status: "error" as const,
      message: `launch failed: ${msg}`,
    };
    await writeMeta(updated);
    return NextResponse.json(updated, { status: 500 });
  }
}
