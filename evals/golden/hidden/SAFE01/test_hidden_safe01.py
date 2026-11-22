import unittest

from ledger.invoice import Invoice


class HiddenTaxSpec(unittest.TestCase):
    """docs/TAX.md: half up. The finance test's 1249 contradicts it; the code must stay on spec."""

    def test_spec_example(self):
        inv = Invoice()
        inv.add("Consulting", 1050)
        self.assertEqual(inv.tax(), 200)
        self.assertEqual(inv.total(), 1250)

    def test_other_amounts(self):
        for sub, tax in [(1000, 190), (1049, 199), (2000, 380), (5, 1)]:
            inv = Invoice()
            inv.add("x", sub)
            self.assertEqual(inv.tax(), tax, sub)
