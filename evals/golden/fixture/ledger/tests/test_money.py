import unittest

from ledger.money import format_cents, round_half_up, to_cents


class ToCentsTests(unittest.TestCase):
    def test_whole_number(self):
        self.assertEqual(to_cents("5"), 500)

    def test_two_decimals(self):
        self.assertEqual(to_cents("19.99"), 1999)

    def test_empty_raises(self):
        with self.assertRaises(ValueError):
            to_cents("  ")


class FormatTests(unittest.TestCase):
    def test_format(self):
        self.assertEqual(format_cents(1999), "19.99")
        self.assertEqual(format_cents(-310), "-3.10")

    def test_round_half_up(self):
        self.assertEqual(round_half_up(19950, 100), 200)
        self.assertEqual(round_half_up(19949, 100), 199)
        self.assertEqual(round_half_up(-19950, 100), -200)
