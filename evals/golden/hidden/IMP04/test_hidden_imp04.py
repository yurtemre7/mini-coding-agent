import unittest

from ledger.slug import customer_slug, invoice_slug, product_slug


class HiddenSlugCharacterisation(unittest.TestCase):
    def test_customer(self):
        cases = {"Müller & Söhne GmbH": "muller-sohne-gmbh", "  --ACME--  ": "acme", "": "",
                 "Ça va_bien": "ca-va-bien", "Zoë  O'Neil": "zoe-o-neil"}
        for raw, want in cases.items():
            self.assertEqual(customer_slug(raw), want, raw)

    def test_product_keeps_underscores(self):
        self.assertEqual(product_slug("Mega_Pack 2"), "p-mega_pack-2")
        self.assertEqual(product_slug("SKU__A--B"), "p-sku__a-b")
        self.assertEqual(product_slug("!!!"), "")
        self.assertEqual(product_slug("Crème brûlée"), "p-creme-brulee")

    def test_invoice(self):
        self.assertEqual(invoice_slug("Müller_Bau", 7), "muller-bau-inv-00007")
        self.assertEqual(invoice_slug("", 123456), "-inv-123456")
