export interface ResearchOrderRow {
  orderId: string
  orderedAt: string
  status: string
  amount: number
  adjustmentAmount: number
  itemSummary: string
}

export interface ResearchCalculationResult {
  currency: 'PHP'
  generatedAt: string
  orderCount: number
  completedCount: number
  positiveSpend: number
  totalAdjustments: number
  estimatedGrandTotal: number
  from: string
  to: string
  notes: string[]
  rows: ResearchOrderRow[]
}