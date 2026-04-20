"""Run TRIBE inference on a Hugging Face GPU Job (instead of locally).

Enable by setting `TRIBE_BACKEND=hf` in the uvicorn shell. Requires
`hf auth login` (token with read+write) and access to
meta-llama/Llama-3.2-3B.

The flow:
  1. Backend creates a private dataset {user}/tribe-jobs if it doesn't exist.
  2. Uploads the video to {job_id}/input.<ext>.
  3. Submits a run_uv_job with app/jobs/tribe_predict.py + flavor a10g-small.
  4. Polls inspect_job until the job terminates.
  5. Downloads preds.npy, writes GIFTI overlays locally.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from functools import lru_cache
from pathlib import Path

import numpy as np

from .cache import Job, update_job
from .mesh import write_overlay_gifti

log = logging.getLogger(__name__)

SCRIPT_PATH = Path(__file__).resolve().parents[1] / "jobs" / "tribe_predict.py"
DATASET_SLUG = os.environ.get("TRIBE_DATASET", "tribe-jobs")
FLAVOR = os.environ.get("TRIBE_FLAVOR", "a10g-large")
TIMEOUT_SEC = int(os.environ.get("TRIBE_JOB_TIMEOUT", "3600"))
POLL_SEC = 10


@lru_cache(maxsize=1)
def _dataset_repo() -> str:
    from huggingface_hub import HfApi

    api = HfApi()
    user = api.whoami()["name"]
    repo = f"{user}/{DATASET_SLUG}"
    api.create_repo(repo, repo_type="dataset", exist_ok=True, private=True)
    return repo


def _run(job: Job) -> None:
    from huggingface_hub import (
        HfApi,
        fetch_job_logs,
        get_token,
        hf_hub_download,
        inspect_job,
        run_uv_job,
    )

    token = os.environ.get("HF_TOKEN") or get_token()
    if not token:
        raise RuntimeError("no HF token; run `hf auth login` first")

    repo = _dataset_repo()
    api = HfApi(token=token)

    update_job(job, status="running", message="Uploading video to HF")
    api.upload_file(
        path_or_fileobj=str(job.video_path),
        path_in_repo=f"{job.id}/{job.video_path.name}",
        repo_id=repo,
        repo_type="dataset",
    )

    update_job(job, status="running", message=f"Launching GPU job on {FLAVOR}")
    hf_job = run_uv_job(
        script=str(SCRIPT_PATH),
        script_args=[repo, job.id],
        env={"HF_TOKEN": token},
        flavor=FLAVOR,
        timeout=f"{TIMEOUT_SEC}s",
    )
    update_job(job, status="running", message=f"Job {hf_job.id}: queued")

    started = time.time()
    last_stage = None
    while True:
        info = inspect_job(job_id=hf_job.id)
        stage = getattr(info.status, "stage", str(info.status))
        if stage != last_stage:
            update_job(job, message=f"Job {hf_job.id}: {stage}")
            last_stage = stage
        if stage in ("COMPLETED", "ERROR", "CANCELED", "DELETED"):
            break
        if time.time() - started > TIMEOUT_SEC:
            raise TimeoutError(f"HF job {hf_job.id} exceeded {TIMEOUT_SEC}s")
        time.sleep(POLL_SEC)

    if stage != "COMPLETED":
        tail = []
        try:
            for ln in fetch_job_logs(job_id=hf_job.id):
                tail.append(ln)
        except Exception:
            pass
        raise RuntimeError(
            f"HF job {hf_job.id} ended with {stage}. "
            f"Last logs: {''.join(tail[-20:])}"
        )

    update_job(job, status="running", message="Downloading predictions")
    preds_local = hf_hub_download(
        repo_id=repo,
        filename=f"{job.id}/preds.npy",
        repo_type="dataset",
        token=token,
    )
    meta_local = hf_hub_download(
        repo_id=repo,
        filename=f"{job.id}/preds_meta.json",
        repo_type="dataset",
        token=token,
    )
    preds = np.load(preds_local)
    import json as _json

    meta = _json.loads(Path(meta_local).read_text())

    update_job(job, status="running", message="Writing overlays")
    write_overlay_gifti(preds, job.overlay_lh_path, job.overlay_rh_path)
    np.save(job.preds_path, preds)

    update_job(
        job,
        status="done",
        message="",
        n_timesteps=int(meta["n_timesteps"]),
        duration=float(meta["duration"]),
        tr=float(meta["tr"]),
    )


def run_inference(job: Job) -> None:
    try:
        _run(job)
    except Exception as e:
        log.exception("hf inference failed")
        update_job(job, status="error", message=f"{type(e).__name__}: {e}")


def launch(job: Job) -> None:
    threading.Thread(target=run_inference, args=(job,), daemon=True).start()
