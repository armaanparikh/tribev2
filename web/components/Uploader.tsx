"use client";

import { useEffect, useRef, useState } from "react";
import type { JobMeta } from "@/lib/meta";

type Props = { job: JobMeta | null; onJob: (j: JobMeta) => void };

export function Uploader({ job, onJob }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string>("");
  const [phase, setPhase] = useState<string>("");

  useEffect(() => {
    if (!job || job.status === "done" || job.status === "error") return;
    const id = setInterval(async () => {
      try {
        const r = await fetch(`/api/jobs/${job.id}`);
        if (r.ok) onJob(await r.json());
      } catch {
        /* transient; keep polling */
      }
    }, 2500);
    return () => clearInterval(id);
  }, [job, onJob]);

  async function upload(file: File) {
    setErr("");
    try {
      setPhase("Creating job");
      const ext = (file.name.split(".").pop() || "mp4").toLowerCase();
      const u = await fetch("/api/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoName: file.name, ext }),
      });
      if (!u.ok) throw new Error(`upload-url: ${u.status}`);
      const { jobId, repo, path, token } = (await u.json()) as {
        jobId: string;
        repo: string;
        path: string;
        token: string;
      };

      // Upload straight to HuggingFace from the browser. Avoids the
      // Vercel 4.5 MB request-body cap entirely. Dynamic import keeps
      // @huggingface/hub out of the SSR graph (its Node entry breaks
      // Next's static prerender pass).
      setPhase(`Uploading ${file.name} (${(file.size / 1e6).toFixed(1)} MB)`);
      const { uploadFile } = await import("@huggingface/hub");
      await uploadFile({
        accessToken: token,
        repo: { type: "dataset", name: repo },
        file: { path, content: file },
        commitTitle: `upload video for ${jobId}`,
      });

      setPhase("Launching HuggingFace GPU job");
      const j = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, videoName: file.name, ext }),
      });
      if (!j.ok) throw new Error(`jobs: ${j.status}`);
      onJob(await j.json());
      setPhase("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      setPhase("");
    }
  }

  return (
    <div
      style={{
        display: "grid",
        placeItems: "center",
        height: "100%",
        padding: 32,
      }}
    >
      <div style={{ width: 480, textAlign: "center" }}>
        <h2 style={{ marginTop: 0 }}>Upload a video</h2>
        <p style={{ color: "#9aa0a6" }}>
          TRIBE v2 will predict brain activity at 1-second resolution across
          the cortex. Inference runs on a HuggingFace GPU and takes a few
          minutes per minute of video.
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
              <div style={{ color: "#9aa0a6", marginTop: 6 }}>
                {job.message}
                {job.hfStage ? ` · HF ${job.hfStage}` : ""}
              </div>
            </>
          ) : phase ? (
            <div style={{ color: "#9aa0a6" }}>{phase}</div>
          ) : (
            <div>
              Drop video here or click to choose
              <br />
              <small style={{ color: "#9aa0a6" }}>
                .mp4 .mov .webm .mkv .avi
              </small>
            </div>
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
        {err && (
          <div style={{ color: "#ff6b6b", marginTop: 16 }}>{err}</div>
        )}
        {job?.status === "error" && (
          <div style={{ color: "#ff6b6b", marginTop: 16 }}>{job.message}</div>
        )}
      </div>
    </div>
  );
}
