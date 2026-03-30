import type { ResearchOrderRow } from '@shared/index'

export type OrderLike = Record<string, unknown>
export type OrderSource = 'order_list' | 'all_order_list' | 'unknown'

const SHOPEE_MONEY_DIVISOR = 100_000

export function mapOrderToRow(order: OrderLike, source: OrderSource = 'unknown'): ResearchOrderRow {
  const detail = getByPath(order, '__detail')
  const detailRecord = detail && typeof detail === 'object' ? (detail as Record<string, unknown>) : null

  const orderId =
    toStringValue(getByPath(order, 'info_card.order_id')) ??
    toStringValue(getByPath(detailRecord, 'info_card.parcel_cards.0.order_id')) ??
    toStringValue(getByPath(order, 'order_id')) ??
    'unknown'

  const status =
    toStringValue(getByPath(order, 'status.list_view_status_label.text')) ??
    toStringValue(getByPath(detailRecord, 'status.list_view_status_label.text')) ??
    toStringValue(getByPath(order, 'status.status_label.text')) ??
    toStringValue(getByPath(order, 'status.status_label')) ??
    'unknown_status'

  const shopName =
    toStringValue(getByPath(order, 'info_card.order_list_cards.0.shop_info.shop_name')) ??
    toStringValue(getByPath(detailRecord, 'info_card.parcel_cards.0.shop_info.shop_name')) ??
    toStringValue(getByPath(order, 'shop_info.shop_name')) ??
    toStringValue(getByPath(order, 'shop_name')) ??
    'Unknown shop'

  const itemSummary =
    toStringValue(getByPath(order, 'info_card.order_list_cards.0.product_info.item_groups.0.items.0.name')) ??
    toStringValue(getByPath(detailRecord, 'info_card.parcel_cards.0.product_info.item_groups.0.items.0.name')) ??
    toStringValue(getByPath(order, 'item_brief.item_name')) ??
    'Order items'

  const orderTotalRaw =
    toNumber(getByPath(order, 'info_card.final_total')) ??
    toNumber(getByPath(detailRecord, 'info_card.final_total')) ??
    toNumber(getByPath(order, 'final_total')) ??
    toNumber(getByPath(order, 'total')) ??
    0

  const refundRaw =
    toNumber(getByPath(order, 'refund_info.refund_amount')) ??
    toNumber(getByPath(order, 'refund_info.total_refund_amount')) ??
    toNumber(getByPath(order, 'refund_amount')) ??
    toNumber(getByPath(order, 'refunded_amount')) ??
    0

  const fallbackSubtotalRaw =
    toNumber(getByPath(order, 'info_card.subtotal')) ??
    toNumber(getByPath(detailRecord, 'info_card.subtotal')) ??
    toNumber(getByPath(order, 'subtotal')) ??
    0

  const rowFromDetail = parseDetailFinancial(detailRecord, source)

  const rowFromList = parseListFinancial(order, source)

  const orderTotal = toShopeeMoney(orderTotalRaw, source)
  const merchandiseSubtotal = rowFromDetail.merchandiseSubtotal > 0
    ? rowFromDetail.merchandiseSubtotal
    : rowFromList.merchandiseSubtotal > 0
      ? rowFromList.merchandiseSubtotal
      : toShopeeMoney(fallbackSubtotalRaw, source)

  const hasDetail = detailRecord !== null
  const shippingFee = hasDetail
    ? rowFromDetail.shippingFee
    : inferShippingFeeFromList(order, source)
  const shippingDiscountSubtotal = hasDetail
    ? rowFromDetail.shippingDiscountSubtotal
    : inferShippingDiscountFromList(order, source)
  const shopVoucherDiscount = hasDetail
    ? rowFromDetail.shopVoucherDiscount
    : inferShopVoucherDiscountFromList(order, source)
  const paymentMethod = hasDetail
    ? rowFromDetail.paymentMethod
    : inferPaymentMethodFromList(order)
  const totalSaved = hasDetail
    ? resolveTotalSaved({
        merchandiseSubtotal,
        shippingFee,
        shippingDiscountSubtotal,
        shopVoucherDiscount,
        orderTotal,
        explicitDiscountSubtotal: rowFromDetail.discountSubtotal,
        fallback: Math.max(rowFromDetail.totalSaved, rowFromList.totalSaved),
      })
    : inferTotalSavedFromList(order, source, rowFromList.totalSaved, {
        merchandiseSubtotal,
        shippingFee,
        shippingDiscountSubtotal,
        shopVoucherDiscount,
        orderTotal,
      })

  return {
    orderId,
    orderedAt: resolveOrderedAt(order, detailRecord),
    status,
    shopName,
    amount: orderTotal,
    adjustmentAmount: toShopeeMoney(refundRaw, source),
    merchandiseSubtotal,
    shippingFee,
    shippingDiscountSubtotal,
    shopVoucherDiscount,
    orderTotal,
    paymentMethod,
    totalSaved,
    itemSummary,
  }
}

type ParsedFinancial = {
  merchandiseSubtotal: number
  shippingFee: number
  shippingDiscountSubtotal: number
  shopVoucherDiscount: number
  discountSubtotal: number
  paymentMethod: string
  totalSaved: number
}

type KnownOrderAmounts = {
  merchandiseSubtotal: number
  shippingFee: number
  shippingDiscountSubtotal: number
  shopVoucherDiscount: number
  orderTotal: number
}

function parseDetailFinancial(detail: Record<string, unknown> | null, source: OrderSource): ParsedFinancial {
  if (!detail) {
    return {
      merchandiseSubtotal: 0,
      shippingFee: 0,
      shippingDiscountSubtotal: 0,
      shopVoucherDiscount: 0,
      discountSubtotal: 0,
      paymentMethod: 'Not available in list endpoint',
      totalSaved: 0,
    }
  }

  const infoRows = getByPath(detail, 'info_card.parcel_cards.0.payment_info.info_rows')
  const parsedInfoRows = Array.isArray(infoRows) ? parsePaymentInfoRows(infoRows, source) : null

  const merchandiseSubtotal = parsedInfoRows?.merchandiseSubtotal ??
    toShopeeMoney(
      toNumber(getByPath(detail, 'info_card.subtotal')) ?? 0,
      source,
    )

  const shippingFee = parsedInfoRows?.shippingFee ?? 0
  const shippingDiscountSubtotal = parsedInfoRows?.shippingDiscountSubtotal ?? 0
  const shopVoucherDiscount = parsedInfoRows?.shopVoucherDiscount ?? 0
  const discountSubtotal = parsedInfoRows?.discountSubtotal ?? 0

  const paymentMethod =
    toStringValue(getByPath(detail, 'payment_method.payment_channel_name.text')) ??
    toStringValue(getByPath(detail, 'payment_method.payment_channel_name')) ??
    toStringValue(getByPath(detail, 'payment_method.payment_method_name')) ??
    'Not available in list endpoint'

  const listComputedSavings = computeSavingsFromItemRows(detail, source)

  return {
    merchandiseSubtotal,
    shippingFee,
    shippingDiscountSubtotal,
    shopVoucherDiscount,
    discountSubtotal,
    paymentMethod,
    totalSaved: listComputedSavings,
  }
}

function parseListFinancial(order: Record<string, unknown>, source: OrderSource): ParsedFinancial {
  const subtotalRaw =
    toNumber(getByPath(order, 'info_card.subtotal')) ??
    toNumber(getByPath(order, 'subtotal')) ??
    0

  return {
    merchandiseSubtotal: toShopeeMoney(subtotalRaw, source),
    shippingFee: inferShippingFeeFromList(order, source),
    shippingDiscountSubtotal: inferShippingDiscountFromList(order, source),
    shopVoucherDiscount: inferShopVoucherDiscountFromList(order, source),
    discountSubtotal: 0,
    paymentMethod: inferPaymentMethodFromList(order),
    totalSaved: computeSavingsFromItemRows(order, source),
  }
}

function inferTotalSavedFromList(
  order: Record<string, unknown>,
  source: OrderSource,
  fallback: number,
  knownAmounts: KnownOrderAmounts,
): number {
  const listSaved =
    toNumber(getByPath(order, 'saving_total')) ??
    toNumber(getByPath(order, 'price_info.total_saved')) ??
    toNumber(getByPath(order, 'price_info.saving_total'))

  const computed = resolveTotalSaved({
    ...knownAmounts,
    fallback,
  })

  if (listSaved !== null) {
    return Math.max(0, toShopeeMoney(listSaved, source), computed)
  }

  return computed
}

function inferShippingFeeFromList(order: Record<string, unknown>, source: OrderSource): number {
  const shippingRaw =
    toNumber(getByPath(order, 'price_info.shipping_fee')) ??
    toNumber(getByPath(order, 'price_info.shipping_amount')) ??
    toNumber(getByPath(order, 'shipping.shipping_fee')) ??
    toNumber(getByPath(order, 'shipping_fee'))

  if (shippingRaw === null) {
    return 0
  }

  return Math.max(0, toShopeeMoney(shippingRaw, source))
}

function inferShippingDiscountFromList(order: Record<string, unknown>, source: OrderSource): number {
  const discountRaw =
    toNumber(getByPath(order, 'price_info.shipping_discount_subtotal')) ??
    toNumber(getByPath(order, 'price_info.shipping_discount')) ??
    toNumber(getByPath(order, 'shipping.shipping_discount')) ??
    toNumber(getByPath(order, 'shipping_discount_subtotal'))

  if (discountRaw === null) {
    return 0
  }

  return Math.abs(toShopeeMoney(discountRaw, source))
}

function inferShopVoucherDiscountFromList(order: Record<string, unknown>, source: OrderSource): number {
  const voucherRaw =
    toNumber(getByPath(order, 'price_info.shop_voucher_discount')) ??
    toNumber(getByPath(order, 'price_info.shop_voucher_subtotal')) ??
    toNumber(getByPath(order, 'price_info.shop_voucher')) ??
    toNumber(getByPath(order, 'price_info.seller_voucher_discount')) ??
    toNumber(getByPath(order, 'price_info.seller_voucher_subtotal')) ??
    toNumber(getByPath(order, 'voucher_info.shop_voucher_discount')) ??
    toNumber(getByPath(order, 'shop_voucher_discount'))

  if (voucherRaw === null) {
    return 0
  }

  return Math.abs(toShopeeMoney(voucherRaw, source))
}

function inferPaymentMethodFromList(order: Record<string, unknown>): string {
  const candidate =
    toStringValue(getByPath(order, 'payment_method.payment_channel_name.text')) ??
    toStringValue(getByPath(order, 'payment_method.payment_channel_name')) ??
    toStringValue(getByPath(order, 'payment_method.payment_method_name')) ??
    toStringValue(getByPath(order, 'payment_method.method_name')) ??
    toStringValue(getByPath(order, 'payment_method_name'))

  return candidate ?? 'Not available in list endpoint'
}

function computeSavingsFromItemRows(sourceObject: Record<string, unknown>, source: OrderSource): number {
  const rows = extractItems(sourceObject)
  let total = 0

  for (const item of rows) {
    const itemPriceRaw = toNumber(getByPath(item, 'item_price'))
    const beforeRaw =
      toNumber(getByPath(item, 'price_before_discount')) ??
      toNumber(getByPath(item, 'original_price'))
    const qty = toNumber(getByPath(item, 'amount')) ?? 1

    if (itemPriceRaw === null || beforeRaw === null) {
      continue
    }

    const itemPrice = toShopeeMoney(itemPriceRaw, source)
    const before = toShopeeMoney(beforeRaw, source)
    const quantity = Math.max(1, Math.floor(qty))
    const saved = (before - itemPrice) * quantity

    if (saved > 0) {
      total += saved
    }
  }

  return round2(total)
}

type ParsedInfoRows = {
  merchandiseSubtotal: number
  shippingFee: number
  shippingDiscountSubtotal: number
  shopVoucherDiscount: number
  discountSubtotal: number
}

function parsePaymentInfoRows(rows: unknown[], source: OrderSource): ParsedInfoRows {
  let merchandiseSubtotal = 0
  let shippingFee = 0
  let shippingDiscountSubtotal = 0
  let shopVoucherDiscount = 0
  let discountSubtotal = 0

  for (const row of rows) {
    if (!row || typeof row !== 'object') {
      continue
    }

    const label =
      toStringValue(getByPath(row, 'info_label.text'))?.toLowerCase() ??
      toStringValue(getByPath(row, 'info_label'))?.toLowerCase() ??
      ''

    const valueRaw = toNumber(getByPath(row, 'info_value.value'))
    if (valueRaw === null) {
      continue
    }

    const value = toShopeeMoney(valueRaw, source)

    if (label.includes('merchandise_subtotal')) {
      merchandiseSubtotal = Math.max(merchandiseSubtotal, value)
      continue
    }

    if (label.includes('shipping_discount_subtotal')) {
      shippingDiscountSubtotal += Math.abs(value)
      discountSubtotal += Math.abs(value)
      continue
    }

    if (label.includes('shipping') && !label.includes('discount') && !label.includes('voucher')) {
      shippingFee += Math.abs(value)
      continue
    }

    if (isShopVoucherLabel(label)) {
      shopVoucherDiscount += Math.abs(value)
      discountSubtotal += Math.abs(value)
      continue
    }

    if (label.includes('voucher') || label.includes('discount') || label.includes('coins')) {
      discountSubtotal += Math.abs(value)
    }
  }

  return {
    merchandiseSubtotal: round2(merchandiseSubtotal),
    shippingFee: round2(shippingFee),
    shippingDiscountSubtotal: round2(shippingDiscountSubtotal),
    shopVoucherDiscount: round2(shopVoucherDiscount),
    discountSubtotal: round2(discountSubtotal),
  }
}

function isShopVoucherLabel(label: string): boolean {
  if (!label.includes('voucher')) {
    return false
  }

  return label.includes('shop') || label.includes('seller')
}

function resolveTotalSaved(
  params: KnownOrderAmounts & {
    explicitDiscountSubtotal?: number
    fallback: number
  },
): number {
  const baselineTotal = round2(params.merchandiseSubtotal + params.shippingFee)
  const canInferFromTotal = baselineTotal > 0 && params.orderTotal > 0 && baselineTotal >= params.orderTotal
  const inferredDiscountSubtotal = Math.max(
    0,
    canInferFromTotal ? round2(baselineTotal - params.orderTotal) : 0,
  )
  const knownDiscountSubtotal = round2(
    Math.max(0, params.shippingDiscountSubtotal) + Math.max(0, params.shopVoucherDiscount),
  )
  const explicitDiscountSubtotal = round2(Math.max(0, params.explicitDiscountSubtotal ?? 0))
  const structuredCheckoutSavings = Math.max(knownDiscountSubtotal, explicitDiscountSubtotal)

  if (structuredCheckoutSavings > 0) {
    const checkoutSavings = Math.max(structuredCheckoutSavings, inferredDiscountSubtotal)
    return round2(checkoutSavings + Math.max(0, params.fallback))
  }

  return round2(Math.max(inferredDiscountSubtotal, Math.max(0, params.fallback)))
}

function extractItems(sourceObject: Record<string, unknown>): Record<string, unknown>[] {
  const paths = [
    'info_card.order_list_cards.0.product_info.item_groups.0.items',
    'info_card.parcel_cards.0.product_info.item_groups.0.items',
    'product_info.item_groups.0.items',
  ]

  for (const path of paths) {
    const candidate = getByPath(sourceObject, path)
    if (Array.isArray(candidate)) {
      return candidate.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'))
    }
  }

  return []
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

function resolveOrderedAt(order: OrderLike, detail: Record<string, unknown> | null): string {
  const completedUnix = findUnixTimestampByLabel(detail, 'completed_time')
  if (completedUnix !== null) {
    const completedIso = unixToIso(completedUnix)
    if (completedIso) {
      return completedIso
    }
  }

  const orderUnix = findUnixTimestampByLabel(detail, 'order_time')
  if (orderUnix !== null) {
    const orderIso = unixToIso(orderUnix)
    if (orderIso) {
      return orderIso
    }
  }

  const epoch =
    toNumber(getByPath(order, 'ctime')) ??
    toNumber(getByPath(order, 'info_card.create_time')) ??
    toNumber(getByPath(order, 'shipping.tracking_info.ctime'))

  if (epoch !== null) {
    const fallbackIso = unixToIso(epoch)
    if (fallbackIso) {
      return fallbackIso
    }
  }

  return 'unknown'
}

function findUnixTimestampByLabel(detail: Record<string, unknown> | null, keyword: string): number | null {
  if (!detail) {
    return null
  }

  const rows = getByPath(detail, 'processing_info.info_rows')
  if (!Array.isArray(rows)) {
    return null
  }

  for (const row of rows) {
    if (!row || typeof row !== 'object') {
      continue
    }

    const label = toStringValue(getByPath(row, 'info_label.text'))?.toLowerCase() ?? ''
    if (!label.includes(keyword)) {
      continue
    }

    const raw = toNumber(getByPath(row, 'info_value.value'))
    if (raw !== null) {
      return raw
    }
  }

  return null
}

function unixToIso(unix: number): string | null {
  const milliseconds = unix > 9_999_999_999 ? unix : unix * 1000
  const parsed = new Date(milliseconds)
  if (Number.isNaN(parsed.getTime())) {
    return null
  }

  return parsed.toISOString()
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
