"""Invoices. Tax rules are documented in docs/TAX.md."""
import datetime
import json
from dataclasses import dataclass, field
from pathlib import Path

from .money import format_cents, round_half_up

TAX_RATE_PERCENT = 19  # German standard VAT rate
DISCOUNTS_FILE = Path(__file__).with_name("discounts.json")


class InvalidDiscount(ValueError):
    """Unknown or expired discount code."""


@dataclass
class Line:
    description: str
    unit_cents: int
    quantity: int = 1


@dataclass
class Invoice:
    lines: list[Line] = field(default_factory=list)
    discount_percent: int = 0

    def add(self, description: str, unit_cents: int, quantity: int = 1) -> None:
        if quantity < 1:
            raise ValueError("quantity must be at least 1")
        self.lines.append(Line(description, unit_cents, quantity))

    def apply_discount(self, code: str, today: datetime.date | None = None) -> None:
        """Apply a percentage code from discounts.json. A second code replaces the first."""
        today = today or datetime.date.today()
        codes = {k.upper(): v for k, v in json.loads(DISCOUNTS_FILE.read_text()).items()}
        entry = codes.get(code.strip().upper())
        if entry is None:
            raise InvalidDiscount(f"unknown code {code!r}")
        expires = entry.get("expires")
        if expires and today > datetime.date.fromisoformat(expires):
            raise InvalidDiscount(f"code {code!r} expired on {expires}")
        self.discount_percent = int(entry["percent"])

    def gross(self) -> int:
        return sum(line.unit_cents * line.quantity for line in self.lines)

    def subtotal(self) -> int:
        gross = self.gross()
        return gross - round_half_up(gross * self.discount_percent, 100)

    def tax(self) -> int:
        return round_half_up(self.subtotal() * TAX_RATE_PERCENT, 100)

    def total(self) -> int:
        return self.subtotal() + self.tax()

    def summary(self) -> str:
        return f"subtotal {format_cents(self.subtotal())}, tax {format_cents(self.tax())}, total {format_cents(self.total())}"
