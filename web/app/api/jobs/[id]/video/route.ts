import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getFileBlob } from "@/lib/hf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXT_TO_MIME: Record<string, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  m4v: "video/x-m4v",
};

const ALLOWED_EXTS = new Set(Object.keys(EXT_TO_MIME));

async function resolveExt(jobId: string): Promise<string | null> {
  // Fallback when the client didn't send ?ext=: ask HF for the tree of
  // this job's folder and pick the first input.<ext> we recognise.
  // Read-only — no commit cost.
  const e = env();
  try {
    const r = await fetch(
      `https://huggingface.co/api/datasets/${e.datasetRepo}/tree/main/${jobId}`,
      { headers: { Authorization: `Bearer ${e.hfToken}` } },
    );
    if (!r.ok) return null;
    const items = (await r.json()) as Array<{ type: string; path: string }>;
    for (const it of items) {
      if (it.type !== "file") continue;
      const m = /input\.([a-z0-9]+)$/i.exec(it.path);
      if (m && ALLOWED_EXTS.has(m[1].toLowerCase())) return m[1].toLowerCase();
    }
  } catch {
    /* fall through */
  }
  return null;
}

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  const jobId = params.id;
  if (!/^[a-f0-9]{8,32}$/i.test(jobId)) {
    return NextResponse.json({ error: "invalid jobId" }, { status: 400 });
  }

  const url = new URL(req.url);
  let ext = (url.searchParams.get("ext") || "").toLowerCase();
  if (!ALLOWED_EXTS.has(ext)) {
    ext = (await resolveExt(jobId)) || "";
  }
  if (!ALLOWED_EXTS.has(ext)) {
    return NextResponse.json({ error: "unknown ext" }, { status: 404 });
  }

  const blob = await getFileBlob(`${jobId}/input.${ext}`);
  if (!blob) {
    return NextResponse.json(
      { error: "video not found in dataset" },
      { status: 404 },
    );
  }
  return new Response(blob.stream(), {
    headers: {
      "content-type": EXT_TO_MIME[ext] || "application/octet-stream",
      "cache-control": "private, max-age=3600",
      "accept-ranges": "none",
    },
  });
}
