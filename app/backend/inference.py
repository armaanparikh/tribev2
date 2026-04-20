"""Wraps TribeModel for the web app: one model instance, background jobs."""

from __future__ import annotations

import logging
import threading
from functools import lru_cache
from pathlib import Path

import numpy as np

from tribev2.demo_utils import TribeModel

from .cache import Job, update_job
from .mesh import write_overlay_gifti

log = logging.getLogger(__name__)

HF_REPO = "facebook/tribev2"
MODEL_CACHE = Path(__file__).resolve().parents[2] / "app" / "_model_cache"
MODEL_CACHE.mkdir(parents=True, exist_ok=True)


@lru_cache(maxsize=1)
def get_model() -> TribeModel:
    log.info("Loading TribeModel from %s", HF_REPO)
    return TribeModel.from_pretrained(HF_REPO, cache_folder=MODEL_CACHE)


def run_inference(job: Job) -> None:
    """Blocking; meant to run on a background thread."""
    try:
        update_job(job, status="running", message="Loading model")
        model = get_model()

        update_job(job, status="running", message="Extracting events")
        events = model.get_events_dataframe(video_path=str(job.video_path))

        update_job(job, status="running", message="Predicting brain activity")
        preds, segments = model.predict(events=events)

        np.save(job.preds_path, preds.astype(np.float32))

        update_job(job, status="running", message="Writing overlays")
        write_overlay_gifti(preds, job.overlay_lh_path, job.overlay_rh_path)

        duration = float(
            max((s.offset + s.duration) for s in segments) if segments else 0.0
        )
        update_job(
            job,
            status="done",
            message="",
            n_timesteps=int(preds.shape[0]),
            duration=duration,
            tr=float(model.data.TR),
        )
    except Exception as e:
        log.exception("inference failed")
        update_job(job, status="error", message=f"{type(e).__name__}: {e}")


def launch(job: Job) -> None:
    t = threading.Thread(target=run_inference, args=(job,), daemon=True)
    t.start()
