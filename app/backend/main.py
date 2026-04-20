"""FastAPI app: upload video, poll job, serve mesh + overlay for Niivue."""

from __future__ import annotations

import shutil
from dataclasses import asdict
from pathlib import Path

import os

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from . import cache, mesh

if os.environ.get("TRIBE_BACKEND", "local").lower() == "hf":
    from . import hf_inference as inference
else:
    from . import inference

app = FastAPI(title="Tribe Brain Activity Viewer")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/api/jobs")
async def create_job(video: UploadFile = File(...)) -> dict:
    if not video.filename:
        raise HTTPException(400, "no filename")
    job = cache.create_job(video.filename)
    with open(job.video_path, "wb") as f:
        shutil.copyfileobj(video.file, f)
    inference.launch(job)
    return asdict(job)


@app.get("/api/jobs/{job_id}")
def read_job(job_id: str) -> dict:
    job = cache.get_job(job_id)
    if job is None:
        raise HTTPException(404, "unknown job")
    return asdict(job)


@app.get("/api/jobs/{job_id}/video")
def get_video(job_id: str):
    job = cache.get_job(job_id)
    if job is None or not job.video_path.exists():
        raise HTTPException(404, "no video")
    return FileResponse(job.video_path, media_type="video/mp4")


@app.get("/api/jobs/{job_id}/overlay_{hemi}.gii")
def get_overlay(job_id: str, hemi: str):
    job = cache.get_job(job_id)
    if job is None:
        raise HTTPException(404, "unknown job")
    if hemi not in ("left", "right"):
        raise HTTPException(400, "hemi must be left or right")
    path = job.overlay_lh_path if hemi == "left" else job.overlay_rh_path
    if not path.exists():
        raise HTTPException(404, "overlay not ready")
    return FileResponse(path, media_type="application/octet-stream")


@app.get("/api/mesh/pial_{hemi}.gii.gz")
def get_mesh(hemi: str):
    if hemi not in ("left", "right"):
        raise HTTPException(400, "hemi must be left or right")
    return FileResponse(mesh.pial_path(hemi), media_type="application/octet-stream")


@app.get("/api/mesh/sulc_{hemi}.gii.gz")
def get_sulc(hemi: str):
    if hemi not in ("left", "right"):
        raise HTTPException(400, "hemi must be left or right")
    return FileResponse(mesh.sulc_path(hemi), media_type="application/octet-stream")


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}
