export interface ResearchOrderRow {
  orderId: string
  orderedAt: string
  status: string
  shopName: string
  amount: number
  adjustmentAmount: number
  merchandiseSubtotal: number
  shippingFee: number
  shippingDiscountSubtotal: number
  shopVoucherDiscount: number
  orderTotal: number
  paymentMethod: string
  totalSaved: number
  itemSummary: string
}

export interface ResearchCalculationResult {
  currency: 'PHP'
  generatedAt: string
  orderCount: number
  completedCount: number
  cancelledCount: number
  positiveSpend: number
  totalSaved: number
  totalAdjustments: number
  estimatedGrandTotal: number
  from: string
  to: string
  notes: string[]
  rows: ResearchOrderRow[]
}
