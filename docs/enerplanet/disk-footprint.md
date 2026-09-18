---
audience: developer
---

# Where the disk goes

Test Data budgets the disk a working setup needs. This page says what fills
it, measured rather than estimated, so the figures can be argued with and
reduced. Everything below was measured on amd64 Linux from a clean clone, and drifts
as the repositories and base images grow.

## A fresh checkout is 8.1 GB, and two repositories are 94 per cent of it

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

Everything except the first two adds up to under 600 MB, so nothing outside
them is worth optimising.

## simulation-engine: one directory, and a third of it is duplicate files

`webservice.docker/servicehub/data/` holds 3.3 GB in the working tree and
2.1 GB of Git LFS objects. Ten LFS files live there, but only **six distinct
contents**:

| Content | Size | Files carrying it |
|---|---|---|
| `913ce94699` | 441 MB | `AB.csv`, `MFH.csv`, `SFH.csv`, `TH.csv` |
| `ad0ec373a0` | 440 MB | `Commercial.csv`, `Public.csv` |
| `f39abfbc6a` | 441 MB | `Agricultural.csv` |
| `dff40740ac` | 441 MB | `Industrial.csv` |
| `c1a7dc1cac` | 11 KB | `charging/durations.csv` |
| `7b270dff7c` | 2.1 KB | `charging/coefs.csv` |

Eight large files, four distinct contents. About **1.55 GB of the checkout is
redundant copies**.

!!! warning "Four building types share one file"
    `AB.csv`, `MFH.csv`, `SFH.csv` and `TH.csv` are byte-identical, and so are
    `Commercial.csv` and `Public.csv`. Whatever the per-building-type
    distinction is meant to express, these files do not express it. That is
    worth resolving before the disk question: if the distinction is real the
    data is wrong, and if it is not real the files should not exist
    separately.

Each file is 96,433 rows by 325 columns, hourly from 2015-01-01 to
2025-12-31: about 31 million floating-point values held as decimal text at
roughly 13 bytes each.

### What each remedy is worth

Measured on one 421 MB file.

| Remedy | 3.3 GB becomes | Cost |
|---|---|---|
| Stop storing the six duplicates separately | ~1.76 GB | none; they are byte-identical |
| gzip | ~1.3 GB | readers must handle `.gz` |
| zstd -19 | ~1.0 GB | as above |
| float32 binary or Parquet | ~250 to 500 MB | the consuming code changes |
| Fetch at image build instead of committing | nothing in any clone | somewhere to host it |

Compression alone is weak here, 2.5x for gzip and 3.2x for zstd, because
decimal text of small floats does not pack well. The format is the cost, not
the packing: 31 million float32 values is 125 MB against 441 MB of text.

!!! note "LFS history is not the problem"
    `.git/lfs` holds 2.1 GB while the working tree holds 4.0 GB, because LFS
    stores each unique object once and the checkout materialises all ten
    files. Pruning history recovers little. The files themselves are the cost.

## enerplanet-pylovo: 1.6 GB, spread out

| File | Size |
|---|---|
| `raw_data/germany/postcode_germany.csv` | 209 MB |
| `raw_data/pylovo_db_full.sql.gz` | 136 MB |
| `initial-data/bremen.sql.gz` | 136 MB |
| `raw_data/postcode.csv` | 56 MB |
| `raw_data/netherlands/postcode_netherlands.csv` | 31 MB |
| `raw_data/transformer_data/` (GeoJSON) | 79 MB |

95 LFS files, 93 distinct contents, so there is no duplication to remove. The
two database dumps and the postcode tables are the candidates, and both are
already compressed or compressible text.

## Images: transfer size against extracted size

For the heat stack's eight images:

| Image | Content | On disk |
|---|---|---|
| `enerplanet/weather` | 1.1 GB | 4.94 GB |
| `enerplanet/buem-model` | 938 MB | 4.14 GB |
| `enerplanet/buem-gateway` | 221 MB | 1.03 GB |
| `postgis/postgis:16-3.4` | 203 MB | 853 MB |
| `thd-spatial-ai/city2tabula-server` | 174 MB | 680 MB |
| `postgres:17-alpine` | 112 MB | 424 MB |
| `thd-spatial-ai/ignis-build-db` | 58 MB | 202 MB |
| `thd-spatial-ai/ignis` | 48 MB | 195 MB |
| **all eight, shared layers counted once** | **2.6 GB** | **~8 GB** |

The columns differ by about four times. Content is what crosses the network
and matches `docker save` output to within tar padding. On disk is what the
storage driver extracts, and a conda environment is hundreds of thousands of
small files, each occupying a whole filesystem block: the archive packs them,
the extracted layer does not.

A disk budget therefore takes the second column. The two conda images share
nearly everything, so weather and buem-model together cost about 4.9 GB
rather than 9 GB; `buem-model` holds only 18 MB that `weather` does not.

!!! warning "An image built on a working machine measures that machine"
    A locally built image includes whatever the build context holds, and a
    context is the working tree rather than the tracked files. City2TABULA's
    development image measures 10.4 GB here, of which about 4.6 GB is one
    directory: `validation/` is gitignored but not dockerignored, so `COPY . .`
    takes a developer's own 2.3 GB of local output and the `chown -R` on the
    next line rewrites all of it into a second layer. The same directory is
    232 KB in a fresh clone.

    Figures taken from a machine that has run the pipeline therefore overstate
    what a new developer pays, which is the opposite of the usual staleness
    risk. Measure a build from a clean clone, or say which machine the number
    came from.

!!! warning "Build cache is counted nowhere"
    Images and checkouts are only part of it. `make setup` builds several
    images from source, and the build cache that leaves behind appears in no
    figure on this page or in Test Data. It grows until it is pruned, and
    `docker builder prune` is what reclaims it. Allow for it, or a budget
    sized exactly to these tables will be exceeded on the second build.
