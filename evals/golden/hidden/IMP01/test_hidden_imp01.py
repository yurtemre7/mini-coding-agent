import unittest

from ledger.money import to_cents


class HiddenToCents(unittest.TestCase):
    def test_float_trap_values(self):
        for s, c in [("19.99", 1999), ("0.29", 29), ("4.35", 435), ("1.15", 115), ("0.07", 7)]:
            self.assertEqual(to_cents(s), c, s)

    def test_negative(self):
        self.assertEqual(to_cents("-0.29"), -29)
        self.assertEqual(to_cents("-3.1"), -310)

    def test_whitespace_and_whole(self):
        self.assertEqual(to_cents("  5 "), 500)
        self.assertEqual(to_cents("1200"), 120000)

    def test_rejects_three_decimals(self):
        with self.assertRaises(ValueError):
            to_cents("1.234")

    def test_rejects_garbage(self):
        for s in ["abc", "1.2.3", ""]:
            with self.assertRaises(ValueError):
                to_cents(s)
