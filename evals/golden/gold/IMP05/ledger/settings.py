"""Settings, loaded from ledger.toml with defaults."""
import tomllib
from pathlib import Path

DEFAULTS = {"tax_rate_percent": 19, "currency": "EUR"}
TYPES = {"tax_rate_percent": int, "currency": str}


def load_settings(path) -> dict:
    path = Path(path)
    data = tomllib.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    unknown = set(data) - set(DEFAULTS)
    if unknown:
        raise ValueError(f"unknown settings: {sorted(unknown)}")
    out = dict(DEFAULTS)
    for key, value in data.items():
        if type(value) is not TYPES[key]:
            raise ValueError(f"{key} must be {TYPES[key].__name__}")
        out[key] = value
    if not 0 <= out["tax_rate_percent"] <= 100:
        raise ValueError("tax_rate_percent must be between 0 and 100")
    return out
