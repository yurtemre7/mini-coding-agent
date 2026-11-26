"""Import bank exports (CSV with header date,description,amount)."""
import csv
import io

from .money import to_cents


def parse_rows(text: str) -> list[dict]:
    """Return one dict per row: date (str), description (str), amount_cents (int)."""
    reader = csv.DictReader(io.StringIO(text))
    rows = []
    for r in reader:
        rows.append({
            "date": r["date"],
            "description": r["description"].strip(),
            "amount_cents": to_cents(r["amount"]),
        })
    return rows
