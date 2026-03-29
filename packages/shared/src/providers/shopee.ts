import type { SpendRecord, SpendSummary } from '../types/spend'

export type ShopeeRecord = Omit<SpendRecord, 'provider' | 'currency'>

export function createMockShopeeOrder(record: ShopeeRecord): SpendRecord {
  return {
    ...record,
    provider: 'shopee',
    currency: 'PHP',
  }
}

export function summarizeSpend(records: SpendRecord[]): SpendSummary {
  const sorted = [...records].sort((a, b) => a.orderedAt.localeCompare(b.orderedAt))
  const first = sorted.at(0)?.orderedAt ?? new Date().toISOString()
  const last = sorted.at(-1)?.orderedAt ?? first

  return {
    provider: 'shopee',
    transactionCount: records.length,
    totalAmount: records.reduce((total, record) => total + record.amount, 0),
    currency: 'PHP',
    from: first,
    to: last,
  }
}