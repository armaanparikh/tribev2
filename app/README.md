# Tribe Brain Activity Viewer

Upload a video → [TRIBE v2](../tribev2) predicts fMRI activity at 1-second
resolution across the fsaverage5 cortex → scrub the timeline to see the
predicted brain state at any moment.

```
app/
├── backend/   FastAPI: uploads, inference, serves mesh + GIFTI overlays (local/dev)
├── frontend/  Vite + React + Niivue: video player, scrubber, 3D brain (local/dev)
└── jobs/      uv script invoked by HF Jobs; used by both the local HF backend
              and the Vercel deployment
```

There are two supported ways to run this:

| Path | Lives in | When to use |
| ---- | -------- | ----------- |
| **Local dev** (FastAPI + Vite) | `app/` | You want to hack on the inference path, run against a local GPU, or use `TRIBE_BACKEND=hf` to test the HF Job plumbing. |
| **Production** (Next.js on Vercel) | `web/` | You want a public URL. Vercel handles uploads/UI, HF Jobs handles the GPU. See [../web/README.md](../web/README.md). |

## Prerequisites

- Python 3.11+ with `tribev2` installed (see repo root `pyproject.toml`).
- A GPU is strongly recommended. On CPU, a 1-minute clip takes ~tens of minutes.
- HuggingFace access to `meta-llama/Llama-3.2-3B`. Run `huggingface-cli login`.
- Node 20+ for the frontend.

## Install

```bash
# from repo root
pip install -e .                    # install tribev2
pip install -r app/requirements.txt # backend extras

cd app/frontend
npm install
```

## Run on a HuggingFace GPU (recommended)

No local GPU? Offload inference to HF Jobs. Each run spins up an `a10g-small`
GPU (~$0.60/hr, billed per second), runs TRIBE, and shuts down. Your local
UI just uploads the video and downloads the predictions.

```bash
pip install -r app/requirements.txt
hf auth login                       # token must be *write*
# grant your account access to meta-llama/Llama-3.2-3B

TRIBE_BACKEND=hf uvicorn app.backend.main:app --port 8000
cd app/frontend && npm run dev      # second terminal
```

Optional env vars:
- `TRIBE_DATASET` — scratch dataset repo slug (default `tribe-jobs`; becomes
  `{your_user}/tribe-jobs`, created private on first run).
- `TRIBE_FLAVOR` — hardware (`cpu-basic`, `t4-small`, `a10g-small`,
  `a100-large`, …). Default `a10g-small`.
- `TRIBE_JOB_TIMEOUT` — seconds before aborting. Default `3600`.

See [app/backend/hf_inference.py](backend/hf_inference.py) and
[app/jobs/tribe_predict.py](jobs/tribe_predict.py).

## Run locally (needs a local GPU to be usable)

Two terminals from the repo root:

```bash
# terminal 1 — backend
uvicorn app.backend.main:app --reload --port 8000
```

```bash
# terminal 2 — frontend
cd app/frontend
npm run dev
```

Open http://localhost:5173, drop a video, wait for inference to finish,
then scrub the timeline.

## How it works

1. `POST /api/jobs` with the video starts a background inference thread
   that calls [`TribeModel.get_events_dataframe`](../tribev2/demo_utils.py)
   and [`TribeModel.predict`](../tribev2/demo_utils.py), then saves
   `preds.npy` plus two 4D GIFTI overlays (one per hemisphere).
2. Niivue loads the fsaverage5 pial meshes (served from nilearn's cache)
   with the GIFTI overlay attached as layer 1.
3. Scrubbing the timeline updates `frame4D` on each mesh's overlay —
   no extra network traffic per frame.

## Deploy to Vercel

Production-style deploys live under [`../web/`](../web) (Next.js App
Router). That project re-uses this repo's `app/jobs/tribe_predict.py`
verbatim — the Next.js API routes launch it via the HF Jobs REST API,
and the same GIFTI overlays are written back to a private HF dataset
for the browser to stream.

```bash
cd web
cp .env.example .env.local
npm install
npm run dev        # http://localhost:3000
```

See [../web/README.md](../web/README.md) for the full env var list,
architecture diagram, and `vercel deploy` instructions. The FastAPI
backend under `app/backend/` is **not** part of the Vercel deployment
— it stays as a local-GPU developer path.

## Notes

- A 5 s hemodynamic lag is applied: at video time `t` you see the brain
  frame `floor(t − 5)`.
- Jobs and overlays are cached on disk in `app/_cache/{job_id}/` so
  reloading the page won't re-run inference.
