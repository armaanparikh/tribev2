"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Niivue } from "@niivue/niivue";
import type { JobMeta } from "@/lib/meta";

type Props = { job: JobMeta; onReset: () => void };

export function Viewer({ job, onReset }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nvRef = useRef<Niivue | null>(null);
  const [t, setT] = useState(0);
  const [, setPlaying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const nv = new Niivue({
        backColor: [0.04, 0.05, 0.06, 1],
        show3Dcrosshair: false,
        isColorbar: true,
      });
      await nv.attachToCanvas(canvasRef.current!);
      nv.setSliceType(nv.sliceTypeRender);
      nv.opts.isOrientCube = false;

      // Niivue fills in the remaining required NVMeshLayer fields from
      // NVMeshLayerDefaults at load time, so the loose shapes below are fine
      // at runtime; we widen them here to appease TS.
      const sulc = (url: string) => ({
        url,
        colormap: "gray",
        opacity: 0.7,
        cal_min: -1,
        cal_max: 1,
        colorbarVisible: false,
      });
      const overlay = (url: string) => ({
        url,
        colormap: "warm",
        opacity: 0.85,
        useNegativeCmap: true,
        cal_min: 0.5,
        cal_max: 3.0,
        frame4D: 0,
      });

      await nv.loadMeshes([
        {
          url: "/mesh/pial_left.gii.gz",
          name: "pial_left.gii.gz",
          rgba255: [220, 220, 220, 255],
          layers: [
            sulc("/mesh/sulc_left.gii.gz"),
            overlay(`/api/jobs/${job.id}/overlay/left`),
          ] as unknown as Parameters<Niivue["loadMeshes"]>[0][number]["layers"],
        },
        {
          url: "/mesh/pial_right.gii.gz",
          name: "pial_right.gii.gz",
          rgba255: [220, 220, 220, 255],
          layers: [
            sulc("/mesh/sulc_right.gii.gz"),
            overlay(`/api/jobs/${job.id}/overlay/right`),
          ] as unknown as Parameters<Niivue["loadMeshes"]>[0][number]["layers"],
        },
      ]);
      if (cancelled) return;
      nvRef.current = nv;
    })();
    return () => {
      cancelled = true;
    };
  }, [job.id]);

  useEffect(() => {
    const nv = nvRef.current;
    if (!nv || nv.meshes.length < 2) return;
    const idx = Math.max(
      0,
      Math.min(job.n_timesteps - 1, Math.floor(t - job.hemo_lag)),
    );
    for (const m of nv.meshes) {
      nv.setMeshLayerProperty(m.id, 1, "frame4D", idx);
    }
  }, [t, job.n_timesteps, job.hemo_lag]);

  function onTimeUpdate() {
    if (videoRef.current) setT(videoRef.current.currentTime);
  }

  const brainIdx = Math.max(0, Math.floor(t - job.hemo_lag));

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 12,
        height: "100%",
        padding: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          minHeight: 0,
        }}
      >
        <video
          ref={videoRef}
          src={`/api/jobs/${job.id}/video`}
          style={{
            width: "100%",
            background: "#000",
            flex: 1,
            minHeight: 0,
            objectFit: "contain",
          }}
          onTimeUpdate={onTimeUpdate}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onLoadedMetadata={() =>
            videoRef.current && setT(videoRef.current.currentTime)
          }
          controls
        />
        <Timeline
          t={t}
          duration={videoRef.current?.duration || job.duration}
          onSeek={(v) => {
            if (videoRef.current) videoRef.current.currentTime = v;
            setT(v);
          }}
        />
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            color: "#9aa0a6",
            fontSize: 13,
          }}
        >
          <span>stimulus t = {t.toFixed(2)}s</span>
          <span>
            brain @ t−{job.hemo_lag}s → frame {brainIdx} / {job.n_timesteps - 1}
          </span>
          <button onClick={onReset} style={btn}>
            New video
          </button>
        </div>
      </div>
      <div
        style={{ background: "#111418", borderRadius: 8, minHeight: 0 }}
      >
        <canvas
          ref={canvasRef}
          style={{ width: "100%", height: "100%", display: "block" }}
        />
      </div>
    </div>
  );
}

function Timeline({
  t,
  duration,
  onSeek,
}: {
  t: number;
  duration: number;
  onSeek: (v: number) => void;
}) {
  return (
    <input
      type="range"
      min={0}
      max={Math.max(duration, 0.1)}
      step={0.05}
      value={Math.min(t, duration || t)}
      onChange={(e) => onSeek(parseFloat(e.target.value))}
      style={{ width: "100%" }}
    />
  );
}

const btn: CSSProperties = {
  background: "#1b1f24",
  color: "#e8e8e8",
  border: "1px solid #2a2f36",
  padding: "4px 10px",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 13,
};
