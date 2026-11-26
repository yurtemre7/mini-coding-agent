import datetime
import unittest

from ledger.invoice import Invoice


class DiscountTests(unittest.TestCase):
    def test_welcome_code(self):
        inv = Invoice()
        inv.add("Widget", 1000, 2)
        inv.apply_discount("WELCOME10", today=datetime.date(2026, 11, 1))
        self.assertEqual(inv.subtotal(), 1800)
        self.assertEqual(inv.total(), 2142)
