"""URL slugs for customers, products and invoices."""
import re
import unicodedata


def _normalise(name: str, keep: str = "") -> str:
    text = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii").lower()
    text = re.sub(rf"[^a-z0-9{keep}]+", "-", text)
    return re.sub(r"-{2,}", "-", text).strip("-")


def customer_slug(name: str) -> str:
    return _normalise(name)


def product_slug(name: str) -> str:
    # SKU codes use underscores, so products keep them
    text = _normalise(name, keep="_")
    return "p-" + text if text else ""


def invoice_slug(customer: str, number: int) -> str:
    return f"{_normalise(customer)}-inv-{number:05d}"
