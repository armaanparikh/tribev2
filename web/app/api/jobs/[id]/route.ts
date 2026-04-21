import { NextResponse } from "next/server";
import { fileExists, inspectJob, isTerminalStage, readJson } from "@/lib/hf";
import { newMeta } from "@/lib/meta";
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

// Poll is fully read-only. It reconstructs a JobMeta snapshot from:
//   - query params (hfJobId, ext, videoName) carried by the client
//   - existence of result files in the dataset (preds_meta.json + overlays)
//   - HF job inspect for mid-flight stage strings
// No dataset writes, so this never counts against HF's commit budget.
export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  const jobId = params.id;
  if (!/^[a-f0-9]{8,32}$/i.test(jobId)) {
    return NextResponse.json({ error: "invalid jobId" }, { status: 400 });
  }
  const url = new URL(req.url);
  const hfJobId = url.searchParams.get("hfJobId") || undefined;
  const ext = (url.searchParams.get("ext") || "").toLowerCase();
  const videoName = url.searchParams.get("videoName") || "input";

  const base = newMeta(jobId, videoName, ext);
  let updated: JobMeta = { ...base, hfJobId };

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
    return NextResponse.json(updated);
  }

  if (hfJobId) {
    try {
      const hf = await inspectJob(hfJobId);
      updated.hfStage = hf.status?.stage;
      updated.hfMessage = hf.status?.message ?? undefined;
      if (hf.status?.stage) {
        updated.status = "running";
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
  } else if (ext && (await fileExists(`${jobId}/input.${ext}`))) {
    updated.message = "Video uploaded; awaiting launch";
  }

  return NextResponse.json(updated);
}
