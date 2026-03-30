import type { ResearchCalculationResult, ResearchOrderRow } from '@shared/index'
import { isCancelledStatus, isCompletedStatus } from './orderMapper'

export function buildResearchResult(rowsInput: ResearchOrderRow[], notes: string[]): ResearchCalculationResult {
  const generatedAt = new Date().toISOString()
  const normalizedRows = normalizeAndDedupeRows(rowsInput)

  const settledRows = normalizedRows.map((row) => {
    const cancelAdjustment = isCancelledStatus(row.status) ? row.amount : 0
    return {
      ...row,
      adjustmentAmount: round2(row.adjustmentAmount + cancelAdjustment),
    }
  })

  const completedRows = settledRows.filter((row) => isCompletedStatus(row.status))
  const positiveSpend = sum(completedRows.map((row) => row.amount))
  const totalAdjustments = sum(settledRows.map((row) => row.adjustmentAmount))
  const estimatedGrandTotal = round2(positiveSpend - totalAdjustments)

  const datedRows = settledRows.filter((row) => row.orderedAt !== 'unknown')
  const from = datedRows[0]?.orderedAt ?? generatedAt
  const to = datedRows.at(-1)?.orderedAt ?? from

  return {
    currency: 'PHP',
    generatedAt,
    orderCount: settledRows.length,
    completedCount: completedRows.length,
    positiveSpend,
    totalAdjustments,
    estimatedGrandTotal,
    from,
    to,
    notes,
    rows: settledRows,
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
      amount: round2(row.amount),
      adjustmentAmount: round2(row.adjustmentAmount),
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

  return a.orderedAt.localeCompare(b.orderedAt)
}

function sum(values: number[]): number {
  return round2(values.reduce((acc, value) => acc + value, 0))
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
