"""Money helpers. All amounts are integer cents internally."""


def to_cents(amount: str) -> int:
    """Parse a decimal string like "19.99", "-3.1" or " 5 " into integer cents.

    Raises ValueError for empty strings, non-numbers, or more than two decimals.
    """
    amount = amount.strip()
    if not amount:
        raise ValueError("empty amount")
    return int(float(amount) * 100)


def format_cents(cents: int) -> str:
    sign = "-" if cents < 0 else ""
    cents = abs(cents)
    return f"{sign}{cents // 100}.{cents % 100:02d}"


def round_half_up(numerator: int, denominator: int) -> int:
    """Integer division rounded half away from zero."""
    sign = -1 if (numerator < 0) != (denominator < 0) else 1
    n, d = abs(numerator), abs(denominator)
    return sign * ((2 * n + d) // (2 * d))
