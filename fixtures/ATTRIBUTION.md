# Fixture data sources

Small extracts of third-party datasets are committed to this repository so the
test suite runs without downloading the originals. Each entry below states the
source, its licence and what was changed. This file covers every such extract,
including the smoke test's own fixtures outside this directory.

## fixtures/city2tabula/city2tabula_loenen.sql.gz

Derived from the 3DBAG dataset, licensed CC BY 4.0
(https://creativecommons.org/licenses/by/4.0/).

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

## fixtures/city2tabula/tabula_nl.sql.gz and tabula_de.sql.gz

The TABULA building typology, by Institut Wohnen und Umwelt (IWU), Darmstadt,
produced under the Intelligent Energy Europe Programme (IEE/09/739/SI2.558245).

> TABULA Building Typology © Institut Wohnen und Umwelt (IWU), Darmstadt —
> https://webtool.building-typology.eu/

Licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/), which
requires both the credit above and this statement of
modification.

Modifications: the per-country archetype rows City2TABULA imports into its
`tabula` schema, extracted as the Dutch set (135 rows) and the German set (232
rows) and recompressed. No values were altered.

## fixtures/city2tabula/city2tabula_bremen.sql.gz

Derived from `3D-Gebäudemodell LoD2 Land Bremen`, licensed CC BY 4.0
(https://creativecommons.org/licenses/by/4.0/).

> Quellenvermerk: Landesamt GeoInformation Bremen —
> https://www.geo.bremen.de/

The licence is named in the dataset's MetaVer metadata record, which also
records that no access restrictions apply:

> https://www.metaver.de/trefferanzeige?docuuid=226971C2-6677-4B79-95F3-C5311F1275C8

!!! note
    The provider's own web pages carry a Creative Commons BY-NC-ND notice and
    name no licence for the data. That notice is read here as applying to the
    pages rather than to the dataset, whose terms are the metadata record
    above. The two are easily confused: an earlier reading of the web pages
    alone concluded no licence existed and blocked redistribution of this
    fixture.

Modifications: building envelope attributes and surface geometry were
extracted from the source CityGML by City2TABULA, then cut to the box
8.7908 53.0940 to 8.7990 53.1027 around Bremen and recompressed. The pipeline
intermediates were emptied, leaving the served tables only. This is derived
data, not a redistribution of the source model.

CC BY 4.0 requires both the credit above and this statement of modification.

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
