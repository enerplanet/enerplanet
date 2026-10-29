---
audience: developer
---

# `deploy-fixture.sh`

Loads one version of the EnerPlanET test data (3D buildings, building
attributes, weather and PyLovo grids) into a heat stack that is already
running under a prefix. A region becomes usable in EnerPlanET once its 3D
buildings, its PyLovo grids and weather covering it are loaded.

```bash
scripts/deploy-fixture.sh --prefix sim2 /path/to/enerplanet-test-data/v2
```

The stack must be up first, from
[`deploy-heat-stack-branch.sh`](deploy-heat-stack-branch.md) or
[`deploy-heat-stack.sh --no-fixtures`](deploy-heat-stack.md). The script works
through the stack's running containers and never touches the host's own
PyLovo or City2TABULA.

## The test data folder

```
enerplanet-test-data/
  README.md        regions available now, and the version each one arrived in
  CHANGELOG.md     one entry per version: regions added, PyLovo re-exported, fixes
  v1/  v2/  ...    one folder per version, each complete
```

Each version is a complete snapshot of every region so far, not a difference
from the one before. A server needs only the newest folder. The shared folder
holds everything except `weather/`, which is too large to keep there and is
sent to the server separately (see [Weather](#weather)).

| Path in `vN/` on the server | Content | Goes to |
|---|---|---|
| `3d/<country>/<provider>/` | 3D building files with their `attribution.json` | City2TABULA `data/lod2/<country>/<provider>/`, then imported |
| `attributes/<country>/<provider>/` | building attributes, such as BAG building use | City2TABULA `data/attributes/<country>/<provider>/`, then imported |
| `weather/<provider>/<country>/output/` | per-country weather archives in weather-serve's own layout, sent separately | weather-serve `/data/`, served from the next request on |
| `pylovo/<name>.sql.gz` | one PyLovo dump holding every region's grids | replaces the stack's PyLovo database |
| `README.md` | what this version holds | not loaded |

`<country>` under `3d/` and `attributes/` is City2TABULA's country name:
`austria`, `czechia`, `germany`, `netherlands` and so on. The script stops on
any other folder name before it copies anything.

Any of the four parts may be absent. A version without `pylovo/` leaves the
PyLovo database as it is.

## Weather

`weather/` holds the per-country archives (`<provider>/<country>/output/`) of
a weather data directory, the only files weather-serve reads besides its
provider-wide fallback. They are sent from the machine that holds the weather
data straight into the server's version folder, over SSH:

```bash
cd /path/to/weather/data
rsync -aR --partial --info=progress2 */austria/output */netherlands/output \
  user@server:/path/to/enerplanet-test-data/vN/weather/
```

`-R` keeps the `<provider>/<country>/output/` paths. weather-serve answers a
point from the nearest country whose bounding box contains it, so send the
countries whose boxes hold the regions; a region near a border may be served
from the neighbouring country. Leave out the provider-wide archives
(`<provider>/output/`), downloads and logs, which are hundreds of GB.

## What a run does

1. **3D and attributes.** Copies every file the stack does not have yet into
   the directories City2TABULA's server mounts. A file that is already there
   with different content is kept, with a warning.
2. **Import.** For each country in the folder, runs City2TABULA's CLI inside
   the server container: `-create-db` when the country has no database yet,
   otherwise `-import-data`, which skips files already imported. The buildings
   land in the CityDB schema as raw data; features are extracted when a model
   is first drawn over them.
3. **Weather.** Copies every weather file the stack does not have yet into
   weather-serve's data directory. weather-serve looks files up on each
   request, so no restart is needed.
4. **PyLovo.** Restores the dump into a temporary database, then drops the
   stack's PyLovo database and renames the new one into its place. If the
   restore fails, the old database stays untouched.
5. **Relink.** Re-links every country's City2TABULA buildings to the new
   PyLovo grids (`-link-pylovo -relink`), since earlier links point at the
   database just replaced.
6. **Record.** Writes the version name to `.local/heat-stack/<prefix>/fixture.env`,
   which `status` prints.

Running the same version again is safe: no files are copied, nothing new is
imported, and PyLovo is restored again from the same dump.

## Deploying a new version

From your machine, send the version folder and its weather:

```bash
rsync -a --partial --info=progress2 /path/to/enerplanet-test-data/v3 \
  user@server:/path/to/enerplanet-test-data/
cd /path/to/weather/data
rsync -aR --partial --info=progress2 */austria/output */netherlands/output \
  user@server:/path/to/enerplanet-test-data/v3/weather/
```

On the server:

```bash
scripts/deploy-fixture.sh --prefix sim2 /path/to/enerplanet-test-data/v3
rm -r /path/to/enerplanet-test-data/v2
```

The previous folder can be removed once the run succeeds; nothing reads from
it afterwards. Redeploying the stack is not needed.

## Adding a region

1. Prepare the region's 3D data, its PyLovo grids in your local PyLovo
   database, and weather cuts covering it in your local weather-serve.
2. Copy the newest `vN` to `vN+1`.
3. Add the 3D files under `vN+1/3d/<country>/<provider>/` with an
   `attribution.json`. City2TABULA refuses a provider folder without one.
4. Export a new PyLovo dump of every region, including the new one, to
   `vN+1/pylovo/`, replacing the old dump.
5. Describe the version in `vN+1/README.md`, add a `CHANGELOG.md` entry, and
   add the region to the root `README.md`.
6. Send `vN+1` and the weather to the server and run the script, as in
   [Deploying a new version](#deploying-a-new-version).

Check the weather before publishing: a point outside every cut is refused
with `archive_not_servable`.

```bash
curl -H 'X-API-Key: <key>' \
  'http://localhost:<port>/v1/weather/point?provider=cosmo-rea6&lat=<lat>&lon=<lon>&year=2018&use_case=solar'
```

The PyLovo dump must hold every region, not only the new one: the script
replaces the database with it, and a dump of one region removes the others'
grids.

## Options

| Option | Meaning |
|---|---|
| `--prefix NAME` | Required. The prefix the stack was deployed under |
| `--workdir DIR` | Where `fixture.env` is written. Default `<repo>/.local/heat-stack/NAME`, the same as the deploy scripts |
| `-h`, `--help` | Usage text |

## Limits

- **Removing a region.** A version that drops a region removes its PyLovo
  grids, but its 3D files and imported buildings stay. To clear them, run
  `down --volumes`, deploy again and load the version.
- **Changed files.** A 3D or weather file whose name already exists on the
  server is not replaced, and a 3D file is not re-imported. Publish a
  correction under a new file name. weather-serve also caches answers until it
  restarts.

## Errors

| Message | Cause | Fix |
|---|---|---|
| `container <prefix>-city2tabula is not running` (or `-weather-serve`, `-pylovo-postgres`) | The stack is not up under that prefix | Deploy the stack first, or check `--prefix` |
| `<country> is not a City2TABULA country` | A folder under `3d/` or `attributes/` has another name | Rename it to a name from the list in the message |
| `<db> ... holds only a restored repository fixture` | The stack was deployed with the repository's fixtures, which restore databases that cannot take an import | Drop that database in `<prefix>-city2tabula-db`, then re-run |
| `PyLovo: restoring ... failed; pylovo_db was left as it was` | The dump has an error | Fix or re-export the dump and re-run; the stack keeps its previous grids |
| `holds N dumps; keep exactly one` | More than one `.sql.gz` in `pylovo/` | Keep the current dump only |
| `has no 3d/, attributes/, weather/ or pylovo/*.sql.gz` | Wrong folder given | Pass the `vN` folder itself |

A failure in the City2TABULA CLI stops the run with the CLI's own log above
it. Fix the cause and run the same version again.
