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
extracted from the source CityGML by City2TABULA for the area around Loenen
covered by postcode 7371, then linked to PyLovo buildings. 3,106 buildings and
53,043 surfaces. The pipeline intermediates were emptied, leaving the served
tables only. This is derived data, not a redistribution of 3DBAG itself.

CC BY 4.0 requires both the credit above and this statement of modification.

## fixtures/weather/cosmo_rea6, the Dutch, German, Austrian and Czech cuts

Covers `COSMO_REA6_2018_annual_all_attrs.nc` under
`fixtures/weather/cosmo_rea6/netherlands/output/`, `.../germany/output/`,
`.../austria/output/` and `.../czech_republic/output/`.

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
names and derives further variables. The result was then cut to a window
around each site and recompressed: 3 by 3 cells around Loenen, Netherlands,
from the Dutch 2018 annual archive, 4 by 4 cells around Bremen, Germany, from
the German 2018 annual archive, 4 by 4 cells around Vienna, Austria, from the
Austrian 2018 annual archive, and 4 by 4 cells around Brno, Czechia, from the
Czech 2018 annual archive. Full year, hourly, 13 variables each.

## fixtures/city2tabula/tabula_nl.sql.gz, tabula_de.sql.gz, tabula_at.sql.gz and tabula_cz.sql.gz

The TABULA building typology, by Institut Wohnen und Umwelt (IWU), Darmstadt,
produced under the Intelligent Energy Europe Programme (IEE/09/739/SI2.558245).

> TABULA Building Typology © Institut Wohnen und Umwelt (IWU), Darmstadt —
> https://webtool.building-typology.eu/

Licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/), which
requires both the credit above and this statement of
modification.

Modifications: the per-country archetype rows City2TABULA imports into its
`tabula` schema, extracted as the Dutch set (135 rows), the German set (232
rows), the Austrian set (165 rows) and the Czech set (84 rows) and recompressed.
No values were altered.

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
extracted from the source CityGML by City2TABULA for one LoD2 tile,
`LoD2_32_486_5882_2_HB`, covering the box 8.7909 53.0873 to 8.8208 53.1053 in
Bremen, then linked to PyLovo buildings and recompressed. 9,284 buildings and
137,276 surfaces. The pipeline intermediates were emptied, leaving the served
tables only. This is derived data, not a redistribution of the source model.

CC BY 4.0 requires both the credit above and this statement of modification.

## fixtures/city2tabula/city2tabula_vienna.sql.gz

Derived from `Generalisiertes Dachmodell (LOD2.1)` in CityGML, by Stadt Wien
(MA 41 Stadtvermessung und Geoinformation), licensed CC BY 4.0
(https://creativecommons.org/licenses/by/4.0/).

> Datenquelle: Stadt Wien – data.wien.gv.at (https://data.wien.gv.at)

The licence is stated on the dataset page,
https://www.wien.gv.at/stadtplanung/generalisiertes-dachmodell, and the credit
wording in the Vienna open data terms of use,
https://digitales.wien.gv.at/ogd-nutzungsbedingungen/.

Modifications: building envelope attributes and surface geometry were
extracted from the source CityGML by City2TABULA for the area of postcodes
1010, 1070, 1080 and 1090 covered by `fixtures/pylovo/vienna_coverage.wkt`,
then linked to PyLovo buildings and recompressed. 1,318 buildings and 95,807
surfaces. The pipeline intermediates were emptied, leaving the served tables
only. This is derived data, not a redistribution of the source model.

CC BY 4.0 requires both the credit above and this statement of modification.

## fixtures/city2tabula/city2tabula_brno.sql.gz

Derived from `3D model budov / 3D Building Model`, published by Statutární
město Brno on its open data portal, data.brno.cz (dataset item
`dc95041d63e44e129ba0d9258a1dddb4`).

> Statutární město Brno, data.brno.cz: 3D model budov

The dataset's licence field reads `CC BY`. Neither the licence version nor a
required credit wording is stated on the dataset record (read 2026-10-02). The
credit above names the publisher and dataset as the record gives them.

Modifications: the photogrammetric LoD2 building model (captured 2020 to 2023,
EPSG:5514) was converted from Esri FileGDB to CityJSON, grouping faces into
buildings by `RUIAN_IBO` and mapping surface codes to ground, wall and roof
surfaces. City2TABULA then extracted envelope attributes and surface geometry
for the buildings whose footprint centroid lies in the box
`fixtures/pylovo/brno_box.wkt` (16.603 49.190 to 16.613 49.200), linked them to
PyLovo buildings and the result was recompressed. 778 buildings and 33,631
surfaces. The pipeline intermediates were emptied, leaving the served tables
only. This is derived data, not a redistribution of the source model.

## fixtures/pylovo/pylovo_fixture.sql.gz, the example models and the smoke GeoJSON fixtures

Covers `fixtures/pylovo/pylovo_fixture.sql.gz`, `fixtures/models/*.json` and
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

Modifications: the database fixture carries the grids, buildings, lines and
transformers of four areas: postcode 7371 around Loenen; the five Bremen
postcodes the LoD2 tile above intersects; Vienna postcodes 1010, 1070, 1080 and
1090; and Brno postcode 60200. Outside Loenen it keeps only the grids whose
buildings all lie inside that site's clip (the Bremen tile,
`vienna_coverage.wkt`, `brno_box.wkt`). 221 grids, 9,073 buildings, 17,782
lines, 39 transformers. Postcode geometries are clipped to the same polygons,
so the extent the fixture advertises is the extent it can serve.

The Brno postcode row keeps only the postcode number. Its geometry is the clip
box, its label reads `60200 Czechia` and its area is the box's, so it carries
no geometry or attribute of the source postcode dataset.

The Vienna postcode geometries are Vienna district boundaries from the
Statistik Austria municipal boundaries, edition 2026-01-01, licensed CC BY 4.0
(https://creativecommons.org/licenses/by/4.0/), clipped as above.

> Datenquelle: Statistik Austria
> (https://data.statistik.gv.at/web/meta.jsp?dataset=OGDEXT_GEM_1)

The example models are one saved model each for Loenen and Bremen, 8 and 7
buildings, exported as the request body the frontend sends: footprints and
PyLovo-derived properties as above, plus the lines and transformer of the grid
they sit on.

The smoke GeoJSON files are separate: a handful of buildings within one
bounding box, exported carrying the OpenStreetMap identifier and footprint
alongside the PyLovo-derived properties above. The Loenen file's
`grid_result_id` is a placeholder, not a real grid.

!!! note
    ODbL's share-alike terms can extend to a redistributed derivative database,
    not only to attribution. Confirm what they require of this repository before
    distributing these files more widely.
