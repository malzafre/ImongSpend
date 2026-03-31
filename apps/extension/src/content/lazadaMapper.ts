import type { ResearchOrderRow } from '@shared/index'

type NodeLike = {
  id: string
  tag: string
  fields: Record<string, unknown>
}

export type LazadaOrderContext = {
  orderId: string
  shopGroupKey: string
}

type ParsedTotals = {
  merchandiseSubtotal: number
  shippingFee: number
  shippingDiscountSubtotal: number
  shopVoucherDiscount: number
  discountSubtotal: number
  orderTotal: number
  paymentMethod: string
}

export function mapLazadaListModuleToRows(module: Record<string, unknown>): {
  rows: ResearchOrderRow[]
  contexts: LazadaOrderContext[]
} {
  const nodes = extractNodes(module)
  const itemsById = new Map<string, NodeLike>()
  const rows: ResearchOrderRow[] = []
  const contexts: LazadaOrderContext[] = []

  for (const node of nodes) {
    if (node.tag === 'orderItem') {
      itemsById.set(node.id, node)
    }
  }

  for (const node of nodes) {
    if (node.tag !== 'orderShop') {
      continue
    }

    const tradeOrderId = asString(node.fields.tradeOrderId)
    const shopGroupKey = asString(node.fields.shopGroupKey)
    if (!tradeOrderId || !shopGroupKey) {
      continue
    }

    const status = asString(node.fields.status) ?? 'Unknown'
    const shopName = asString(node.fields.name) ?? 'Unknown shop'

    const lineIds = asStringArray(node.fields.tradeOrderLineIds)
    const items = lineIds
      .map((lineId) => itemsById.get(lineId))
      .filter((item): item is NodeLike => Boolean(item))

    const fallbackItems =
      items.length > 0
        ? items
        : Array.from(itemsById.values()).filter(
            (item) =>
              asString(item.fields.tradeOrderId) === tradeOrderId ||
              asString(item.fields.groupId) === shopGroupKey,
          )

    const merchandiseSubtotal = round2(
      fallbackItems.reduce((sum, item) => sum + parseItemLineTotal(item.fields), 0),
    )
    const itemSummary = buildItemSummary(
      fallbackItems
        .map((item) => asString(item.fields.title))
        .filter((title): title is string => Boolean(title)),
    )

    rows.push({
      orderId: tradeOrderId,
      orderedAt: 'unknown',
      status,
      shopName,
      amount: merchandiseSubtotal,
      adjustmentAmount: 0,
      merchandiseSubtotal,
      shippingFee: 0,
      shippingDiscountSubtotal: 0,
      shopVoucherDiscount: 0,
      orderTotal: merchandiseSubtotal,
      paymentMethod: 'Not available in list endpoint',
      totalSaved: 0,
      itemSummary,
    })

    contexts.push({
      orderId: tradeOrderId,
      shopGroupKey,
    })
  }

  return { rows, contexts }
}

export function mapLazadaDetailModuleToRow(
  module: Record<string, unknown>,
  fallbackContext: LazadaOrderContext,
): ResearchOrderRow {
  const nodes = extractNodes(module)
  const orderShopNode =
    nodes.find((node) => node.tag === 'orderShop' && asString(node.fields.tradeOrderId) === fallbackContext.orderId) ??
    nodes.find((node) => node.tag === 'orderShop')
  const detailInfoNode = nodes.find((node) => node.tag === 'detailInfo')
  const totalSummaryNode = nodes.find((node) => node.tag === 'totalSummary')
  const orderItemNodes = nodes.filter((node) => node.tag === 'orderItem')

  const orderId = asString(orderShopNode?.fields.tradeOrderId) ?? fallbackContext.orderId
  const status = asString(orderShopNode?.fields.status) ?? 'Unknown'
  const shopName = asString(orderShopNode?.fields.name) ?? 'Unknown shop'
  const orderedAt =
    toIsoDate(
      asString((detailInfoNode?.fields.extraParam as Record<string, unknown> | undefined)?.createdAt) ??
        asString(((detailInfoNode?.fields.extraParam as Record<string, unknown> | undefined)?.createdAt as Record<
          string,
          unknown
        > | undefined)?.value) ??
        asString(detailInfoNode?.fields.createdAt),
    ) ?? 'unknown'

  const totals = parseTotalSummary(totalSummaryNode?.fields)
  const itemSummary = buildItemSummary(
    orderItemNodes.map((node) => asString(node.fields.title)).filter((title): title is string => Boolean(title)),
  )

  const itemSubtotal = round2(
    orderItemNodes.reduce((sum, node) => sum + parseItemLineTotal(node.fields), 0),
  )

  const merchandiseSubtotal = totals.merchandiseSubtotal > 0 ? totals.merchandiseSubtotal : itemSubtotal
  const orderTotal = totals.orderTotal > 0 ? totals.orderTotal : merchandiseSubtotal
  const computedSavings = Math.max(
    totals.discountSubtotal,
    round2(Math.max(0, merchandiseSubtotal + totals.shippingFee - orderTotal)),
  )

  return {
    orderId,
    orderedAt,
    status,
    shopName,
    amount: orderTotal,
    adjustmentAmount: 0,
    merchandiseSubtotal,
    shippingFee: totals.shippingFee,
    shippingDiscountSubtotal: totals.shippingDiscountSubtotal,
    shopVoucherDiscount: totals.shopVoucherDiscount,
    orderTotal,
    paymentMethod: totals.paymentMethod,
    totalSaved: computedSavings,
    itemSummary,
  }
}

function parseTotalSummary(fields: Record<string, unknown> | undefined): ParsedTotals {
  const fees = Array.isArray(fields?.fees) ? fields.fees : []
  const payments = Array.isArray(fields?.payments) ? fields.payments : []

  let merchandiseSubtotal = 0
  let shippingFee = 0
  let shippingDiscountSubtotal = 0
  let shopVoucherDiscount = 0
  let discountSubtotal = 0

  for (const fee of fees) {
    if (!fee || typeof fee !== 'object') {
      continue
    }

    const feeRecord = fee as Record<string, unknown>
    const key = normalizeLabel(asString(feeRecord.key) ?? '')
    const value = parseMoney(feeRecord.value) || parseMoney(feeRecord.subValue)

    if (key.includes('subtotal')) {
      merchandiseSubtotal = Math.max(merchandiseSubtotal, value)
      continue
    }

    if (isShippingDiscountKey(key)) {
      const abs = Math.abs(value)
      shippingDiscountSubtotal += abs
      discountSubtotal += abs
      continue
    }

    if (key.includes('shipping') && !key.includes('discount') && !key.includes('voucher') && !key.includes('promotion')) {
      shippingFee += Math.abs(value)
      continue
    }

    if (isShopVoucherKey(key)) {
      const abs = Math.abs(value)
      shopVoucherDiscount += abs
      discountSubtotal += abs
      continue
    }

    if (key.includes('coins')) {
      const abs = Math.abs(value)
      shopVoucherDiscount += abs
      discountSubtotal += abs
      continue
    }

    if (key.includes('voucher') || key.includes('discount') || key.includes('coins')) {
      discountSubtotal += Math.abs(value)
    }
  }

  const paymentMethod = extractPaymentMethod(payments)
  const orderTotal = parseMoney(fields?.total)

  return {
    merchandiseSubtotal: round2(merchandiseSubtotal),
    shippingFee: round2(shippingFee),
    shippingDiscountSubtotal: round2(shippingDiscountSubtotal),
    shopVoucherDiscount: round2(shopVoucherDiscount),
    discountSubtotal: round2(discountSubtotal),
    orderTotal,
    paymentMethod,
  }
}

function extractPaymentMethod(payments: unknown[]): string {
  for (const payment of payments) {
    if (!payment || typeof payment !== 'object') {
      continue
    }

    const record = payment as Record<string, unknown>
    const detail = asString(record.value) ?? asString(record.subValue) ?? asString(record.key)
    if (detail && detail.toLowerCase() !== 'paid by') {
      return detail
    }
  }

  return 'Not available in detail endpoint'
}

function isShippingDiscountKey(label: string): boolean {
  if (label.includes('free shipping voucher')) {
    return true
  }

  if (label.includes('shipping fee promotion')) {
    return true
  }

  return label.includes('shipping') && (label.includes('discount') || label.includes('voucher') || label.includes('promotion'))
}

function isShopVoucherKey(label: string): boolean {
  if (label.includes('shop voucher') || label.includes('seller voucher')) {
    return true
  }

  if (label.includes('lazada voucher') || label.includes('lazada bonus')) {
    return true
  }

  return label.includes('voucher') && !label.includes('shipping')
}

function normalizeLabel(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

function extractNodes(module: Record<string, unknown>): NodeLike[] {
  const data = module.data
  if (!data || typeof data !== 'object') {
    return []
  }

  const nodes: NodeLike[] = []
  for (const value of Object.values(data as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') {
      continue
    }

    const node = value as Record<string, unknown>
    const id = asString(node.id)
    const tag = asString(node.tag)
    const fields = node.fields

    if (!id || !tag || !fields || typeof fields !== 'object') {
      continue
    }

    nodes.push({
      id,
      tag,
      fields: fields as Record<string, unknown>,
    })
  }

  return nodes
}

function parseItemLineTotal(fields: Record<string, unknown>): number {
  const unitPrice = parseMoney(fields.price)
  const quantity = asNumber(fields.quantity) ?? 1
  const safeQuantity = Number.isFinite(quantity) ? Math.max(1, Math.floor(quantity)) : 1
  return round2(unitPrice * safeQuantity)
}

function buildItemSummary(items: string[]): string {
  if (items.length === 0) {
    return 'Order items'
  }

  const unique = Array.from(new Set(items.map((item) => item.trim()).filter((item) => item.length > 0)))
  if (unique.length === 0) {
    return 'Order items'
  }

  return unique.slice(0, 3).join(' | ')
}

function toIsoDate(raw: string | null): string | null {
  if (!raw) {
    return null
  }

  const normalized = raw.replace(/^Placed\s+on\s+/i, '').replace(/\s+/g, ' ').trim()
  const parsed = new Date(normalized)
  if (Number.isNaN(parsed.getTime())) {
    return null
  }

  return parsed.toISOString()
}

function parseMoney(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return round2(value)
  }

  if (typeof value !== 'string') {
    return 0
  }

  const upper = value.toUpperCase()
  if (upper.includes('FREE')) {
    return 0
  }

  const normalized = value.replace(/,/g, '').replace(/[^0-9.-]/g, '')
  if (!normalized || normalized === '-' || normalized === '.') {
    return 0
  }

  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? round2(parsed) : 0
}

function asString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }

  return null
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((entry) => asString(entry))
    .filter((entry): entry is string => Boolean(entry))
}

function asNumber(value: unknown): number | null {
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

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
