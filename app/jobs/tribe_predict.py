# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "tribev2 @ git+https://github.com/facebookresearch/tribev2.git",
#   "huggingface_hub[hf_xet]",
#   "imageio-ffmpeg",
#   "numpy",
# ]
# ///
"""Run TRIBE v2 inference on a GPU Hugging Face Job.

Invoked by app/backend/hf_inference.py via `run_uv_job`. Expects the video
to already be uploaded to a dataset repo at `{job_id}/input.mp4`.

Writes:
  {job_id}/preds.npy       float32, shape (T, 20484)
  {job_id}/preds_meta.json {n_timesteps, duration, tr}

Args (positional):
  1. dataset_repo  e.g. "alice/tribe-jobs"
  2. job_id        hex string identifying the job folder

Env:
  HF_TOKEN must grant access to meta-llama/Llama-3.2-3B.
"""
from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

import numpy as np

DATASET_REPO = sys.argv[1]
JOB_ID = sys.argv[2]


def _find_video(local_dir: Path) -> Path:
    for ext in (".mp4", ".mov", ".webm", ".mkv", ".avi"):
        p = local_dir / f"input{ext}"
        if p.exists():
            return p
    raise FileNotFoundError(f"no input video in {local_dir}")


def _ensure_ffmpeg() -> None:
    """Symlink the imageio-ffmpeg static binary to /usr/local/bin/ffmpeg
    so whisperx's `subprocess.run(['ffmpeg', ...])` finds it.
    """
    if shutil.which("ffmpeg"):
        return
    import imageio_ffmpeg

    exe = imageio_ffmpeg.get_ffmpeg_exe()
    target = Path("/usr/local/bin/ffmpeg")
    try:
        if not target.exists():
            target.symlink_to(exe)
    except OSError:
        # fallback: prepend to PATH
        os.environ["PATH"] = f"{Path(exe).parent}:{os.environ.get('PATH', '')}"
    print(f"[tribe-job] ffmpeg: {shutil.which('ffmpeg')}", flush=True)


def main() -> None:
    _ensure_ffmpeg()
    from huggingface_hub import HfApi, snapshot_download

    token = os.environ.get("HF_TOKEN")
    api = HfApi(token=token)

    work = Path(tempfile.mkdtemp(prefix="tribe-"))
    print(f"[tribe-job] work dir: {work}", flush=True)

    # pull job folder from dataset (just the {job_id}/ subfolder)
    snapshot_download(
        repo_id=DATASET_REPO,
        repo_type="dataset",
        allow_patterns=[f"{JOB_ID}/input.*"],
        local_dir=str(work),
        token=token,
    )
    video_path = _find_video(work / JOB_ID)
    print(f"[tribe-job] video: {video_path}", flush=True)

    # run TRIBE
    from tribev2.demo_utils import TribeModel

    cache_folder = work / "model_cache"
    cache_folder.mkdir(parents=True, exist_ok=True)
    model = TribeModel.from_pretrained("facebook/tribev2", cache_folder=str(cache_folder))
    print("[tribe-job] model loaded, extracting events", flush=True)
    events = model.get_events_dataframe(video_path=str(video_path))
    print(f"[tribe-job] {len(events)} events, predicting", flush=True)
    preds, segments = model.predict(events=events)
    print(f"[tribe-job] preds shape: {preds.shape}", flush=True)

    out_dir = work / JOB_ID
    out_dir.mkdir(parents=True, exist_ok=True)
    preds_path = out_dir / "preds.npy"
    meta_path = out_dir / "preds_meta.json"
    np.save(preds_path, preds.astype(np.float32))
    def _end(s) -> float:
        start = getattr(s, "start", None)
        if start is None:
            start = getattr(s, "onset", 0.0)
        return float(start) + float(getattr(s, "duration", 0.0))

    meta = {
        "n_timesteps": int(preds.shape[0]),
        "duration": float(max((_end(s) for s in segments), default=0.0)),
        "tr": float(model.data.TR),
    }
    meta_path.write_text(json.dumps(meta))

    # upload results back to the same {job_id}/ folder
    for f in (preds_path, meta_path):
        api.upload_file(
            path_or_fileobj=str(f),
            path_in_repo=f"{JOB_ID}/{f.name}",
            repo_id=DATASET_REPO,
            repo_type="dataset",
        )
    print("[tribe-job] done", flush=True)
    shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()
