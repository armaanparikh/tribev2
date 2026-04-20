import { NextResponse } from "next/server";
import {
  fileExists,
  inspectJob,
  isTerminalStage,
  readJson,
  readMeta,
  writeMeta,
} from "@/lib/hf";
import type { JobMeta } from "@/lib/meta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PredsMeta {
  n_timesteps?: number;
  duration?: number;
  tr?: number;
  status?: string;
  message?: string;
  hemo_lag?: number;
}

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const jobId = params.id;
  if (!/^[a-f0-9]{8,32}$/i.test(jobId)) {
    return NextResponse.json({ error: "invalid jobId" }, { status: 400 });
  }
  const meta = await readMeta(jobId);
  if (!meta) {
    return NextResponse.json({ error: "unknown jobId" }, { status: 404 });
  }

  if (meta.status === "done" || meta.status === "error") {
    return NextResponse.json(meta);
  }

  let updated: JobMeta = { ...meta };

  // The HF Jobs REST API is unreliable for detecting completion — jobs
  // sometimes stay reported as "SCHEDULING" even after they exit. The
  // dataset is the real source of truth: if `preds_meta.json` and the
  // overlay files landed there, the job succeeded.
  const overlayLhPath = `${jobId}/overlay_lh.gii`;
  const overlayRhPath = `${jobId}/overlay_rh.gii`;
  const finished = await readJson<PredsMeta>(`${jobId}/preds_meta.json`);
  if (finished) {
    const [lh, rh] = await Promise.all([
      fileExists(overlayLhPath),
      fileExists(overlayRhPath),
    ]);
    if (lh && rh) {
      updated = {
        ...updated,
        status: "done",
        message: "",
        n_timesteps:
          typeof finished.n_timesteps === "number"
            ? finished.n_timesteps
            : updated.n_timesteps,
        duration:
          typeof finished.duration === "number"
            ? finished.duration
            : updated.duration,
        tr: typeof finished.tr === "number" ? finished.tr : updated.tr,
        hemo_lag:
          typeof finished.hemo_lag === "number"
            ? finished.hemo_lag
            : updated.hemo_lag,
      };
    } else {
      updated = {
        ...updated,
        status: "error",
        message:
          "Job wrote preds_meta.json but overlay GIFTI files are missing. Rerun with the latest tribe_predict.py.",
      };
    }
  } else if (meta.hfJobId) {
    // Still in-flight. Surface HF's stage just for messaging — do NOT
    // use it to gate completion.
    try {
      const hf = await inspectJob(meta.hfJobId);
      updated.hfStage = hf.status?.stage;
      updated.hfMessage = hf.status?.message ?? undefined;
      if (hf.status?.stage) {
        updated.message = `HF job ${hf.id} ${hf.status.stage}`;
      }
      if (
        hf.status?.stage &&
        isTerminalStage(hf.status.stage) &&
        hf.status.stage.toUpperCase() !== "COMPLETED"
      ) {
        updated = {
          ...updated,
          status: "error",
          message: `HF job ${hf.status.stage}${
            hf.status.message ? `: ${hf.status.message}` : ""
          }`,
        };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      updated.message = `inspect failed: ${msg}`;
    }
  } else if (await fileExists(`${jobId}/input.${meta.videoExt}`)) {
    updated.message = "Video uploaded; awaiting launch";
  }

  if (JSON.stringify(updated) !== JSON.stringify(meta)) {
    try {
      await writeMeta(updated);
    } catch {
      // Status snapshot is ephemeral; return it even if writeback fails.
    }
  }
  return NextResponse.json(updated);
}
