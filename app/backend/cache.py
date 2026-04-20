from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field, asdict
from pathlib import Path
from threading import Lock

CACHE_ROOT = Path(__file__).resolve().parents[2] / "app" / "_cache"
CACHE_ROOT.mkdir(parents=True, exist_ok=True)


@dataclass
class Job:
    id: str
    status: str = "pending"
    message: str = ""
    n_timesteps: int = 0
    duration: float = 0.0
    tr: float = 1.0
    hemo_lag: float = 5.0
    video_name: str = ""

    @property
    def dir(self) -> Path:
        return CACHE_ROOT / self.id

    @property
    def video_path(self) -> Path:
        return self.dir / f"input{Path(self.video_name).suffix or '.mp4'}"

    @property
    def preds_path(self) -> Path:
        return self.dir / "preds.npy"

    @property
    def overlay_lh_path(self) -> Path:
        return self.dir / "overlay_lh.gii"

    @property
    def overlay_rh_path(self) -> Path:
        return self.dir / "overlay_rh.gii"

    @property
    def meta_path(self) -> Path:
        return self.dir / "meta.json"

    def save(self) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        self.meta_path.write_text(json.dumps(asdict(self), indent=2))


_lock = Lock()
_jobs: dict[str, Job] = {}


def create_job(video_name: str) -> Job:
    with _lock:
        job = Job(id=uuid.uuid4().hex[:12], video_name=video_name)
        job.dir.mkdir(parents=True, exist_ok=True)
        job.save()
        _jobs[job.id] = job
        return job


def get_job(job_id: str) -> Job | None:
    with _lock:
        if job_id in _jobs:
            return _jobs[job_id]
        meta = CACHE_ROOT / job_id / "meta.json"
        if meta.exists():
            job = Job(**json.loads(meta.read_text()))
            _jobs[job_id] = job
            return job
        return None


def update_job(job: Job, **changes) -> Job:
    with _lock:
        for k, v in changes.items():
            setattr(job, k, v)
        job.save()
        return job
