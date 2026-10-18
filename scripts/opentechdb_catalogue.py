#!/usr/bin/env python3
"""Refresh the technology catalogue's OpenTech-DB products.

    ./scripts/opentechdb_catalogue.py

Reads the building-scale, commercially available instances of the supported
technologies from OpenTech-DB and writes them as products into both copies of
default_technologies.json, replacing the products of an earlier run. Each heat
technology also gets a default product (key equal to its type) from the
backend's building technology defaults. Other generic entries are kept.
"""

import json
import urllib.request
from pathlib import Path

API = "https://otdb.th-deg.de/api/v1/technologies"
ROOT = Path(__file__).resolve().parent.parent
DEFAULTS = ROOT / "enerplanet/backend/internal/payload/building_technologies.json"
TARGETS = [
    ROOT / "initial-data/techs/default_technologies.json",
    ROOT / "enerplanet/frontend/public/initial-data/techs/default_technologies.json",
]

# OpenTech-DB slug -> technology type.
TYPES = {
    "air_source_heat_pump": "air_source_heat_pump",
    "ground_source_heat_pump": "ground_source_heat_pump",
    "electric_boilers": "electric_boilers",
    "gas_boiler": "gas_boiler",
    "solar_pv_distributed": "pv_supply",
    "lithium_ion_bess": "battery_storage",
}
ICONS = {"pv_supply": "solar-panel", "battery_storage": "battery"}
HEAT_NAMES = {
    "air_source_heat_pump": "Air-source heat pump",
    "ground_source_heat_pump": "Ground-source heat pump",
    "electric_boilers": "Electric boiler",
    "gas_boiler": "Gas boiler",
}
MAX_KW = 100
# ECB reference rate, 2024 annual average: 1 EUR = 1.08238 USD.
USD_PER_EUR = 1.08238
# PVWatts module types: standard is about 19 % efficient, premium about 21 %.
PREMIUM_MODULE_EFFICIENCY = 0.20


def get(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=30) as resp:
        return json.load(resp)


def value(instance: dict, field: str) -> float | None:
    entry = instance.get(field)
    return entry.get("value") if isinstance(entry, dict) else None


def eur(instance: dict, field: str, divisor: float = 1) -> float | None:
    usd = value(instance, field)
    return None if usd is None else round(usd / USD_PER_EUR / divisor, 2 if divisor == 1 else 6)


def heat_constraints(eff, lifetime, capex, om_annual=0, om_prod=0, interest=0.1) -> list[dict]:
    return [
        {"key": "cont_energy_cap_max", "alias": "Maximum installed energy capacity", "default_value": "INF", "unit": "kW", "min": None, "max": None},
        {"key": "cont_energy_cap_min", "alias": "Minimum installed energy capacity", "default_value": 0, "unit": "kW", "min": None, "max": None},
        {"key": "cont_energy_eff", "alias": "Energy efficiency", "default_value": eff, "unit": "", "min": 0, "max": None},
        {"key": "cont_lifetime", "alias": "Technology lifetime", "default_value": lifetime, "unit": "years", "min": None, "max": None},
        {"key": "cost_energy_cap", "alias": "Cost of energy capacity", "default_value": capex, "unit": "EUR/kW", "min": None, "max": None},
        {"key": "cost_om_annual", "alias": "Yearly O&M costs", "default_value": om_annual, "unit": "EUR/kW", "min": None, "max": None},
        {"key": "cost_om_prod", "alias": "Production O&M costs", "default_value": om_prod, "unit": "EUR/kWh", "min": None, "max": None},
        {"key": "cost_interest_rate", "alias": "Interest rate", "default_value": interest, "unit": "%", "min": 0, "max": 1},
    ]


def default_heat_products() -> list[dict]:
    defaults = json.loads(DEFAULTS.read_text())
    out = []
    for typ, name in HEAT_NAMES.items():
        d = defaults[typ]
        out.append({
            "key": typ, "type": typ, "alias": f"{name} (default)", "icon": "flame",
            "description": f"Default {name.lower()} for a household.",
            "source": d["_source"],
            "constraints": heat_constraints(d["cont_energy_eff"], d["cont_lifetime"], d["cost_energy_cap"], interest=d["cost_interest_rate"]),
        })
    return out


def override(generic: list[dict], values: dict) -> list[dict]:
    out = [dict(c) for c in generic]
    for c in out:
        if c["key"] in values and values[c["key"]] is not None:
            c["default_value"] = values[c["key"]]
    return out


def product(typ: str, instance: dict, generic: dict) -> dict:
    if typ == "pv_supply":
        module = 1 if (value(instance, "electrical_efficiency") or 0) >= PREMIUM_MODULE_EFFICIENCY else 0
        constraints = override(generic[typ], {
            "cost_energy_cap": eur(instance, "capex_per_kw"), "cost_om_annual": eur(instance, "opex_fixed_per_kw_yr"),
            "cont_lifetime": value(instance, "economic_lifetime_yr"), "module_type": module,
        })
    elif typ == "battery_storage":
        constraints = override(generic[typ], {
            "cost_energy_cap": eur(instance, "capex_per_kw"), "cost_om_annual": eur(instance, "opex_fixed_per_kw_yr"),
            "cont_lifetime": value(instance, "economic_lifetime_yr"), "cont_energy_eff": value(instance, "electrical_efficiency"),
        })
    else:
        constraints = heat_constraints(
            value(instance, "thermal_efficiency"), value(instance, "economic_lifetime_yr"), eur(instance, "capex_per_kw"),
            eur(instance, "opex_fixed_per_kw_yr"), eur(instance, "opex_variable_per_mwh", 1000),
        )
    sources = sorted({v["source"] for v in instance.values() if isinstance(v, dict) and v.get("source")})
    return {
        "key": f"{typ}__{instance['extra']['instance_id']}",
        "type": typ,
        "alias": instance["label"],
        "icon": ICONS.get(typ, "flame"),
        "description": f"Typical size {value(instance, 'capacity_kw'):g} kW. Prices converted from USD at {USD_PER_EUR} USD/EUR.",
        "manufacturer": instance.get("manufacturer") or "",
        "source": f"{'; '.join(sources)} (via OpenTech-DB)",
        "constraints": constraints,
    }


def main() -> None:
    catalogue = json.loads(TARGETS[0].read_text())
    kept = [t for t in catalogue["technologies"] if "__" not in t["key"] and t["key"] not in HEAT_NAMES]
    generic = {t["key"]: t["constraints"] for t in kept}
    products = []
    listing = get(f"{API}?limit=100")["technologies"]
    for tech in listing:
        typ = TYPES.get(tech["slug"])
        if typ is None:
            continue
        for instance in get(f"{API}/{tech['id']}")["instances"]:
            if instance.get("life_cycle_stage") == "commercial" and (value(instance, "capacity_kw") or MAX_KW + 1) <= MAX_KW:
                products.append(product(typ, instance, generic))
    products.sort(key=lambda p: (p["type"], p["key"]))
    catalogue["technologies"] = kept + default_heat_products() + products
    text = json.dumps(catalogue, indent=4, ensure_ascii=False) + "\n"
    for target in TARGETS:
        target.write_text(text)
    print(f"{len(products)} products written")


if __name__ == "__main__":
    main()
