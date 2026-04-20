# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "tribev2 @ git+https://github.com/armaanparikh/tribev2.git",
#   "huggingface_hub[hf_xet]",
#   "imageio-ffmpeg",
#   "nibabel",
#   "numpy",
# ]
# ///
"""Run TRIBE v2 inference on a GPU Hugging Face Job.

Invoked by the Vercel `/api/jobs` route via the HF Jobs API, or from
`app/backend/hf_inference.py` via `run_uv_job`. Expects the video to
already be uploaded to a dataset repo at `{job_id}/input.<ext>`.

Writes back to the same `{job_id}/` folder:
  preds.npy          float32, shape (T, 20484)
  overlay_lh.gii     4D GIFTI per-hemi overlay, T DataArrays of 10242 floats
  overlay_rh.gii
  preds_meta.json    {n_timesteps, duration, tr, hemo_lag, status, hf_job_id}

Args (positional):
  1. dataset_repo  e.g. "alice/tribe-jobs"
  2. job_id        hex string identifying the job folder

Env:
  HF_TOKEN must grant write access to the dataset and acceptance of the
  meta-llama/Llama-3.2-3B license.
"""
from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
import traceback
from pathlib import Path

import numpy as np

DATASET_REPO = sys.argv[1]
JOB_ID = sys.argv[2]

N_VERTS_PER_HEMI = 10242


def _find_video(local_dir: Path) -> Path:
    for ext in (".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v"):
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
        os.environ["PATH"] = f"{Path(exe).parent}:{os.environ.get('PATH', '')}"
    print(f"[tribe-job] ffmpeg: {shutil.which('ffmpeg')}", flush=True)


def _write_gifti_4d(arr: np.ndarray, path: Path) -> None:
    """Write one GIFTI with T DataArrays (one per timepoint)."""
    import nibabel as nib

    darrays = [
        nib.gifti.GiftiDataArray(
            data=arr[t],
            intent="NIFTI_INTENT_NONE",
            datatype="NIFTI_TYPE_FLOAT32",
        )
        for t in range(arr.shape[0])
    ]
    img = nib.gifti.GiftiImage(darrays=darrays)
    path.parent.mkdir(parents=True, exist_ok=True)
    nib.save(img, str(path))


def _write_overlays(preds: np.ndarray, out_lh: Path, out_rh: Path) -> None:
    if preds.ndim != 2 or preds.shape[1] != 2 * N_VERTS_PER_HEMI:
        raise ValueError(
            f"expected preds shape (T, {2 * N_VERTS_PER_HEMI}), got {preds.shape}"
        )
    arr = preds.astype(np.float32)
    _write_gifti_4d(arr[:, :N_VERTS_PER_HEMI], out_lh)
    _write_gifti_4d(arr[:, N_VERTS_PER_HEMI:], out_rh)


def main() -> None:
    _ensure_ffmpeg()
    from huggingface_hub import HfApi, snapshot_download

    token = os.environ.get("HF_TOKEN")
    api = HfApi(token=token)

    work = Path(tempfile.mkdtemp(prefix="tribe-"))
    print(f"[tribe-job] work dir: {work}", flush=True)

    try:
        snapshot_download(
            repo_id=DATASET_REPO,
            repo_type="dataset",
            allow_patterns=[f"{JOB_ID}/input.*"],
            local_dir=str(work),
            token=token,
        )
        video_path = _find_video(work / JOB_ID)
        print(f"[tribe-job] video: {video_path}", flush=True)

        from tribev2.demo_utils import TribeModel

        cache_folder = work / "model_cache"
        cache_folder.mkdir(parents=True, exist_ok=True)
        model = TribeModel.from_pretrained(
            "facebook/tribev2", cache_folder=str(cache_folder)
        )
        print("[tribe-job] model loaded, extracting events", flush=True)
        events = model.get_events_dataframe(video_path=str(video_path))
        print(f"[tribe-job] {len(events)} events, predicting", flush=True)
        preds, segments = model.predict(events=events)
        print(f"[tribe-job] preds shape: {preds.shape}", flush=True)

        out_dir = work / "out" / JOB_ID
        out_dir.mkdir(parents=True, exist_ok=True)
        preds_path = out_dir / "preds.npy"
        overlay_lh = out_dir / "overlay_lh.gii"
        overlay_rh = out_dir / "overlay_rh.gii"
        meta_path = out_dir / "preds_meta.json"

        preds_f32 = preds.astype(np.float32)
        np.save(preds_path, preds_f32)
        _write_overlays(preds_f32, overlay_lh, overlay_rh)

        def _end(s) -> float:
            start = getattr(s, "start", None)
            if start is None:
                start = getattr(s, "onset", 0.0)
            return float(start) + float(getattr(s, "duration", 0.0))

        preds_meta = {
            "n_timesteps": int(preds_f32.shape[0]),
            "duration": float(max((_end(s) for s in segments), default=0.0)),
            "tr": float(model.data.TR),
            "hemo_lag": 5.0,
            "status": "done",
        }
        meta_path.write_text(json.dumps(preds_meta, indent=2))

        # Single HF commit for all four result files. We intentionally
        # avoid per-file upload_file calls and intermediate meta.json
        # patches; HF caps dataset commits at 128/hour per repo and those
        # writes were burning the budget.
        api.upload_folder(
            folder_path=str(work / "out"),
            path_in_repo="",
            repo_id=DATASET_REPO,
            repo_type="dataset",
            commit_message=f"tribe predict {JOB_ID}",
        )
        print("[tribe-job] done", flush=True)
    except Exception as e:
        tb = traceback.format_exc()
        print(f"[tribe-job] ERROR: {e}\n{tb}", flush=True)
        raise
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()
