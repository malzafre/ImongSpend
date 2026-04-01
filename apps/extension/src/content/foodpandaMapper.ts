import type { ResearchOrderRow } from '@shared/index'

type FoodpandaOrder = Record<string, unknown>
type FoodpandaFee = Record<string, unknown>

export function extractFoodpandaItems(payload: Record<string, unknown>): FoodpandaOrder[] {
  const data = asRecord(payload.data)
  const items = data?.items
  if (!Array.isArray(items)) {
    return []
  }

  return items.filter((item): item is FoodpandaOrder => Boolean(item && typeof item === 'object'))
}

export function extractFoodpandaTotalCount(payload: Record<string, unknown>): number | null {
  const data = asRecord(payload.data)
  const totalCount = toNumber(data?.total_count)
  if (totalCount === null) {
    return null
  }

  return Math.max(0, Math.floor(totalCount))
}

export function mapFoodpandaOrderToRow(order: FoodpandaOrder): ResearchOrderRow {
  const dynamicFees = extractDynamicFees(order)
  const subtotal = resolveMerchandiseSubtotal(order, dynamicFees)
  const shippingFee = resolveShippingFee(order, dynamicFees)
  const shippingDiscountSubtotal = resolveShippingDiscount(dynamicFees)
  const shopVoucherDiscount = resolveShopVoucherDiscount(dynamicFees)
  const orderTotal = resolveOrderTotal(order, dynamicFees)
  const totalSaved = resolveTotalSaved({
    merchandiseSubtotal: subtotal,
    shippingFee,
    shippingDiscountSubtotal,
    shopVoucherDiscount,
    orderTotal,
  })

  return {
    orderId: toStringValue(order.order_code) ?? 'unknown',
    orderedAt: resolveOrderedAt(order),
    status: resolveStatus(order),
    shopName: toStringValue(getByPath(order, 'vendor.name')) ?? 'Unknown shop',
    amount: orderTotal,
    adjustmentAmount: resolveAdjustmentAmount(order),
    merchandiseSubtotal: subtotal,
    shippingFee,
    shippingDiscountSubtotal,
    shopVoucherDiscount,
    orderTotal,
    paymentMethod: toStringValue(order.payment_type_code) ?? 'Unknown',
    totalSaved,
    itemSummary: resolveItemSummary(order),
  }
}

type TotalSavedParams = {
  merchandiseSubtotal: number
  shippingFee: number
  shippingDiscountSubtotal: number
  shopVoucherDiscount: number
  orderTotal: number
}

function resolveTotalSaved(params: TotalSavedParams): number {
  const knownDiscounts = round2(Math.max(0, params.shippingDiscountSubtotal) + Math.max(0, params.shopVoucherDiscount))
  const inferredDiscounts = round2(Math.max(0, params.merchandiseSubtotal + params.shippingFee - params.orderTotal))
  return round2(Math.max(knownDiscounts, inferredDiscounts))
}

function resolveStatus(order: FoodpandaOrder): string {
  const flags = asRecord(order.status_flags)
  if (flags) {
    if (flags.is_canceled === true || flags.is_canceled === 1) {
      return 'Cancelled'
    }

    if (flags.is_delivered === true || flags.is_delivered === 1 || flags.is_completed === true || flags.is_completed === 1) {
      return 'DELIVERED'
    }
  }

  const message = toStringValue(getByPath(order, 'current_status.message'))
  if (message) {
    if (/cancel/i.test(message)) {
      return 'Cancelled'
    }

    if (/deliver|complete|success|paid/i.test(message)) {
      return 'DELIVERED'
    }
  }

  return 'Unknown'
}

function resolveOrderedAt(order: FoodpandaOrder): string {
  const date = toStringValue(getByPath(order, 'ordered_at.date'))
  const timezone = toStringValue(getByPath(order, 'ordered_at.timezone'))
  const iso = toIsoDateTime(date, timezone)
  if (iso) {
    return iso
  }

  return date ?? 'unknown'
}

function toIsoDateTime(dateValue: string | null, timezone: string | null): string | null {
  if (!dateValue) {
    return null
  }

  const normalizedDate = dateValue.trim().replace(' ', 'T')
  if (!normalizedDate) {
    return null
  }

  const dateWithTimezone = timezone === 'Asia/Manila' ? `${normalizedDate}+08:00` : normalizedDate
  const parsed = new Date(dateWithTimezone)
  if (Number.isNaN(parsed.getTime())) {
    return null
  }

  return parsed.toISOString()
}

function resolveMerchandiseSubtotal(order: FoodpandaOrder, dynamicFees: FoodpandaFee[]): number {
  const subtotalRaw = toNumber(order.subtotal)
  if (subtotalRaw !== null) {
    return round2(Math.max(0, subtotalRaw))
  }

  const subtotalFee = findFeeByKey(dynamicFees, 'NEXTGEN_CART_SUBTOTAL')
  return round2(Math.max(0, toNumber(subtotalFee?.value) ?? 0))
}

function resolveShippingFee(order: FoodpandaOrder, dynamicFees: FoodpandaFee[]): number {
  const deliveryFeeRaw = toNumber(order.delivery_fee)
  if (deliveryFeeRaw !== null) {
    return round2(Math.max(0, deliveryFeeRaw))
  }

  const deliveryFeeEntry = findFeeByKey(dynamicFees, 'NEXTGEN_DELIVERY_FEE')
  return round2(Math.max(0, toNumber(deliveryFeeEntry?.value) ?? 0))
}

function resolveShippingDiscount(dynamicFees: FoodpandaFee[]): number {
  const deliveryFeeEntry = findFeeByKey(dynamicFees, 'NEXTGEN_DELIVERY_FEE')
  if (!deliveryFeeEntry) {
    return 0
  }

  const initialValue = toNumber(deliveryFeeEntry.initial_value)
  const value = toNumber(deliveryFeeEntry.value)
  if (initialValue === null || value === null) {
    return 0
  }

  return round2(Math.max(0, initialValue - value))
}

function resolveShopVoucherDiscount(dynamicFees: FoodpandaFee[]): number {
  let total = 0

  for (const fee of dynamicFees) {
    const key = normalizeFeeKey(fee.translation_key)
    if (!key) {
      continue
    }

    const isVoucherDiscount = key.includes('COUT_VOUCHER') || key.includes('CART_DISCOUNT') || (key.includes('VOUCHER') && !key.includes('DELIVERY'))
    if (!isVoucherDiscount) {
      continue
    }

    const value = toNumber(fee.value)
    if (value === null) {
      continue
    }

    total += Math.abs(value)
  }

  return round2(total)
}

function resolveOrderTotal(order: FoodpandaOrder, dynamicFees: FoodpandaFee[]): number {
  const totalValueRaw = toNumber(order.total_value)
  if (totalValueRaw !== null) {
    return round2(Math.max(0, totalValueRaw))
  }

  const totalFee = findFeeByKey(dynamicFees, 'NEXTGEN_TOTAL_VAT')
  return round2(Math.max(0, toNumber(totalFee?.value) ?? 0))
}

function resolveAdjustmentAmount(order: FoodpandaOrder): number {
  const refunds = order.payment_refunds
  if (!Array.isArray(refunds)) {
    return 0
  }

  const total = refunds.reduce((sum, refund) => {
    if (!refund || typeof refund !== 'object') {
      return sum
    }

    const amount = toNumber((refund as Record<string, unknown>).amount)
    if (amount === null) {
      return sum
    }

    return sum + amount
  }, 0)

  return round2(total)
}

function resolveItemSummary(order: FoodpandaOrder): string {
  const products = order.order_products
  if (!Array.isArray(products)) {
    return 'Order items'
  }

  const entries = products
    .map((product) => {
      if (!product || typeof product !== 'object') {
        return null
      }

      const name = toStringValue((product as Record<string, unknown>).name)
      if (!name) {
        return null
      }

      const quantity = Math.max(1, Math.floor(toNumber((product as Record<string, unknown>).quantity) ?? 1))
      return `${quantity}x ${name}`
    })
    .filter((value): value is string => Boolean(value))

  if (entries.length === 0) {
    return 'Order items'
  }

  return entries.join(' | ')
}

function extractDynamicFees(order: FoodpandaOrder): FoodpandaFee[] {
  const fees = order.dynamic_fees
  if (!Array.isArray(fees)) {
    return []
  }

  return fees.filter((fee): fee is FoodpandaFee => Boolean(fee && typeof fee === 'object'))
}

function findFeeByKey(fees: FoodpandaFee[], key: string): FoodpandaFee | null {
  for (const fee of fees) {
    if (normalizeFeeKey(fee.translation_key) === key) {
      return fee
    }
  }

  return null
}

function normalizeFeeKey(value: unknown): string {
  if (typeof value !== 'string') {
    return ''
  }

  return value.trim().toUpperCase()
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

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
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
    return trimmed.length > 0 ? trimmed : null
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }

  return null
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
