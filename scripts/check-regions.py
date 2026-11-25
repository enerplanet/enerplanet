"""Check a running heat stack against scripts/regions.yaml.

Fails (exit 1) when a listed PyLovo postcode is missing or its state holds fewer
grids than listed, when a listed 3D dataset is missing from City2TABULA, or when
a listed weather archive has no data at the centre of a listed PyLovo state.
Run by deploy-heat-stack.sh inside the stack's networks; usage:

    python check-regions.py regions.yaml
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

import yaml

PYLOVO_URL = os.environ.get("PYLOVO_URL", "http://pylovo:8086")
C2T_URL = os.environ.get("C2T_URL", "http://city2tabula:5000")
WEATHER_URL = os.environ.get("WEATHER_URL", "http://weather:8080")
WEATHER_API_KEY = os.environ.get("WEATHER_API_KEY", "")
READY_SECONDS = 300


def get_json(url: str, headers: dict | None = None, timeout: int = 60):
    """GET url and decode its JSON body, retrying for READY_SECONDS while the service is not reachable yet.

    deploy-heat-stack.sh runs this right after `compose up -d`, before the services listen.
    """
    req = urllib.request.Request(url, headers=headers or {})
    deadline = time.monotonic() + READY_SECONDS
    while True:
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.load(resp)
        except urllib.error.HTTPError:
            raise
        except urllib.error.URLError:
            if time.monotonic() > deadline:
                raise
            time.sleep(5)


def check_pylovo(listed: list, regions: list) -> tuple[list, list]:
    """Compare listed postcodes and grid counts with /boundary/available; return (failures, notes)."""
    held = {(r["country_code"], r["state_code"]): r for r in regions}
    failures, expected = [], {}
    for entry in listed:
        key = (entry["country"], entry["state"])
        expected[key] = expected.get(key, 0) + sum(entry["grids"].values())
        have = set(held.get(key, {}).get("postcodes", []))
        missing = sorted(set(entry["grids"]) - have)
        if missing:
            failures.append(f"pylovo {entry['name']}: postcodes {missing} missing in {key[0]} {key[1]}")
    for key, want in expected.items():
        got = held.get(key, {}).get("grid_count", 0)
        if got < want:
            failures.append(f"pylovo {key[0]} {key[1]}: {got} grids, regions.yaml lists {want}")
    listed_plz = {(e["country"], p) for e in listed for p in e["grids"]}
    notes = [f"pylovo {c} {s}: postcode {p} is held but not in regions.yaml"
             for (c, s), r in held.items() for p in r.get("postcodes", []) if (c, p) not in listed_plz]
    return failures, notes


def key_listed(country: str, state: str, listed: list) -> bool:
    """True when regions.yaml lists any PyLovo entry for country and state."""
    return any(e["country"] == country and e["state"] == state for e in listed)


def check_3d(listed: list, datasets: list) -> list:
    """Return a failure for every listed dataset id City2TABULA does not hold."""
    held = {d["dataset_id"] for d in datasets}
    return [f"3d {d}: not in City2TABULA's dataset list" for d in listed if d not in held]


def check_weather(listed: list, regions: list, pylovo: list) -> list:
    """Query every listed archive at the centre of every listed PyLovo state; return failures."""
    failures = []
    centres = [(r["country_code"], r["state_code"], r["centroid"]) for r in regions
               if key_listed(r["country_code"], r["state_code"], pylovo)]
    for archive in listed:
        for country, state, c in centres:
            query = dict(archive, lat=c["lat"], lon=c["lon"], variables="T", format="json")
            url = f"{WEATHER_URL}/v1/weather/point?{urllib.parse.urlencode(query)}"
            try:
                get_json(url, {"X-API-Key": WEATHER_API_KEY}, timeout=120)
            except (urllib.error.URLError, ValueError) as e:
                failures.append(f"weather {archive} at {country} {state} ({c['lat']:.3f}, {c['lon']:.3f}): {e}")
    return failures


def main(path: str) -> int:
    """Run all checks, print the result and return the exit code."""
    with open(path, encoding="utf-8") as f:
        want = yaml.safe_load(f)
    regions = get_json(f"{PYLOVO_URL}/boundary/available")["regions"]
    failures, notes = check_pylovo(want["pylovo"], regions)
    failures += check_3d(want["3d"], get_json(f"{C2T_URL}/api/v1/datasets")["datasets"])
    failures += check_weather(want["weather"], regions, want["pylovo"])
    for line in notes:
        print(f"note  {line}")
    for line in failures:
        print(f"FAIL  {line}")
    listed = sum(len(e["grids"]) for e in want["pylovo"])
    print(f"{listed} postcodes, {len(want['3d'])} 3D datasets, {len(want['weather'])} weather archives checked; "
          f"{len(failures)} failures")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
