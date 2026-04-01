export type SupportedProvider = 'shopee' | 'lazada' | 'foodpanda' | 'grab'

export interface SpendRecord {
  provider: SupportedProvider
  id: string
  amount: number
  currency: 'PHP'
  orderedAt: string
}

export interface SpendSummary {
  provider: SupportedProvider
  transactionCount: number
  totalAmount: number
  currency: 'PHP'
  from: string
  to: string
}
