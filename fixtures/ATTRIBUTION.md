# Fixture data sources

Small extracts of third-party datasets are committed to this repository so the
test suite runs without downloading the originals. Each entry below states the
source, its licence and what was changed. This file covers every such extract,
including the smoke test's own fixtures outside this directory.

## fixtures/city2tabula/city2tabula_loenen.sql.gz

Derived from the 3DBAG dataset, licensed CC BY 4.0.

> (c) 3DBAG by tudelft3d and 3DGI — https://docs.3dbag.nl/en/copyright/

Modifications: building envelope attributes and surface geometry were
extracted from the source CityGML by City2TABULA, then linked to PyLovo
buildings. This is derived data, not a redistribution of 3DBAG itself.

CC BY 4.0 requires both the credit above and this statement of modification.

## fixtures/weather/cosmo_rea6/netherlands/output/COSMO_REA6_2018_annual_all_attrs.nc

COSMO-REA6 regional reanalysis, generated in the framework of the
Hans-Ertel-Centre for Weather Research (HErZ), Climate Monitoring and
Diagnostics, at the Universities of Bonn and Cologne.

> Data basis: Hans-Ertel-Centre for Weather Research
>
> © Hans-Ertel-Centre for Weather Research — https://www.herz-tb4.uni-bonn.de

The data may be used without restriction provided the source is referenced,
under the German federal terms for geographical data (GeoNutzV). Its binding
design notes require the "Data basis" wording above, rather than a plain
"Source:" credit, whenever the data is modified rather than copied verbatim,
and require the extent of the modification to be stated.

Modifications: retrieved from the DWD open data archive, which hosts the data
set, and processed by the `weather` pipeline, which standardises variable
names and derives further variables. The result was then cut to a 3 by 3 cell
window around Loenen, Netherlands, from the Dutch 2018 annual archive and
recompressed. Full year, hourly, 13 variables.

## fixtures/pylovo/pylovo_loenen_fixture.sql.gz and the smoke GeoJSON fixtures

Covers `fixtures/pylovo/pylovo_loenen_fixture.sql.gz` and
`enerplanet/backend/scripts/smoke/*_buildings.geojson` /
`*_transformers.geojson`.

Building footprints, building identifiers and transformer positions produced by
PyLovo, whose inputs come primarily from OpenStreetMap via Geofabrik extracts
and the Overpass API.

> © OpenStreetMap contributors — https://www.openstreetmap.org/copyright

OpenStreetMap data is licensed under the Open Database License (ODbL) 1.0.

PyLovo itself (`enerplanet/enerplanet-pylovo`, a fork of `tum-ens/pylovo`) is
MIT licensed, © BigGeoData & Spatial AI, Technische Hochschule Deggendorf. The
usage classification, floor areas, low-voltage grid assignment and transformer
rated powers in these files are PyLovo output rather than OpenStreetMap data.

Modifications: a handful of buildings within one bounding box were selected and
exported as GeoJSON, carrying the OpenStreetMap identifier and footprint
alongside the PyLovo-derived properties above. The Loenen file's
`grid_result_id` is a placeholder, not a real grid.

!!! note
    ODbL's share-alike terms can extend to a redistributed derivative database,
    not only to attribution. Confirm what they require of this repository before
    distributing these files more widely.
