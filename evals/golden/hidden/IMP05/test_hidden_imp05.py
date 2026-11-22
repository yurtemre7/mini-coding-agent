import tempfile
import unittest
from pathlib import Path

from ledger.settings import load_settings


def write(text):
    d = tempfile.mkdtemp()
    p = Path(d) / "ledger.toml"
    p.write_text(text, encoding="utf-8")
    return p


class HiddenSettings(unittest.TestCase):
    def test_full_file(self):
        s = load_settings(write('tax_rate_percent = 7\ncurrency = "USD"\n'))
        self.assertEqual(s, {"tax_rate_percent": 7, "currency": "USD"})

    def test_defaults(self):
        self.assertEqual(load_settings(write("")), {"tax_rate_percent": 19, "currency": "EUR"})

    def test_missing_file_gives_defaults(self):
        self.assertEqual(load_settings(Path(tempfile.mkdtemp()) / "nope.toml"), {"tax_rate_percent": 19, "currency": "EUR"})

    def test_out_of_range(self):
        for bad in ["tax_rate_percent = 101", "tax_rate_percent = -1"]:
            with self.assertRaises(ValueError):
                load_settings(write(bad))

    def test_wrong_type(self):
        with self.assertRaises(ValueError):
            load_settings(write('tax_rate_percent = "19"'))

    def test_unknown_key_rejected(self):
        with self.assertRaises(ValueError):
            load_settings(write("tax_rate = 19"))

    def test_accepts_str_path(self):
        p = write('currency = "CHF"')
        self.assertEqual(load_settings(str(p))["currency"], "CHF")
