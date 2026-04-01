import type { ResearchCalculationResult, ResearchOrderRow } from '@shared/index'
import { isCancelledStatus, isCompletedStatus } from './orderMapper'

export function buildResearchResult(rowsInput: ResearchOrderRow[], notes: string[]): ResearchCalculationResult {
  const generatedAt = new Date().toISOString()
  const normalizedRows = normalizeAndDedupeRows(rowsInput)

  const completedRows = normalizedRows.filter((row) => isCompletedStatus(row.status))
  const cancelledRows = normalizedRows.filter((row) => isCancelledStatus(row.status))
  const positiveSpend = sum(completedRows.map((row) => row.amount))
  const totalSaved = sum(completedRows.map((row) => row.totalSaved))

  const datedTimestamps = normalizedRows
    .map((row) => parseOrderedAtTimestamp(row.orderedAt))
    .filter((timestamp): timestamp is number => timestamp !== null)

  const from = datedTimestamps.length > 0
    ? new Date(Math.min(...datedTimestamps)).toISOString()
    : 'unknown'
  const to = datedTimestamps.length > 0
    ? new Date(Math.max(...datedTimestamps)).toISOString()
    : 'unknown'

  return {
    currency: 'PHP',
    generatedAt,
    orderCount: normalizedRows.length,
    completedCount: completedRows.length,
    cancelledCount: cancelledRows.length,
    positiveSpend,
    totalSaved,
    from,
    to,
    notes,
    rows: normalizedRows,
  }
}

function normalizeAndDedupeRows(rowsInput: ResearchOrderRow[]): ResearchOrderRow[] {
  const byKey = new Map<string, ResearchOrderRow>()

  for (const row of rowsInput) {
    if (!(row.amount > 0)) {
      continue
    }

    const normalized: ResearchOrderRow = {
      orderId: row.orderId || 'unknown',
      orderedAt: row.orderedAt || 'unknown',
      status: row.status || 'Unknown',
      shopName: row.shopName || 'Unknown shop',
      amount: round2(row.amount),
      adjustmentAmount: round2(row.adjustmentAmount),
      merchandiseSubtotal: round2(row.merchandiseSubtotal),
      shippingFee: round2(row.shippingFee),
      shippingDiscountSubtotal: round2(row.shippingDiscountSubtotal),
      shopVoucherDiscount: round2(row.shopVoucherDiscount),
      orderTotal: round2(row.orderTotal),
      paymentMethod: row.paymentMethod || 'Unknown',
      totalSaved: round2(row.totalSaved),
      itemSummary: row.itemSummary || 'Order items',
    }

    const key = buildDedupKey(normalized)
    if (!byKey.has(key)) {
      byKey.set(key, normalized)
      continue
    }

    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, normalized)
      continue
    }

    if (existing.orderedAt === 'unknown' && normalized.orderedAt !== 'unknown') {
      byKey.set(key, normalized)
    }
  }

  return Array.from(byKey.values()).sort(sortRows)
}

function buildDedupKey(row: ResearchOrderRow): string {
  if (row.orderId !== 'unknown') {
    return `${row.orderId}|${row.amount.toFixed(2)}|${row.orderedAt}`
  }

  return `${row.orderedAt}|${row.amount.toFixed(2)}|${row.status}|${row.itemSummary.slice(0, 60)}`
}

function sortRows(a: ResearchOrderRow, b: ResearchOrderRow): number {
  if (a.orderedAt === 'unknown' && b.orderedAt === 'unknown') {
    return a.orderId.localeCompare(b.orderId)
  }

  if (a.orderedAt === 'unknown') {
    return 1
  }

  if (b.orderedAt === 'unknown') {
    return -1
  }

  return b.orderedAt.localeCompare(a.orderedAt)
}

function sum(values: number[]): number {
  return round2(values.reduce((acc, value) => acc + value, 0))
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function parseOrderedAtTimestamp(value: string): number | null {
  if (!value || value === 'unknown') {
    return null
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  let timestamp = Number.NaN

  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const numeric = Number(trimmed)
    if (Number.isFinite(numeric) && numeric > 0) {
      timestamp = numeric > 9_999_999_999 ? numeric : numeric * 1000
    }
  } else {
    timestamp = new Date(trimmed).getTime()
  }

  if (!Number.isFinite(timestamp)) {
    return null
  }

  if (timestamp < MIN_VALID_ORDER_TIMESTAMP || timestamp > Date.now() + FUTURE_TOLERANCE_MS) {
    return null
  }

  return timestamp
}

const MIN_VALID_ORDER_TIMESTAMP = Date.UTC(2000, 0, 1)
const FUTURE_TOLERANCE_MS = 7 * 24 * 60 * 60 * 1000
