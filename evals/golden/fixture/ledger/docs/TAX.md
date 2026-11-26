# Tax rules

- Standard rate: 19 % (TAX_RATE_PERCENT in ledger/invoice.py).
- Tax is computed once on the invoice subtotal, not per line.
- Rounding: half up to the cent (ledger.money.round_half_up). Example: subtotal 10.50 → tax 1.995 → 2.00, total 12.50.
- Discounts reduce the subtotal before tax.
