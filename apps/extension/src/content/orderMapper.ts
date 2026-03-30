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
    toStringValue(getByPath(order, 'status.status_label.text')) ??
    toStringValue(getByPath(order, 'status.status_label')) ??
    'unknown_status'

  const amountRaw =
    toNumber(getByPath(order, 'info_card.final_total')) ??
    toNumber(getByPath(order, 'final_total')) ??
    toNumber(getByPath(order, 'total')) ??
    0

  const refundRaw =
    toNumber(getByPath(order, 'refund_info.refund_amount')) ??
    toNumber(getByPath(order, 'refund_info.total_refund_amount')) ??
    toNumber(getByPath(order, 'refund_amount')) ??
    toNumber(getByPath(order, 'refunded_amount')) ??
    0

  const shopName =
    toStringValue(getByPath(order, 'info_card.order_list_cards.0.shop_info.shop_name')) ??
    toStringValue(getByPath(order, 'shop_info.shop_name')) ??
    toStringValue(getByPath(order, 'shop_name')) ??
    'Unknown shop'

  const itemSummary =
    toStringValue(getByPath(order, 'info_card.order_list_cards.0.product_info.item_groups.0.items.0.name')) ??
    toStringValue(getByPath(order, 'item_brief.item_name')) ??
    'Order items'

  const itemPriceRaw =
    toNumber(getByPath(order, 'info_card.order_list_cards.0.product_info.item_groups.0.items.0.item_price')) ??
    toNumber(getByPath(order, 'info_card.order_list_cards.0.product_info.item_groups.0.items.0.order_price')) ??
    0

  const priceBeforeDiscountRaw =
    toNumber(getByPath(order, 'info_card.order_list_cards.0.product_info.item_groups.0.items.0.price_before_discount')) ??
    toNumber(getByPath(order, 'info_card.order_list_cards.0.product_info.item_groups.0.items.0.original_price')) ??
    0

  const quantity =
    toNumber(getByPath(order, 'info_card.order_list_cards.0.product_info.item_groups.0.items.0.amount')) ?? 1

  const subtotalRaw =
    toNumber(getByPath(order, 'info_card.subtotal')) ??
    toNumber(getByPath(order, 'subtotal')) ??
    0

  const orderTotal = toShopeeMoney(amountRaw, source)
  const subtotal = toShopeeMoney(subtotalRaw, source)
  const unitPaid = toShopeeMoney(itemPriceRaw, source)
  const unitOriginal = toShopeeMoney(priceBeforeDiscountRaw, source)
  const normalizedQuantity = Math.max(1, Math.floor(quantity))

  const merchandiseSubtotal = subtotal > 0 ? subtotal : round2(unitPaid * normalizedQuantity)
  const totalSaved = unitOriginal > 0 && unitPaid > 0
    ? round2(Math.max(0, (unitOriginal - unitPaid) * normalizedQuantity))
    : 0

  return {
    orderId,
    orderedAt: resolveOrderedAt(order),
    status,
    shopName,
    amount: orderTotal,
    adjustmentAmount: toShopeeMoney(refundRaw, source),
    merchandiseSubtotal,
    shippingFee: 0,
    shippingDiscountSubtotal: 0,
    orderTotal,
    paymentMethod: 'Not available in list endpoint',
    totalSaved,
    itemSummary,
  }
}

export function extractDetails(body: Record<string, unknown>): OrderLike[] {
  const allOrderList = getByPath(body, 'new_data.order_or_checkout_data')
  if (Array.isArray(allOrderList)) {
    const mapped = allOrderList
      .map((entry) => {
        if (!entry || typeof entry !== 'object') {
          return null
        }

        const orderListDetail = (entry as Record<string, unknown>).order_list_detail
        return orderListDetail && typeof orderListDetail === 'object'
          ? orderListDetail as OrderLike
          : null
      })
      .filter((entry): entry is OrderLike => entry !== null)

    if (mapped.length > 0) {
      return mapped
    }
  }

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
  const newOffset = toNumber(getByPath(body, 'new_data.next_offset'))
  if (newOffset !== null) {
    return newOffset
  }

  const first = toNumber(getByPath(body, 'data.next_offset'))
  if (first !== null) {
    return first
  }

  return toNumber(getByPath(body, 'data.order_data.next_offset'))
}

export function isCompletedStatus(status: string): boolean {
  return /(label_completed|completed|complete|received|delivered)/i.test(status)
}

export function isCancelledStatus(status: string): boolean {
  return /(label_cancelled|label_canceled|cancelled|canceled|cancel)/i.test(status)
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
