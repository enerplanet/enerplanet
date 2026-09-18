---
audience: developer
---

# Storage footprint

Where EnerPlanET's disk space goes. All figures were measured on amd64 Linux from a clean clone unless stated otherwise, and will drift as repositories and base images grow.

## Summary

- A fresh checkout of all repositories is **8.1 GB**. `simulation-engine` and `enerplanet-pylovo` account for 94 per cent of it.
- The heat stack's eight container images need **about 8 GB** of disk (2.6 GB to download).
- Docker build cache comes on top of both and is not included in any figure on this page.

## Repositories

| Repository | On disk | of which `.git` |
|---|---|---|
| simulation-engine | 6.0 GB | 2.1 GB |
| enerplanet-pylovo | 1.6 GB | 759 MB |
| enerplanet (meta, `main`) | 242 MB | 87 MB |
| OpenTech-DB | 195 MB | 94 MB |
| ignis | 79 MB | 41 MB |
| city2tabula | 42 MB | 21 MB |
| buem-gateway | 13 MB | 12 MB |
| meme | 7.6 MB | 1.9 MB |
| weather | 5.9 MB | 2.1 MB |
| TentaCron | 5.0 MB | 2.5 MB |

All other repositories together total under 600 MB and are not worth optimising.

### simulation-engine

Almost all of the size is in `webservice.docker/servicehub/data/`: 3.3 GB in the working tree and 2.1 GB of Git LFS objects. The directory holds ten LFS files but only six distinct contents.

| Content hash | Size | Files |
|---|---|---|
| `913ce94699` | 441 MB | `AB.csv`, `MFH.csv`, `SFH.csv`, `TH.csv` |
| `ad0ec373a0` | 440 MB | `Commercial.csv`, `Public.csv` |
| `f39abfbc6a` | 441 MB | `Agricultural.csv` |
| `dff40740ac` | 441 MB | `Industrial.csv` |
| `c1a7dc1cac` | 11 KB | `charging/durations.csv` |
| `7b270dff7c` | 2.1 KB | `charging/coefs.csv` |

Each large file is an hourly time series from 2015-01-01 to 2025-12-31 (96,433 rows by 325 columns) stored as decimal text. About **1.55 GB of the checkout is duplicate copies**.

!!! warning "Identical files for different building types"
    `AB.csv`, `MFH.csv`, `SFH.csv` and `TH.csv` are byte-identical, as are `Commercial.csv` and `Public.csv`. If the per-type distinction is meant to be real, the data is wrong. If it is not, the separate files are unnecessary. Resolve this before optimising storage.

#### Reduction options

Measured on one file.

| Option | 3.3 GB becomes | Cost |
|---|---|---|
| Remove duplicate copies | ~1.76 GB | None, files are byte-identical |
| gzip | ~1.3 GB | Readers must handle `.gz` |
| zstd -19 | ~1.0 GB | Readers must handle `.zst` |
| float32 binary or Parquet | ~250 to 500 MB | Consuming code must change |
| Download at image build time | 0 in the clone | Needs a place to host the data |

The text format is the main cost. Compression only achieves 2.5x (gzip) to 3.2x (zstd), whereas the same values as float32 take 125 MB instead of 441 MB. Pruning LFS history recovers little, because LFS already stores each unique object once.

### enerplanet-pylovo

| File | Size |
|---|---|
| `raw_data/germany/postcode_germany.csv` | 209 MB |
| `raw_data/pylovo_db_full.sql.gz` | 136 MB |
| `initial-data/bremen.sql.gz` | 136 MB |
| `raw_data/postcode.csv` | 56 MB |
| `raw_data/netherlands/postcode_netherlands.csv` | 31 MB |
| `raw_data/transformer_data/` (GeoJSON) | 79 MB |

95 LFS files with 93 distinct contents, so there is no meaningful duplication. The database dumps and postcode tables are the only candidates for reduction.

## Container images

The heat stack's eight images:

| Image | Download | On disk |
|---|---|---|
| `enerplanet/weather` | 1.1 GB | 4.94 GB |
| `enerplanet/buem-model` | 938 MB | 4.14 GB |
| `enerplanet/buem-gateway` | 221 MB | 1.03 GB |
| `postgis/postgis:16-3.4` | 203 MB | 853 MB |
| `thd-spatial-ai/city2tabula-server` | 174 MB | 680 MB |
| `postgres:17-alpine` | 112 MB | 424 MB |
| `thd-spatial-ai/ignis-build-db` | 58 MB | 202 MB |
| `thd-spatial-ai/ignis` | 48 MB | 195 MB |
| **Total, shared layers counted once** | **2.6 GB** | **~8 GB** |

Download size is what crosses the network. Disk size is what Docker extracts, and is about four times larger because conda environments contain hundreds of thousands of small files, each taking a full filesystem block. **Use the disk column for budgeting.**

`weather` and `buem-model` share almost all their layers (`buem-model` adds only 18 MB), so together they cost about 4.9 GB, not 9 GB.

!!! warning "A build context is the working tree, not the tracked files"
    `COPY . .` copies untracked directories too, so output a tool writes beside its own source lands in the image, and a following `chown -R` stores a second copy of it. An image built that way measures the machine that built it rather than the commit, and two people building one commit get different sizes with no signal that it happened. City2TABULA excludes `validation/` and uses `COPY --chown` for this reason: its development image is 843 MB of content and 3.42 GB extracted, from a 19.2 MB context, whatever the builder has accumulated locally.

## Build cache

`make setup` builds several images from source and leaves build cache behind. It grows until pruned with `docker builder prune` and is not included in any figure above, so leave headroom for it when sizing a disk.