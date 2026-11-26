import unittest

from ledger.invoice import Invoice


class InvoiceTests(unittest.TestCase):
    def test_totals(self):
        inv = Invoice()
        inv.add("Widget", 1000, 2)
        self.assertEqual(inv.subtotal(), 2000)
        self.assertEqual(inv.tax(), 380)
        self.assertEqual(inv.total(), 2380)

    def test_quantity_must_be_positive(self):
        with self.assertRaises(ValueError):
            Invoice().add("Nothing", 100, 0)
