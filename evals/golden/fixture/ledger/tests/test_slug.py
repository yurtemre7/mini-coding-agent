import unittest

from ledger.slug import customer_slug, invoice_slug, product_slug


class SlugTests(unittest.TestCase):
    def test_customer(self):
        self.assertEqual(customer_slug("Müller & Söhne GmbH"), "muller-sohne-gmbh")

    def test_product(self):
        self.assertEqual(product_slug("Blue Mug"), "p-blue-mug")

    def test_invoice(self):
        self.assertEqual(invoice_slug("ACME Corp", 42), "acme-corp-inv-00042")
