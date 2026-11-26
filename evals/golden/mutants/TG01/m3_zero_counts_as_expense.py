"""Reports over imported rows (dicts with date "YYYY-MM-DD" and amount_cents)."""


def monthly_totals(rows: list[dict]) -> dict[str, int]:
    """Sum amount_cents per month. Keys are "YYYY-MM", returned in ascending order."""
    totals: dict[str, int] = {}
    for r in rows:
        key = r["date"][:7]
        totals[key] = totals.get(key, 0) + r["amount_cents"]
    return dict(sorted(totals.items()))


def largest_expense(rows: list[dict]) -> dict | None:
    """The row with the most negative amount. None when there are no expenses (amount < 0)."""
    expenses = [r for r in rows if r["amount_cents"] <= 0]
    if not expenses:
        return None
    return min(expenses, key=lambda r: r["amount_cents"])


def running_balance(rows: list[dict], opening: int = 0) -> list[int]:
    """Balance after each row, rows taken in date order (stable for equal dates)."""
    balance = opening
    out = []
    for r in sorted(rows, key=lambda r: r["date"]):
        balance += r["amount_cents"]
        out.append(balance)
    return out
