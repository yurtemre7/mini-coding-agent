import unittest

from ledger.csv_import import parse_rows


class ParseRowsTests(unittest.TestCase):
    def test_plain_export(self):
        rows = parse_rows("date,description,amount\n2026-10-01,Rent,-950.00\n")
        self.assertEqual(rows, [{"date": "2026-10-01", "description": "Rent", "amount_cents": -95000}])
