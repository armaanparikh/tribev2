import { NextResponse } from "next/server";
import { getFileBlob, readMeta } from "@/lib/hf";

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

  const path = `${jobId}/input.${meta.videoExt}`;
  const blob = await getFileBlob(path);
  if (!blob) {
    return NextResponse.json(
      { error: "video not found in dataset" },
      { status: 404 },
    );
  }
  const type = EXT_TO_MIME[meta.videoExt] || "application/octet-stream";
  return new Response(blob.stream(), {
    headers: {
      "content-type": type,
      "cache-control": "private, max-age=3600",
      "accept-ranges": "none",
    },
  });
}
