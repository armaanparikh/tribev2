# TRIBE Web (Next.js on Vercel + HF GPU Jobs)

Vercel-friendly port of `app/` that keeps **all TRIBE inference on a
HuggingFace GPU Job** and stores per-run artifacts in a private HF dataset.
No long-lived Python process, no server-side model weights, no stateful
disk.

## Architecture

```
Browser ──▶ /api/upload-url   → new jobId, writes meta.json, returns {repo,path,token}
Browser ──▶ huggingface.co    → uploads video direct (bypasses Vercel's 4.5 MB cap)
Browser ──▶ /api/jobs         → launches uv script on HF Jobs (GPU)
HF Job  ──▶ writes preds.npy, overlay_{lh,rh}.gii, preds_meta.json back
Browser polls /api/jobs/:id   → reads HF job stage + patched meta.json
Browser loads /api/jobs/:id/overlay/{left,right} and /video
Static  /mesh/*.gii.gz        → fsaverage5 pial + sulc, bundled at build time
```

## Required env vars

Set these in the Vercel dashboard (or `.env.local` for `vercel dev`):

| Name | Required | Default | Description |
| ---- | -------- | ------- | ----------- |
| `HF_TOKEN` | yes | — | Write-scoped HF token. Needs write on the dataset below, permission to create Jobs in `TRIBE_NAMESPACE`, and acceptance of the `meta-llama/Llama-3.2-3B` license. |
| `TRIBE_NAMESPACE` | yes | — | HF user/org the Job runs under (e.g. `armaanparikh`). |
| `TRIBE_DATASET` | no | `tribe-jobs` | Private scratch dataset slug under `TRIBE_NAMESPACE`. Auto-created on first job. |
| `TRIBE_FLAVOR` | no | `a10g-large` | HF Jobs hardware flavor. Run `hf jobs hardware list` for options. |
| `TRIBE_JOB_TIMEOUT` | no | `3600` | Max seconds per Job before HF cancels it. |
| `TRIBE_SCRIPT_URL` | no | main of this repo | Raw URL of `app/jobs/tribe_predict.py`. Useful if your fork lives elsewhere. |

## Local dev

```
cd web
cp .env.example .env.local
# fill in HF_TOKEN + TRIBE_NAMESPACE
npm install
npm run prebuild:mesh          # downloads fsaverage5 GIFTIs into public/mesh/
npm run dev
```

`npm run dev` starts the Next.js app on <http://localhost:3000>. All
`/api/*` calls hit HF in the real world — there is no local mock.

## Deploy to Vercel

```
cd web
vercel link
vercel env add HF_TOKEN          # production + preview
vercel env add TRIBE_NAMESPACE
vercel env add TRIBE_DATASET     # optional
vercel env add TRIBE_FLAVOR      # optional
vercel deploy --prod
```

`npm run build` runs the mesh prebuild automatically before
`next build`, so the fsaverage5 meshes land in `public/mesh/` and are
served by Vercel's CDN.

## Routes

| Route | Method | Purpose |
| ----- | ------ | ------- |
| `/api/upload-url` | POST | Mint a `jobId`, seed `meta.json`, return `{repo, path, token}` for a direct-to-HF upload. |
| `/api/jobs` | POST | Launch `tribe_predict.py` on HF Jobs as a uv script. |
| `/api/jobs/[id]` | GET | Merge HF `inspect_job` + dataset `meta.json`, return snapshot. |
| `/api/jobs/[id]/overlay/[hemi]` | GET | Proxy-stream `overlay_{lh,rh}.gii` from the dataset. |
| `/api/jobs/[id]/video` | GET | Proxy-stream the uploaded `input.<ext>` from the dataset. |

## Notes & limits

- **Upload size**: the browser uploads the video straight to
  `huggingface.co` using `@huggingface/hub`'s `uploadFile`, so Vercel's
  4.5 MB serverless body cap is never hit. Practical ceiling is the HF
  Hub per-file limit (~50 GB LFS), but keep videos small for reasonable
  GPU time.
- **Token hygiene**: `HF_TOKEN` is returned to the browser by
  `/api/upload-url`. Use a **fine-grained token** scoped to only
  `{TRIBE_NAMESPACE}/{TRIBE_DATASET}` write + Jobs in `TRIBE_NAMESPACE`.
  Everything else (`/api/jobs`, polling, overlay/video proxying) still
  happens server-side with the same token.
- **GPU cold start**: an `a10g-large` Job takes ~60-120 s to spin up
  before inference begins. The UI polls every 2.5 s and surfaces the HF
  stage verbatim.
- **Overlay size**: a 120 s video produces ~10 MB of GIFTI total; proxy
  streaming is fine well under the Vercel response cap.
