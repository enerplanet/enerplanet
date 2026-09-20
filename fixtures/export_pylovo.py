#!/usr/bin/env python3
"""Generate the pylovo fixture for one or more (country, postcode) scopes.

    ./export_pylovo.py --scope NL:7371 --scope DE:28215 \
        --source-db pylovo_db_prefixture --port 5433 \
        -o pylovo/pylovo_fixture.sql

The schema is rendered from pylovo's own CREATE_QUERIES rather than pg_dump, so
the fixture carries no drift from whichever machine produced it. Only the rows
come from the live database.

psql is driven as a subprocess rather than psycopg so this stays runnable with
no Python dependencies beyond the standard library.
"""

from __future__ import annotations

import argparse
import importlib.util
import os
import subprocess
import sys
from pathlib import Path

# Added at runtime by the enrichment step and the user-transformer feature, so
# a schema built from CREATE_QUERIES alone does not have them.
RUNTIME_COLUMNS = [
    "ALTER TABLE oth ADD COLUMN IF NOT EXISTS energy_label varchar(5);",
    "ALTER TABLE oth ADD COLUMN IF NOT EXISTS energy_index double precision;",
    "ALTER TABLE grid_result ADD COLUMN IF NOT EXISTS user_id varchar(255);",
    "ALTER TABLE grid_result ADD COLUMN IF NOT EXISTS model_id integer;",
    "ALTER TABLE grid_result ADD COLUMN IF NOT EXISTS draft_id varchar(255);",
]

SEQUENCES = [
    ("grid_result_grid_result_id_seq", "grid_result", "grid_result_id"),
    ("lines_result_lines_result_id_seq", "lines_result", "lines_result_id"),
    ("state_state_id_seq", "state", "state_id"),
]

# Emission order is FK-safe: parents before children. Each entry is the table
# and the WHERE clause that narrows it to the requested scopes, with {scopes}
# standing for the VALUES list and {version} for the version id.
#
# res, oth and ways carry no version or postcode column, so they are cut to the
# postcode polygon instead. That is deliberately wider than the buildings the
# grids reached: a model drawn anywhere inside the region must find buildings,
# not only the ones that happen to sit on a generated grid.
# (table, kind). The kind picks the filter shape:
#   all       no filter; reference data every region needs
#   scope     by (country_code, postcode)
#   spatial   inside the country's clip, or inside its postcodes when unclipped
#   grid      the grids of the region
#   by_grid   everything hanging off those grids
#   trafos    spatial, plus whatever transformer_positions references
TABLES = [
    ("country", "all"),
    ("state", "state"),
    ("version", "all"),
    ("equipment_data", "all"),
    ("consumer_categories", "all"),
    ("postcode", "scope"),
    ("res", "spatial"),
    ("oth", "spatial"),
    ("ways", "spatial"),
    ("postcode_result", "scope"),
    ("grid_result", "grid"),
    ("buildings_result", "by_grid"),
    ("lines_result", "by_grid"),
    # transformer_positions.osm_id is a foreign key into transformers, and is
    # non-null wherever a grid reused a transformer mapped in OSM rather than
    # placing a synthetic one on a way. A grid's transformer can sit just
    # outside the region, so the referenced ids are taken as well as the
    # polygon rather than instead of it.
    ("transformers", "trafos"),
    ("transformer_positions", "by_grid"),
]

# postcode_result.geom is what /boundary/available turns into the region's
# bounding box, so under a clip it has to be cut to the same polygon. Left
# whole it would advertise the administrative postcode, sending a user to draw
# in an area the 3D source never covered.
CLIPPED_GEOM = {
    "postcode": "ST_Multi(ST_Intersection(t.geom, {clip_local}))",
    "postcode_result": "ST_Multi(ST_Intersection(t.geom, {clip_local}))",
}

IN_POSTCODE = """WHERE EXISTS (
    SELECT 1 FROM postcode_result pr
    JOIN ({scopes}) AS s(cc, plz)
      ON pr.country_code = s.cc AND pr.postcode_result_plz = s.plz
    WHERE pr.version_id = {version}
      AND pr.country_code = t.country_code
      AND ST_Intersects(t.geom, pr.geom))"""

GRID_FILTER = """version_id = {version}
    AND (country_code, plz) IN (SELECT cc, plz FROM ({scopes}) AS s(cc, plz))"""

# A clip narrows a country to the area its 3D source actually covers, which is
# what --clip is for. The alternative, a whole postcode, only works where the
# 3D tiling happens to align with postcode boundaries; the Bremen LoD2 tile
# straddles five of them, so no single postcode is both covered and covering.
#
# Grids are kept whole rather than cut to the clip. A grid with some of its
# buildings removed is no longer a grid that power flow can run on, and the
# buildings outside the clip are unreachable anyway once postcode_result is
# clipped to the same polygon.
CLIP_IN_REGION = "WHERE t.country_code = {cc} AND ST_Intersects(ST_Transform(t.geom, 4326), {clip})"

CLIP_GRID_FILTER = """version_id = {version} AND country_code = {cc}
    AND grid_result_id IN (
        SELECT br.grid_result_id FROM buildings_result br
        WHERE br.version_id = {version}
          AND ST_Intersects(ST_Transform(br.geom, 4326), {clip}))"""


def load_create_queries(pylovo_repo: Path) -> dict[str, str]:
    """Import CREATE_QUERIES from the pylovo checkout without installing it."""
    path = pylovo_repo / "config" / "config_table_structure.py"
    if not path.is_file():
        raise SystemExit(f"no CREATE_QUERIES at {path}; pass --pylovo-repo")
    spec = importlib.util.spec_from_file_location("pylovo_table_structure", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.CREATE_QUERIES


class Psql:
    """Single-value and single-column queries against the source database."""

    def __init__(self, host: str, port: str, user: str, dbname: str, password: str):
        self.base = ["psql", "-h", host, "-p", port, "-U", user, "-d", dbname,
                     "-tAX", "-v", "ON_ERROR_STOP=1"]
        self.env = {**os.environ, "PGPASSWORD": password}

    def query(self, sql: str) -> list[str]:
        done = subprocess.run(self.base + ["-c", sql], capture_output=True,
                              text=True, env=self.env)
        if done.returncode != 0:
            raise SystemExit(f"psql failed for:\n{sql}\n{done.stderr.strip()}")
        return done.stdout.splitlines()


def columns(db: Psql, table: str) -> list[str]:
    rows = db.query(
        "SELECT column_name FROM information_schema.columns "
        f"WHERE table_schema = 'public' AND table_name = {sql_literal(table)} "
        "ORDER BY ordinal_position"
    )
    if not rows:
        raise SystemExit(f"table {table} not found in the source database")
    return rows


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def scopes_values(scopes: list[tuple[str, str]]) -> str:
    pairs = ", ".join(f"({sql_literal(cc)}, {sql_literal(plz)})" for cc, plz in scopes)
    return f"VALUES {pairs}"


def insert_statements(db: Psql, table: str, where: str,
                      overrides: dict[str, str] | None = None) -> tuple[list[str], int]:
    """Render each matching row as an INSERT, with the row count beside it.

    Every column is cast to text and quoted, which for a geometry column yields
    the hex EWKB PostGIS round-trips without an ST_GeomFromText wrapper.
    *overrides* replaces a column's value with a SQL expression over ``t``.

    The count comes from its own query rather than from the number of lines:
    grid_result.grid is JSON containing newlines, so one statement can span many
    lines and counting them reports several hundred thousand rows for 99 grids.
    """
    overrides = overrides or {}
    cols = columns(db, table)
    collist = ",".join(cols)
    values = ", ".join(
        f"quote_nullable(({overrides.get(col, f't.{col}')})::text)" for col in cols
    )
    sql = (
        f"SELECT 'INSERT INTO {table} ({collist}) VALUES (' || "
        f"concat_ws(',', {values}) || ');' FROM {table} t {where}"
    )
    count = int(db.query(f"SELECT count(*) FROM {table} t {where}")[0])
    return db.query(sql), count


def where_for(kind: str, table: str, groups: list[dict], subs: dict) -> str:
    """Build a table's WHERE by OR-ing one predicate per country group.

    A country either has a clip polygon or falls back to its postcodes, so a
    mixed run (one clipped region, one not) needs the two shapes side by side
    rather than one global filter.
    """
    if kind == "all":
        return ""
    if kind == "state":
        return f"""WHERE (country_code, state_code) IN (
                     SELECT pr.country_code, pr.state_code FROM postcode_result pr
                     JOIN ({subs['scopes']}) AS s(cc, plz)
                       ON pr.country_code = s.cc AND pr.postcode_result_plz = s.plz
                     WHERE pr.version_id = {subs['version']})"""
    if kind == "scope":
        col = "postcode_result_plz" if table == "postcode_result" else "plz"
        version = f"version_id = {subs['version']} AND " if table == "postcode_result" else ""
        return (f"WHERE {version}(country_code, {col}) IN "
                f"(SELECT cc, plz FROM ({subs['scopes']}) AS s(cc, plz))")

    parts = []
    for g in groups:
        if kind in ("spatial", "trafos"):
            parts.append(g["in_region"])
        elif kind == "grid":
            parts.append(g["grid_filter"])
        elif kind == "by_grid":
            parts.append(f"grid_result_id IN ({g['grid_ids']})")
    clause = " OR ".join(f"({p})" for p in parts)
    if kind == "trafos":
        referenced = " OR ".join(
            f"osm_id IN (SELECT osm_id FROM transformer_positions "
            f"WHERE osm_id IS NOT NULL AND grid_result_id IN ({g['grid_ids']}))"
            for g in groups
        )
        clause = f"{clause} OR {referenced}"
    return f"WHERE {clause}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--scope", action="append", required=True, metavar="CC:PLZ",
                        help="country code and postcode to include, repeatable")
    parser.add_argument("--clip", action="append", default=[], metavar="CC:FILE",
                        help="cut a country to the WGS84 polygon in FILE, repeatable. "
                             "Use where the 3D source does not align with postcodes: "
                             "the region advertised to the UI becomes this polygon.")
    parser.add_argument("--state-osm", action="append", default=[], metavar="CC:CODE=ID",
                        help="set a state row's osm_relation_id, repeatable. Every German "
                             "state carries NULL in pylovo's state table, and the region "
                             "endpoint looks the boundary up from this id, so a German "
                             "region renders nothing without it. Values come from "
                             "datapipeline/config/regions.yaml.")
    parser.add_argument("--version", default="1", help="pylovo version_id (default: 1)")
    parser.add_argument("--source-db", default="pylovo_db_prefixture")
    parser.add_argument("--host", default="localhost")
    parser.add_argument("--port", default="5433")
    parser.add_argument("--user", default="postgres")
    parser.add_argument("--password", default=os.environ.get("PGPASSWORD", "postgres"))
    parser.add_argument("--pylovo-repo", type=Path,
                        default=Path(__file__).resolve().parents[2] / "enerplanet-pylovo")
    parser.add_argument("-o", "--output", type=Path, required=True)
    args = parser.parse_args()

    scopes = []
    for raw in args.scope:
        if ":" not in raw:
            raise SystemExit(f"--scope wants CC:PLZ, got {raw!r}")
        cc, plz = raw.split(":", 1)
        scopes.append((cc.upper(), plz))

    clips = {}
    for raw in args.clip:
        if ":" not in raw:
            raise SystemExit(f"--clip wants CC:FILE, got {raw!r}")
        cc, path = raw.split(":", 1)
        clips[cc.upper()] = Path(path).read_text().strip()

    state_osm = {}
    for raw in args.state_osm:
        if ":" not in raw or "=" not in raw:
            raise SystemExit(f"--state-osm wants CC:CODE=ID, got {raw!r}")
        cc, rest = raw.split(":", 1)
        code, relation = rest.split("=", 1)
        if not relation.isdigit():
            raise SystemExit(f"--state-osm id must be numeric, got {relation!r}")
        state_osm[(cc.upper(), code)] = relation

    create_queries = load_create_queries(args.pylovo_repo)
    db = Psql(args.host, args.port, args.user, args.source_db, args.password)

    subs = {
        "scopes": scopes_values(scopes),
        "version": sql_literal(args.version),
    }
    subs["in_postcode"] = IN_POSTCODE.format(**subs)

    groups = []
    for cc in dict.fromkeys(cc for cc, _ in scopes):
        if cc in clips:
            clip = f"ST_GeomFromText({sql_literal(clips[cc])}, 4326)"
            g = {
                "cc": cc,
                "clip_local": f"ST_Transform({clip}, ST_SRID(t.geom))",
                "in_region": CLIP_IN_REGION.format(cc=sql_literal(cc), clip=clip).removeprefix("WHERE "),
                "grid_filter": CLIP_GRID_FILTER.format(cc=sql_literal(cc), clip=clip, **subs),
            }
        else:
            in_scope = (f"(country_code, plz) IN (SELECT cc, plz FROM ({subs['scopes']}) "
                        f"AS s(cc, plz) WHERE cc = {sql_literal(cc)})")
            g = {
                "cc": cc,
                "clip_local": None,
                "in_region": (f"t.country_code = {sql_literal(cc)} AND "
                              + subs["in_postcode"].removeprefix("WHERE ")),
                "grid_filter": f"version_id = {subs['version']} AND {in_scope}",
            }
        g["grid_ids"] = f"SELECT grid_result_id FROM grid_result WHERE {g['grid_filter']}"
        groups.append(g)

    named = ", ".join(f"{cc} {plz}" for cc, plz in scopes)
    clipped = ", ".join(sorted(clips)) or "none"
    out = [
        f"-- pylovo fixture: {named}, version_id {args.version}.",
        f"-- Clipped to the 3D source extent for: {clipped}.",
        "-- A model drawn anywhere inside an advertised region finds buildings.",
        "-- Schema and data. Restores into an empty database with no prior setup.",
        "-- Schema comes from config/config_table_structure.py CREATE_QUERIES, not from",
        "-- pg_dump of a running instance, so it carries no drift from any one machine.",
        "",
        "CREATE EXTENSION IF NOT EXISTS postgis;",
        "CREATE EXTENSION IF NOT EXISTS pgRouting;",
        "",
        "BEGIN;",
        "",
        f"-- schema: {len(create_queries)} tables from CREATE_QUERIES",
    ]
    for ddl in create_queries.values():
        out.append(ddl.strip().rstrip(";") + ";")

    out += ["", "-- These columns are added at runtime by the enrichment step and the",
            "-- user-transformer feature, not by config/config_table_structure.py, so a",
            "-- schema built from CREATE_QUERIES alone does not have them."]
    out += RUNTIME_COLUMNS

    for table, kind in TABLES:
        where = where_for(kind, table, groups, subs)
        overrides = {}
        if table == "state" and state_osm:
            branches = " ".join(
                f"WHEN t.country_code = {sql_literal(cc)} AND t.state_code = {sql_literal(code)} "
                f"THEN {relation}"
                for (cc, code), relation in state_osm.items()
            )
            overrides["osm_relation_id"] = f"CASE {branches} ELSE t.osm_relation_id END"
        if table in CLIPPED_GEOM:
            clipping = [g for g in groups if g["clip_local"]]
            if clipping:
                # One CASE per clipped country: an unclipped country's rows keep
                # their own geometry rather than being cut by a foreign polygon.
                branches = " ".join(
                    f"WHEN t.country_code = {sql_literal(g['cc'])} THEN "
                    + CLIPPED_GEOM[table].format(clip_local=g["clip_local"])
                    for g in clipping
                )
                overrides["geom"] = f"CASE {branches} ELSE t.geom END"
        rows, count = insert_statements(db, table, where, overrides)
        out += ["", f"-- {table}: {count} rows"]
        out += rows
        print(f"{table}: {count} rows", file=sys.stderr)

    out += ["",
            "-- CREATE MATERIALIZED VIEW populates on creation, which happens above with",
            "-- the tables still empty, so every view needs refreshing after the inserts.",
            "-- Plain REFRESH, not CONCURRENTLY: the latter cannot run in a transaction",
            "-- and needs a prior populated refresh anyway."]
    for name, ddl in create_queries.items():
        if "MATERIALIZED" in ddl.upper():
            out.append(f"REFRESH MATERIALIZED VIEW {name};")

    out += ["", "-- Sequences must follow the inserted ids or the next insert collides."]
    for seq, table, col in SEQUENCES:
        out.append(
            f"SELECT setval('{seq}', (SELECT GREATEST(COALESCE(MAX({col}),1),1) FROM {table}));"
        )
    out += ["COMMIT;", ""]

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("\n".join(out))
    print(f"wrote {args.output}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
