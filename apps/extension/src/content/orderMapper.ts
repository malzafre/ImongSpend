import type { ResearchOrderRow } from '@shared/index'

export type OrderLike = Record<string, unknown>
export type OrderSource = 'order_list' | 'all_order_list' | 'unknown'

const SHOPEE_MONEY_DIVISOR = 100_000

export function mapOrderToRow(order: OrderLike, source: OrderSource = 'unknown'): ResearchOrderRow {
  const orderId =
    toStringValue(getByPath(order, 'info_card.order_id')) ??
    toStringValue(getByPath(order, 'order_id')) ??
    'unknown'

  const status =
    toStringValue(getByPath(order, 'status.list_view_status_label.text')) ??
    toStringValue(getByPath(order, 'status.status_label')) ??
    'Unknown'

  const amountRaw =
    toNumber(getByPath(order, 'info_card.final_total')) ??
    toNumber(getByPath(order, 'total')) ??
    0

  const refundRaw =
    toNumber(getByPath(order, 'refund_info.refund_amount')) ??
    toNumber(getByPath(order, 'refund_info.total_refund_amount')) ??
    toNumber(getByPath(order, 'refund_amount')) ??
    toNumber(getByPath(order, 'refunded_amount')) ??
    0

  const itemSummary =
    toStringValue(getByPath(order, 'info_card.order_list_cards.0.product_info.item_groups.0.items.0.name')) ??
    toStringValue(getByPath(order, 'item_brief.item_name')) ??
    'Order items'

  return {
    orderId,
    orderedAt: resolveOrderedAt(order),
    status,
    amount: toShopeeMoney(amountRaw, source),
    adjustmentAmount: toShopeeMoney(refundRaw, source),
    itemSummary,
  }
}

export function extractDetails(body: Record<string, unknown>): OrderLike[] {
  const firstPath = getByPath(body, 'data.details_list')
  if (Array.isArray(firstPath)) {
    return firstPath as OrderLike[]
  }

  const secondPath = getByPath(body, 'data.order_data.details_list')
  if (Array.isArray(secondPath)) {
    return secondPath as OrderLike[]
  }

  return []
}

export function extractNextOffset(body: Record<string, unknown>): number | null {
  const first = toNumber(getByPath(body, 'data.next_offset'))
  if (first !== null) {
    return first
  }

  return toNumber(getByPath(body, 'data.order_data.next_offset'))
}

export function isCompletedStatus(status: string): boolean {
  return /(completed|complete|received|delivered)/i.test(status)
}

export function isCancelledStatus(status: string): boolean {
  return /(cancelled|canceled|cancel)/i.test(status)
}

function resolveOrderedAt(order: OrderLike): string {
  const epoch =
    toNumber(getByPath(order, 'ctime')) ??
    toNumber(getByPath(order, 'info_card.create_time')) ??
    toNumber(getByPath(order, 'shipping.tracking_info.ctime'))

  if (epoch !== null) {
    const milliseconds = epoch > 9_999_999_999 ? epoch : epoch * 1000
    const parsed = new Date(milliseconds)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString()
    }
  }

  return 'unknown'
}

function toShopeeMoney(value: number, source: OrderSource): number {
  if (!Number.isFinite(value)) {
    return 0
  }

  if (source === 'order_list' || source === 'all_order_list') {
    return round2(value / SHOPEE_MONEY_DIVISOR)
  }

  if (Number.isInteger(value) && Math.abs(value) >= 10_000) {
    return round2(value / SHOPEE_MONEY_DIVISOR)
  }

  return round2(value)
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function getByPath(source: unknown, path: string): unknown {
  if (!source || typeof source !== 'object') {
    return null
  }

  return path.split('.').reduce<unknown>((current, key) => {
    if (current === null || current === undefined) {
      return null
    }

    if (Array.isArray(current)) {
      const index = Number(key)
      if (Number.isInteger(index) && index >= 0 && index < current.length) {
        return current[index]
      }
      return null
    }

    if (typeof current === 'object' && key in current) {
      return (current as Record<string, unknown>)[key]
    }

    return null
  }, source)
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return null
}

function toStringValue(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? trimmed : null
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }

  return null
}
