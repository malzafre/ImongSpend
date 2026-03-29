import { createMockShopeeOrder, summarizeSpend } from '@shared/providers/shopee'

export function PopupApp() {
  const summary = summarizeSpend([
    createMockShopeeOrder({ id: 'shp-1001', amount: 420, orderedAt: '2026-03-03T12:00:00Z' }),
    createMockShopeeOrder({ id: 'shp-1002', amount: 1890, orderedAt: '2026-03-08T10:30:00Z' }),
    createMockShopeeOrder({ id: 'shp-1003', amount: 745, orderedAt: '2026-03-15T09:00:00Z' }),
  ])

  return (
    <main className="panel">
      <p className="kicker">ImongSpend MVP</p>
      <h1>Shopee Spend Snapshot</h1>
      <p className="amount">PHP {summary.totalAmount.toLocaleString()}</p>
      <p className="subtle">{summary.transactionCount} orders in sample range</p>
      <p className="fineprint">
        This uses placeholder data contracts. Live Shopee ingestion will only ship after
        compliance and technical validation.
      </p>
    </main>
  )
}