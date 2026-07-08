export interface MonthlyEntryRow {
  id: string;
  item: string;
  categoryId: string | null;
  budgetedAmount: string;
  actualAmount: string | null;
  actualDate: string | null;
  bankAccountId: string | null;
  recurringScheduleId: string | null;
  isOverridden: boolean;
  categoryName: string | null;
  categoryColor: string | null;
  categoryDirection: 'income' | 'expense' | null;
  accountName: string | null;
  scheduledDay: number | null;
}
