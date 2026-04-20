import { useEffect, useRef, useState } from "react";
import type { JobStatus } from "./App";

type Props = { job: JobStatus | null; onJob: (j: JobStatus) => void };

export function Uploader({ job, onJob }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string>("");

  useEffect(() => {
    if (!job || job.status === "done" || job.status === "error") return;
    const id = setInterval(async () => {
      const r = await fetch(`/api/jobs/${job.id}`);
      if (r.ok) onJob(await r.json());
    }, 1500);
    return () => clearInterval(id);
  }, [job, onJob]);

  async function upload(file: File) {
    setErr("");
    const fd = new FormData();
    fd.append("video", file);
    const r = await fetch("/api/jobs", { method: "POST", body: fd });
    if (!r.ok) {
      setErr(`upload failed: ${r.status}`);
      return;
    }
    onJob(await r.json());
  }

  return (
    <div style={{ display: "grid", placeItems: "center", height: "100%", padding: 32 }}>
      <div style={{ width: 480, textAlign: "center" }}>
        <h2 style={{ marginTop: 0 }}>Upload a video</h2>
        <p style={{ color: "#9aa0a6" }}>
          TRIBE v2 will predict brain activity at 1-second resolution across the
          cortex. Inference takes a few minutes per minute of video.
        </p>

        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) upload(f);
          }}
          onClick={() => inputRef.current?.click()}
          style={{
            border: "2px dashed #3a4049",
            borderRadius: 12,
            padding: 48,
            cursor: "pointer",
            marginTop: 24,
          }}
        >
          {job ? (
            <>
              <div style={{ fontWeight: 600 }}>
                {job.status === "running" ? "Running…" : job.status}
              </div>
              <div style={{ color: "#9aa0a6", marginTop: 6 }}>{job.message}</div>
            </>
          ) : (
            <div>Drop video here or click to choose<br /><small style={{ color: "#9aa0a6" }}>.mp4 .mov .webm .mkv .avi</small></div>
          )}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
          }}
        />
        {err && <div style={{ color: "#ff6b6b", marginTop: 16 }}>{err}</div>}
        {job?.status === "error" && (
          <div style={{ color: "#ff6b6b", marginTop: 16 }}>{job.message}</div>
        )}
      </div>
    </div>
  );
}
