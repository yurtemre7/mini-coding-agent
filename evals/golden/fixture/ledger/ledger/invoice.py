"""Invoices. Tax rules are documented in docs/TAX.md."""
from dataclasses import dataclass, field

from .money import format_cents, round_half_up

TAX_RATE_PERCENT = 19  # German standard VAT rate


@dataclass
class Line:
    description: str
    unit_cents: int
    quantity: int = 1


@dataclass
class Invoice:
    lines: list[Line] = field(default_factory=list)

    def add(self, description: str, unit_cents: int, quantity: int = 1) -> None:
        if quantity < 1:
            raise ValueError("quantity must be at least 1")
        self.lines.append(Line(description, unit_cents, quantity))

    def subtotal(self) -> int:
        return sum(line.unit_cents * line.quantity for line in self.lines)

    def tax(self) -> int:
        return round_half_up(self.subtotal() * TAX_RATE_PERCENT, 100)

    def total(self) -> int:
        return self.subtotal() + self.tax()

    def summary(self) -> str:
        return f"subtotal {format_cents(self.subtotal())}, tax {format_cents(self.tax())}, total {format_cents(self.total())}"
