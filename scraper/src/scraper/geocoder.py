"""
Nominatim geocoder with local file cache.
Caches results in data/geocache.json to avoid re-hitting the API.
"""
import json
import time
from pathlib import Path

import httpx
from rich.console import Console

from .config import GEOCACHE_FILE, GEOCODE_CITY_SUFFIX, NOMINATIM_DELAY_S, NOMINATIM_URL

console = Console()


def _load_cache() -> dict:
    if GEOCACHE_FILE.exists():
        return json.loads(GEOCACHE_FILE.read_text())
    return {}


def _save_cache(cache: dict) -> None:
    GEOCACHE_FILE.write_text(json.dumps(cache, indent=2))


def geocode_address(address: str, cache: dict | None = None) -> dict | None:
    """
    Returns {"lat": float, "lng": float} or None if not found.
    Manages its own cache load/save if cache dict not provided.
    """
    owns_cache = cache is None
    if owns_cache:
        cache = _load_cache()

    query = address if address.lower().endswith(("ny", "new rochelle")) else address + GEOCODE_CITY_SUFFIX
    cache_key = query.lower().strip()

    if cache_key in cache:
        return cache[cache_key]

    try:
        time.sleep(NOMINATIM_DELAY_S)
        resp = httpx.get(
            NOMINATIM_URL,
            params={"q": query, "format": "json", "limit": 1},
            headers={"User-Agent": "new-ro-monitor/1.0 (local civic tool)"},
            timeout=10,
        )
        resp.raise_for_status()
        results = resp.json()
        if results:
            r = results[0]
            coords = {"lat": float(r["lat"]), "lng": float(r["lon"])}
        else:
            coords = None
    except Exception as e:
        console.print(f"[yellow]Geocoding failed for '{address}': {e}[/yellow]")
        coords = None

    cache[cache_key] = coords
    if owns_cache:
        _save_cache(cache)

    return coords


def geocode_many(addresses: list[str]) -> dict[str, dict | None]:
    """Geocode a list of addresses, sharing one cache load/save."""
    cache = _load_cache()
    results = {}
    for addr in addresses:
        results[addr] = geocode_address(addr, cache=cache)
    _save_cache(cache)
    return results
