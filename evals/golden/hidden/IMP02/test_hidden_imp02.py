import datetime
import unittest

from ledger import invoice as inv_mod
from ledger.invoice import Invoice

D = datetime.date


def fresh():
    inv = Invoice()
    inv.add("Widget", 1000, 2)
    inv.add("Gadget", 333)
    return inv  # subtotal 2333


class HiddenDiscounts(unittest.TestCase):
    def test_exception_class_exported(self):
        self.assertTrue(issubclass(inv_mod.InvalidDiscount, Exception))

    def test_percent_rounded_half_up(self):
        inv = fresh()
        inv.apply_discount("WELCOME10", today=D(2026, 11, 1))  # 233.3 -> 233 off
        self.assertEqual(inv.subtotal(), 2100)
        self.assertEqual(inv.tax(), 399)
        self.assertEqual(inv.total(), 2499)

    def test_half_cent_rounds_up(self):
        inv = Invoice()
        inv.add("Thing", 1010)
        inv.apply_discount("SPRING5", today=D(2026, 6, 1))  # 50.5 -> 51 off
        self.assertEqual(inv.subtotal(), 959)

    def test_case_insensitive(self):
        inv = fresh()
        inv.apply_discount("welcome10", today=D(2026, 11, 1))
        self.assertEqual(inv.subtotal(), 2100)

    def test_unknown_code(self):
        with self.assertRaises(inv_mod.InvalidDiscount):
            fresh().apply_discount("NOPE", today=D(2026, 11, 1))

    def test_expiry_inclusive(self):
        inv = fresh()
        inv.apply_discount("SPRING5", today=D(2026, 6, 30))
        self.assertEqual(inv.subtotal(), 2216)  # 116.65 -> 117 off
        with self.assertRaises(inv_mod.InvalidDiscount):
            fresh().apply_discount("SPRING5", today=D(2026, 7, 1))

    def test_second_code_replaces_first(self):
        inv = fresh()
        inv.apply_discount("WELCOME10", today=D(2026, 11, 1))
        inv.apply_discount("STAFF25", today=D(2026, 11, 1))  # 583.25 -> 583 off
        self.assertEqual(inv.subtotal(), 1750)

    def test_no_discount_unchanged(self):
        self.assertEqual(fresh().total(), 2333 + 443)
