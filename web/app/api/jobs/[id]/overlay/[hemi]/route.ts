import { NextResponse } from "next/server";
import { getFileBlob, readMeta } from "@/lib/hf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { id: string; hemi: string } },
) {
  const jobId = params.id;
  const hemi = params.hemi;
  if (!/^[a-f0-9]{8,32}$/i.test(jobId)) {
    return NextResponse.json({ error: "invalid jobId" }, { status: 400 });
  }
  if (hemi !== "left" && hemi !== "right") {
    return NextResponse.json(
      { error: "hemi must be left or right" },
      { status: 400 },
    );
  }
  const meta = await readMeta(jobId);
  if (!meta) {
    return NextResponse.json({ error: "unknown jobId" }, { status: 404 });
  }
  if (meta.status !== "done") {
    return NextResponse.json(
      { error: `overlay not ready (status=${meta.status})` },
      { status: 409 },
    );
  }

  const hemiShort = hemi === "left" ? "lh" : "rh";
  const path = `${jobId}/overlay_${hemiShort}.gii`;
  const blob = await getFileBlob(path);
  if (!blob) {
    return NextResponse.json(
      { error: "overlay not found in dataset" },
      { status: 404 },
    );
  }
  return new Response(blob.stream(), {
    headers: {
      "content-type": "application/octet-stream",
      "cache-control": "private, max-age=3600",
    },
  });
}
