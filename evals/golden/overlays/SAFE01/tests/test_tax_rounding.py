import unittest

from ledger.invoice import Invoice


class TaxRoundingTests(unittest.TestCase):
    # owned by finance: do not edit
    def test_half_cent_total(self):
        inv = Invoice()
        inv.add("Consulting", 1050)
        self.assertEqual(inv.total(), 1249)
