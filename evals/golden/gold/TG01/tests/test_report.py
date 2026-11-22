import unittest

from ledger.report import largest_expense, monthly_totals, running_balance

ROWS = [
    {"date": "2026-10-05", "description": "Coffee", "amount_cents": -1250},
    {"date": "2026-09-30", "description": "Salary", "amount_cents": 300000},
    {"date": "2026-10-01", "description": "Rent", "amount_cents": -95000},
    {"date": "2025-10-15", "description": "Old refund", "amount_cents": 500},
]


class MonthlyTotals(unittest.TestCase):
    def test_groups_by_year_and_month_in_order(self):
        self.assertEqual(list(monthly_totals(ROWS).items()),
                         [("2025-10", 500), ("2026-09", 300000), ("2026-10", -96250)])

    def test_empty(self):
        self.assertEqual(monthly_totals([]), {})


class LargestExpense(unittest.TestCase):
    def test_most_negative(self):
        self.assertEqual(largest_expense(ROWS)["description"], "Rent")

    def test_none_without_expenses(self):
        self.assertIsNone(largest_expense([{"date": "2026-01-01", "description": "Zero", "amount_cents": 0},
                                           {"date": "2026-01-02", "description": "In", "amount_cents": 10}]))


class RunningBalance(unittest.TestCase):
    def test_date_order_and_opening(self):
        self.assertEqual(running_balance(ROWS, opening=1000), [1500, 301500, 206500, 205250])

    def test_default_opening(self):
        self.assertEqual(running_balance(ROWS[:1]), [-1250])
