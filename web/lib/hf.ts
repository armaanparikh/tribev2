import {
  createRepo,
  downloadFile,
  uploadFile,
} from "@huggingface/hub";
import type { RepoDesignation } from "@huggingface/hub";
import { env } from "./env";
import { JobMeta } from "./meta";

const HF_ENDPOINT = "https://huggingface.co";

function datasetRepo(): RepoDesignation {
  return { type: "dataset", name: env().datasetRepo };
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${env().hfToken}` };
}

/** Create the private scratch dataset if it doesn't yet exist. Idempotent. */
export async function ensureDataset(): Promise<void> {
  const { hfToken, datasetRepo: name } = env();
  try {
    await createRepo({
      accessToken: hfToken,
      repo: { type: "dataset", name },
      private: true,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/already (created|exists)|You already/.test(msg)) return;
    throw e;
  }
}

/** Upload a file (as a Blob) into {jobId}/{filename} of the dataset. */
export async function putFile(
  path: string,
  blob: Blob,
  commitTitle?: string,
): Promise<void> {
  const { hfToken } = env();
  await uploadFile({
    accessToken: hfToken,
    repo: datasetRepo(),
    file: { path, content: blob },
    commitTitle,
  });
}

export async function putJson(
  path: string,
  data: unknown,
  commitTitle?: string,
): Promise<void> {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  await putFile(path, blob, commitTitle);
}

/** Return a Blob for a file in the dataset, or null if 404. */
export async function getFileBlob(path: string): Promise<Blob | null> {
  return downloadFile({
    accessToken: env().hfToken,
    repo: datasetRepo(),
    path,
  });
}

export async function fileExists(path: string): Promise<boolean> {
  const b = await getFileBlob(path);
  return b !== null;
}

export async function readJson<T = unknown>(path: string): Promise<T | null> {
  const blob = await getFileBlob(path);
  if (!blob) return null;
  const txt = await blob.text();
  try {
    return JSON.parse(txt) as T;
  } catch {
    return null;
  }
}

export async function writeMeta(meta: JobMeta): Promise<void> {
  const updated = { ...meta, updatedAt: new Date().toISOString() };
  await putJson(`${meta.id}/meta.json`, updated, `update ${meta.id} meta`);
}

export async function readMeta(id: string): Promise<JobMeta | null> {
  return readJson<JobMeta>(`${id}/meta.json`);
}

/* ------------------------------- HF Jobs API ------------------------------ */

export interface HfJobInfo {
  id: string;
  status: { stage: string; message?: string | null };
  dockerImage?: string;
  command?: string[];
}

export async function runUvJob(args: {
  scriptUrl: string;
  scriptArgs: string[];
  flavor: string;
  timeoutSec: number;
  env?: Record<string, string>;
  secrets?: Record<string, string>;
}): Promise<HfJobInfo> {
  const {
    hfToken,
    namespace,
    flavor: defaultFlavor,
    timeoutSec: defaultTimeout,
  } = env();
  const body = {
    dockerImage: "ghcr.io/astral-sh/uv:python3.12-bookworm",
    command: ["uv", "run", args.scriptUrl, ...args.scriptArgs],
    arguments: [],
    environment: args.env ?? {},
    secrets: args.secrets ?? {},
    flavor: args.flavor ?? defaultFlavor,
    timeoutSeconds: args.timeoutSec ?? defaultTimeout,
  };

  const res = await fetch(`${HF_ENDPOINT}/api/jobs/${namespace}`, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`HF Jobs create failed: ${res.status} ${t}`);
  }
  const json = (await res.json()) as HfJobInfo;
  if (!hfToken) throw new Error("missing token after create"); // narrow for TS
  return json;
}

export async function inspectJob(jobId: string): Promise<HfJobInfo> {
  const { namespace } = env();
  const res = await fetch(`${HF_ENDPOINT}/api/jobs/${namespace}/${jobId}`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`HF Jobs inspect failed: ${res.status} ${t}`);
  }
  return (await res.json()) as HfJobInfo;
}

const TERMINAL_STAGES = new Set([
  "COMPLETED",
  "ERROR",
  "CANCELED",
  "DELETED",
]);

export function isTerminalStage(stage: string | undefined): boolean {
  if (!stage) return false;
  return TERMINAL_STAGES.has(stage.toUpperCase());
}
