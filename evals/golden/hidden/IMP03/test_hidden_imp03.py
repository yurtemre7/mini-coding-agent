import pathlib
import unittest

from ledger.csv_import import parse_rows

SAMPLE = pathlib.Path(__file__).resolve().parent.parent / "samples" / "sparkasse_export.csv"


class HiddenImport(unittest.TestCase):
    def test_sparkasse_sample_file(self):
        rows = parse_rows(SAMPLE.read_text(encoding="utf-8"))
        self.assertEqual([r["amount_cents"] for r in rows], [-95000, 240000, -1250])
        self.assertEqual(rows[0]["date"], "2026-10-01")
        self.assertEqual(rows[1]["description"], "Client payment ACME")

    def test_bom_only(self):
        rows = parse_rows("﻿date,description,amount\n2026-10-01,Rent,-950.00\n")
        self.assertEqual(rows[0]["date"], "2026-10-01")

    def test_spaces_in_header_only(self):
        rows = parse_rows("date, description, amount\n2026-10-01,Rent,-950.00\n")
        self.assertEqual(rows[0]["amount_cents"], -95000)

    def test_plain_still_works(self):
        rows = parse_rows("date,description,amount\n2026-10-02,Bread,-3.00\n")
        self.assertEqual(rows, [{"date": "2026-10-02", "description": "Bread", "amount_cents": -300}])
