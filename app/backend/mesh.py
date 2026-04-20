"""Serve the fsaverage5 cortical surface and write per-vertex overlays as GIFTI.

Niivue loads meshes + per-vertex scalar layers from URLs. We reuse the same
fsaverage5 pial surfaces that tribev2's plotting code pulls via nilearn
(see tribev2/plotting/base.py), and write the TRIBE predictions as a
4D GIFTI scalar array per hemisphere so the frontend can switch frames
with setMeshLayerProperty("frame4D", t).
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import nibabel as nib
import numpy as np
from nilearn.datasets import fetch_surf_fsaverage

N_VERTS_PER_HEMI = 10242  # fsaverage5


@lru_cache(maxsize=1)
def _fs() -> dict:
    return fetch_surf_fsaverage(mesh="fsaverage5")


def pial_path(hemi: str) -> Path:
    assert hemi in ("left", "right")
    return Path(_fs()[f"pial_{hemi}"])


def sulc_path(hemi: str) -> Path:
    assert hemi in ("left", "right")
    return Path(_fs()[f"sulc_{hemi}"])


def write_overlay_gifti(preds: np.ndarray, out_lh: Path, out_rh: Path) -> None:
    """Write per-hemi 4D GIFTI overlays.

    preds: (T, 2 * N_VERTS_PER_HEMI) float array, left hemi first then right.
    Each output GIFTI contains T DataArrays of length N_VERTS_PER_HEMI.
    """
    if preds.ndim != 2 or preds.shape[1] != 2 * N_VERTS_PER_HEMI:
        raise ValueError(
            f"expected preds shape (T, {2 * N_VERTS_PER_HEMI}), got {preds.shape}"
        )
    preds = preds.astype(np.float32)
    lh = preds[:, :N_VERTS_PER_HEMI]
    rh = preds[:, N_VERTS_PER_HEMI:]
    _write_gifti_4d(lh, out_lh)
    _write_gifti_4d(rh, out_rh)


def _write_gifti_4d(arr: np.ndarray, path: Path) -> None:
    """Write one GIFTI with T DataArrays (one per timepoint)."""
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
