// Downloads fsaverage5 pial + sulc GIFTI files from the nilearn GitHub
// mirror and stores them under web/public/mesh/ so Vercel serves them
// statically. Skips the download if the files already exist.
//
// The files live at:
//   https://raw.githubusercontent.com/nilearn/nilearn/main/nilearn/datasets/data/fsaverage5/{pial,sulc}_{left,right}.gii.gz
//
// Env:
//   NILEARN_REF       git ref to pin (default "main")
//   MESH_SOURCE_DIR   if set, copies from this local directory instead of
//                     downloading (useful for offline builds / CI caches).

import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { copyFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");
const OUT_DIR = join(ROOT, "public", "mesh");
const REF = process.env.NILEARN_REF || "main";
const BASE = `https://raw.githubusercontent.com/nilearn/nilearn/${REF}/nilearn/datasets/data/fsaverage5`;

const FILES = [
  "pial_left.gii.gz",
  "pial_right.gii.gz",
  "sulc_left.gii.gz",
  "sulc_right.gii.gz",
];

async function ensureDir(p) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`fetch ${url}: ${res.status} ${res.statusText}`);
  }
  await pipeline(res.body, createWriteStream(dest));
}

async function main() {
  await ensureDir(OUT_DIR);
  const localSrc = process.env.MESH_SOURCE_DIR;

  for (const f of FILES) {
    const dest = join(OUT_DIR, f);
    if (existsSync(dest) && (await stat(dest)).size > 0) {
      console.log(`[mesh] already present: ${f}`);
      continue;
    }
    if (localSrc) {
      const src = join(localSrc, f);
      console.log(`[mesh] copy ${src} -> ${dest}`);
      await copyFile(src, dest);
    } else {
      const url = `${BASE}/${f}`;
      console.log(`[mesh] download ${url}`);
      await download(url, dest);
    }
  }
  console.log(`[mesh] done -> ${OUT_DIR}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
