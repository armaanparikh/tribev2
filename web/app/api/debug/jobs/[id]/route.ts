import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { readMeta } from "@/lib/hf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Temporary debug endpoint. Returns the raw HF inspect response and our
// stored meta side-by-side so we can see why the poller is stuck.
export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const jobId = params.id;
  const meta = await readMeta(jobId);
  if (!meta) {
    return NextResponse.json({ error: "unknown jobId", jobId }, { status: 404 });
  }

  const e = env();
  const out: Record<string, unknown> = { meta };
  if (meta.hfJobId) {
    const url = `https://huggingface.co/api/jobs/${e.namespace}/${meta.hfJobId}`;
    out.inspectUrl = url;
    try {
      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${e.hfToken}` },
      });
      out.inspectStatus = r.status;
      const text = await r.text();
      try {
        out.inspectBody = JSON.parse(text);
      } catch {
        out.inspectBody = text;
      }
    } catch (err) {
      out.inspectError = err instanceof Error ? err.message : String(err);
    }
  }

  // Also list top-level folders in the HF dataset so we can confirm where
  // this job landed and whether preds_meta.json exists.
  try {
    const treeUrl = `https://huggingface.co/api/datasets/${e.datasetRepo}/tree/main/${jobId}`;
    const r = await fetch(treeUrl, {
      headers: { Authorization: `Bearer ${e.hfToken}` },
    });
    out.treeStatus = r.status;
    out.treeBody = await r.json().catch(() => null);
  } catch (err) {
    out.treeError = err instanceof Error ? err.message : String(err);
  }

  return NextResponse.json(out, { status: 200 });
}
