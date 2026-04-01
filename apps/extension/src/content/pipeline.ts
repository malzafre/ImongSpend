import type { ResearchOrderRow } from '@shared/index'
import {
  mapLazadaDetailModuleToRow,
  mapLazadaListModuleToRows,
  type LazadaOrderContext,
} from './lazadaMapper'
import {
  extractFoodpandaItems,
  extractFoodpandaTotalCount,
  mapFoodpandaOrderToRow,
} from './foodpandaMapper'
import { extractDetails, extractNextOffset, mapOrderToRow, type OrderSource } from './orderMapper'

type RuntimeLike = {
  runtime?: {
    getURL?: (path: string) => string
  }
}

type BridgeResult = {
  ok: boolean
  payload?: string
  error?: string
}

type CollectionResult = {
  rows: ResearchOrderRow[]
  notes: string[]
}

export type ResearchProvider = 'shopee' | 'lazada' | 'foodpanda'

type EndpointConfig = {
  key: 'order_list' | 'all_order_list'
  build: (offset: number) => string
}

const PAGE_COMMAND_EVENT = '__IMONGSPEND_PAGE_COMMAND__'
const PAGE_FETCH_RESULT_EVENT = '__IMONGSPEND_PAGE_FETCH_RESULT__'

const runtime = (globalThis as { chrome?: RuntimeLike }).chrome
let bridgeLoadPromise: Promise<void> | null = null

const ENDPOINT_GET_ALL_ORDER_AND_CHECKOUT_LIST = '/api/v4/order/get_all_order_and_checkout_list'
const ENDPOINT_GET_ORDER_LIST = '/api/v4/order/get_order_list'
const LAZADA_SYNC_ORDER_LIST_ENDPOINT = '/customer/api/sync/order-list'
const LAZADA_ASYNC_ORDER_LIST_ENDPOINT = '/customer/api/async/order-list'
const LAZADA_ORDER_DETAIL_ENDPOINT = '/customer/api/sync/order-detail'
const FOODPANDA_ORDER_HISTORY_ENDPOINT = 'https://ph.fd-api.com/api/v5/orders/order_history'
const FOODPANDA_PAGE_SIZE = 20

const lazadaOrderContextById = new Map<string, LazadaOrderContext>()

export async function collectRowsForProvider(
  provider: ResearchProvider,
  maxPages: number,
): Promise<CollectionResult> {
  if (provider === 'lazada') {
    return collectLazadaRowsViaContentApi(maxPages)
  }

  if (provider === 'foodpanda') {
    return collectFoodpandaRowsViaContentApi(maxPages)
  }

  return collectRowsViaPageBridge(maxPages)
}

export async function collectRowsFallbackForProvider(
  provider: ResearchProvider,
  maxPages: number,
): Promise<CollectionResult> {
  if (provider === 'lazada') {
    return collectLazadaRowsViaContentApi(maxPages)
  }

  if (provider === 'foodpanda') {
    return collectFoodpandaRowsViaContentApi(maxPages)
  }

  return collectRowsViaContentApi(maxPages)
}

export async function collectOrderDetailsForProvider(
  provider: ResearchProvider,
  orderIds: string[],
): Promise<ResearchOrderRow[]> {
  if (provider === 'lazada') {
    return collectLazadaOrderDetailsViaContentApi(orderIds)
  }

  if (provider === 'foodpanda') {
    return []
  }

  return collectOrderDetailsViaPageBridge(orderIds)
}

export async function collectRowsViaPageBridge(maxPages: number): Promise<CollectionResult> {
  await ensurePageBridge()

  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const payload = await new Promise<BridgeResult>((resolve) => {
    const onResult = (event: Event): void => {
      const customEvent = event as CustomEvent<{
        requestId?: string
        ok?: boolean
        payload?: string
        error?: string
      }>

      if (customEvent.detail?.requestId !== requestId) {
        return
      }

      window.removeEventListener(PAGE_FETCH_RESULT_EVENT, onResult as EventListener)
      resolve({
        ok: customEvent.detail?.ok === true,
        payload: customEvent.detail?.payload,
        error: customEvent.detail?.error,
      })
    }

    window.addEventListener(PAGE_FETCH_RESULT_EVENT, onResult as EventListener)
    window.dispatchEvent(
      new CustomEvent(PAGE_COMMAND_EVENT, {
        detail: {
          type: 'RUN_FETCH',
          requestId,
          maxPages,
          delayMs: 320,
          includeOrderDetail: false,
          detailDelayMs: 700,
          maxDetailFetch: 0,
        },
      }),
    )
  })

  if (!payload.ok) {
    throw new Error(payload.error ?? 'Page bridge fetch failed.')
  }

  if (!payload.payload) {
    throw new Error('Page bridge returned empty payload.')
  }

  const parsed = JSON.parse(payload.payload) as {
    orders?: unknown[]
    endpoint?: string
  }
  const orders = Array.isArray(parsed.orders) ? parsed.orders : []
  const endpointLabel = parsed.endpoint ?? ENDPOINT_GET_ALL_ORDER_AND_CHECKOUT_LIST

  const source: OrderSource = endpointLabel.includes('get_order_list')
    ? 'order_list'
    : endpointLabel.includes('get_all_order_and_checkout_list')
      ? 'all_order_list'
      : 'unknown'

  const rows = orders
    .map((order) => mapOrderToRow(order as Record<string, unknown>, source))
    .filter((row) => row.orderId !== 'unknown' || row.amount > 0)

  if (rows.length === 0) {
    throw new Error('No rows returned from page bridge.')
  }

  return {
    rows,
    notes: [],
  }
}

export async function collectOrderDetailsViaPageBridge(orderIds: string[]): Promise<ResearchOrderRow[]> {
  await ensurePageBridge()

  const normalizedIds = Array.from(
    new Set(
      orderIds
        .map((orderId) => orderId.trim())
        .filter((orderId) => orderId.length > 0 && orderId !== 'unknown'),
    ),
  )

  if (normalizedIds.length === 0) {
    return []
  }

  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const payload = await new Promise<BridgeResult>((resolve) => {
    const onResult = (event: Event): void => {
      const customEvent = event as CustomEvent<{
        requestId?: string
        ok?: boolean
        payload?: string
        error?: string
      }>

      if (customEvent.detail?.requestId !== requestId) {
        return
      }

      window.removeEventListener(PAGE_FETCH_RESULT_EVENT, onResult as EventListener)
      resolve({
        ok: customEvent.detail?.ok === true,
        payload: customEvent.detail?.payload,
        error: customEvent.detail?.error,
      })
    }

    window.addEventListener(PAGE_FETCH_RESULT_EVENT, onResult as EventListener)
    window.dispatchEvent(
      new CustomEvent(PAGE_COMMAND_EVENT, {
        detail: {
          type: 'RUN_DETAIL_FETCH',
          requestId,
          orderIds: normalizedIds,
        },
      }),
    )
  })

  if (!payload.ok) {
    throw new Error(payload.error ?? 'Page bridge detail fetch failed.')
  }

  if (!payload.payload) {
    throw new Error('Page bridge returned empty detail payload.')
  }

  const parsed = JSON.parse(payload.payload) as {
    orders?: unknown[]
  }
  const orders = Array.isArray(parsed.orders) ? parsed.orders : []

  return orders
    .map((order) => mapOrderToRow(order as Record<string, unknown>, 'unknown'))
    .filter((row) => row.orderId !== 'unknown')
}

export async function collectRowsViaContentApi(maxPages: number): Promise<CollectionResult> {
  const endpoints: EndpointConfig[] = [
    {
      key: 'all_order_list',
      build: (offset) => `${ENDPOINT_GET_ALL_ORDER_AND_CHECKOUT_LIST}?_oft=0&limit=20&offset=${offset}`,
    },
    {
      key: 'order_list',
      build: (offset) => `${ENDPOINT_GET_ORDER_LIST}?limit=20&list_type=3&offset=${offset}`,
    },
  ]

  const errors: string[] = []

  for (const endpoint of endpoints) {
    const rows: ResearchOrderRow[] = []
    const visitedOffsets = new Set<number>()
    let offset = 0
    let page = 0

    try {
      while (page < maxPages) {
        if (visitedOffsets.has(offset)) {
          break
        }

        visitedOffsets.add(offset)
        const body = await fetchPage(endpoint.build(offset))
        const details = extractDetails(body)
        if (details.length === 0) {
          break
        }

        for (const order of details) {
          rows.push(mapOrderToRow(order, endpoint.key))
        }

        const nextOffset = extractNextOffset(body)
        if (nextOffset === null || nextOffset < 0 || nextOffset === offset) {
          break
        }

        offset = nextOffset
        page += 1
      }

      if (rows.length > 0) {
        const firstUrl = endpoint.build(0).split('?')[0]
        void firstUrl
        return {
          rows,
          notes: [],
        }
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Unknown content API error')
    }
  }

  throw new Error(errors.join(' | ') || 'No API rows returned.')
}

async function collectFoodpandaRowsViaContentApi(maxPages: number): Promise<CollectionResult> {
  const rows: ResearchOrderRow[] = []
  const seenOrderIds = new Set<string>()
  let offset = 0
  let page = 0
  let totalCount: number | null = null

  while (page < maxPages) {
    const body = await fetchFoodpandaOrderHistory(offset, FOODPANDA_PAGE_SIZE)
    const items = extractFoodpandaItems(body)
    if (items.length === 0) {
      break
    }

    const reportedTotalCount = extractFoodpandaTotalCount(body)
    if (reportedTotalCount !== null) {
      totalCount = reportedTotalCount
    }

    for (const item of items) {
      const row = mapFoodpandaOrderToRow(item)
      if (seenOrderIds.has(row.orderId)) {
        continue
      }

      seenOrderIds.add(row.orderId)
      rows.push(row)
    }

    offset += items.length
    page += 1

    if (items.length < FOODPANDA_PAGE_SIZE) {
      break
    }

    if (totalCount !== null && offset >= totalCount) {
      break
    }

    await sleep(240)
  }

  if (rows.length === 0) {
    throw new Error('No Foodpanda order history rows were returned from the current account.')
  }

  return {
    rows,
    notes: [],
  }
}

export async function withStageTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: number | undefined

  try {
    const timeoutPromise = new Promise<T>((_, reject) => {
      timer = window.setTimeout(() => reject(new Error(message)), timeoutMs)
    })

    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timer !== undefined) {
      window.clearTimeout(timer)
    }
  }
}

async function collectLazadaRowsViaContentApi(maxPages: number): Promise<CollectionResult> {
  lazadaOrderContextById.clear()

  const firstPayload = await fetchLazadaOrderListSync()
  let moduleData = extractLazadaModule(firstPayload, 'Unexpected Lazada order list payload for page 1.')

  const firstMapped = mapLazadaListModuleToRows(moduleData)
  storeLazadaOrderContexts(firstMapped.contexts)

  const lifecycle = asRecord(moduleData.lifecycle)
  const totalPageNum = Math.max(1, Math.floor(asNumber(lifecycle?.totalPageNum) ?? 1))
  const finalPage = Math.max(1, Math.min(maxPages, totalPageNum))

  for (let pageNum = 2; pageNum <= finalPage; pageNum += 1) {
    const requestBody = buildLazadaAsyncOrderListRequest(moduleData, pageNum, totalPageNum)
    const payload = await fetchLazadaOrderListAsync(requestBody)
    moduleData = extractLazadaModule(payload, `Unexpected Lazada order list payload for page ${pageNum}.`)

    const mapped = mapLazadaListModuleToRows(moduleData)
    storeLazadaOrderContexts(mapped.contexts)
    await sleep(320)
  }

  const contexts = Array.from(lazadaOrderContextById.values())
  if (contexts.length === 0) {
    throw new Error('No Lazada orders were returned from the current account.')
  }

  const rows = await collectLazadaOrderDetailsViaContentApi(contexts.map((context) => context.orderId))

  if (rows.length === 0) {
    throw new Error('No Lazada order details were returned from the current account.')
  }

  return {
    rows,
    notes: [
      `Lazada calculation used order-detail enrichment for ${rows.length} order(s) to improve accuracy.`,
    ],
  }
}

async function collectLazadaOrderDetailsViaContentApi(orderIds: string[]): Promise<ResearchOrderRow[]> {
  const normalizedIds = Array.from(
    new Set(
      orderIds
        .map((orderId) => orderId.trim())
        .filter((orderId) => orderId.length > 0 && orderId !== 'unknown'),
    ),
  )

  if (normalizedIds.length === 0) {
    return []
  }

  const missingContextOrderIds = normalizedIds.filter((orderId) => !lazadaOrderContextById.has(orderId))
  if (missingContextOrderIds.length > 0) {
    throw new Error(
      `Lazada detail context is missing for ${missingContextOrderIds.length} order(s). Recalculate before downloading CSV.`,
    )
  }

  const queue: LazadaOrderContext[] = normalizedIds
    .map((orderId) => lazadaOrderContextById.get(orderId))
    .filter((context): context is LazadaOrderContext => Boolean(context))
  const rowsByOrderId = new Map<string, ResearchOrderRow>()
  const workerCount = Math.max(1, Math.min(2, queue.length))

  const workers = Array.from({ length: workerCount }, async () => {
    while (queue.length > 0) {
      const context = queue.shift()
      if (!context) {
        break
      }

      const payload = await fetchLazadaOrderDetail(context)
      const moduleData = extractLazadaModule(
        payload,
        `Unexpected Lazada order detail payload for order ${context.orderId}.`,
      )
      rowsByOrderId.set(context.orderId, mapLazadaDetailModuleToRow(moduleData, context))
      await sleep(260 + Math.floor(Math.random() * 180))
    }
  })

  await Promise.all(workers)

  return normalizedIds
    .map((orderId) => rowsByOrderId.get(orderId))
    .filter((row): row is ResearchOrderRow => Boolean(row))
}

async function fetchLazadaOrderListSync(): Promise<Record<string, unknown>> {
  const response = await fetch(`${window.location.origin}${LAZADA_SYNC_ORDER_LIST_ENDPOINT}`, {
    method: 'POST',
    credentials: 'include',
    headers: buildLazadaJsonHeaders(),
    body: JSON.stringify({ ultronVersion: '2.0' }),
  })

  if (!response.ok) {
    throw new Error(`Lazada order-list returned HTTP ${response.status}.`)
  }

  return (await response.json()) as Record<string, unknown>
}

async function fetchLazadaOrderListAsync(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(`${window.location.origin}${LAZADA_ASYNC_ORDER_LIST_ENDPOINT}`, {
    method: 'POST',
    credentials: 'include',
    headers: buildLazadaJsonHeaders(),
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error(`Lazada async order-list returned HTTP ${response.status}.`)
  }

  return (await response.json()) as Record<string, unknown>
}

async function fetchLazadaOrderDetail(context: LazadaOrderContext): Promise<Record<string, unknown>> {
  const response = await fetch(`${window.location.origin}${LAZADA_ORDER_DETAIL_ENDPOINT}`, {
    method: 'POST',
    credentials: 'include',
    headers: buildLazadaJsonHeaders(),
    body: JSON.stringify({
      ultronVersion: '4.5',
      tradeOrderId: context.orderId,
      shopGroupKey: context.shopGroupKey,
    }),
  })

  if (!response.ok) {
    throw new Error(`Lazada order-detail returned HTTP ${response.status} for order ${context.orderId}.`)
  }

  return (await response.json()) as Record<string, unknown>
}

function buildLazadaJsonHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    accept: 'application/json, text/plain, */*',
    'content-type': 'application/json;charset=UTF-8',
    'x-requested-with': 'XMLHttpRequest',
  }

  const csrf = extractLazadaCsrfToken()
  if (csrf) {
    headers['x-csrf-token'] = csrf
  }

  return headers
}

function extractLazadaCsrfToken(): string | null {
  const candidates = ['_csrf_token', 'csrftoken', 'csrfToken', 'x-csrf-token']
  for (const name of candidates) {
    const value = extractCookieValue(name)
    if (value) {
      return value
    }
  }

  return null
}

function extractLazadaModule(payload: Record<string, unknown>, errorMessage: string): Record<string, unknown> {
  const moduleData = asRecord(payload.module)
  if (!moduleData) {
    throw new Error(errorMessage)
  }

  return moduleData
}

function buildLazadaAsyncOrderListRequest(
  moduleData: Record<string, unknown>,
  pageNum: number,
  totalPageNum: number,
): Record<string, unknown> {
  const data = asRecord(moduleData.data)
  const linkage = asRecord(moduleData.linkage)
  const linkageCommon = asRecord(linkage?.common)
  const hierarchy = asRecord(moduleData.hierarchy)
  const hierarchyStructure = asRecord(hierarchy?.structure)
  const lifecycle = asRecord(moduleData.lifecycle)

  if (!data || !linkage || !linkageCommon || !hierarchyStructure || !lifecycle) {
    throw new Error('Lazada async order-list request data is incomplete. Endpoint contract may have changed.')
  }

  const rootNodeId = asString(hierarchy?.root)
  const operator =
    rootNodeId && data[rootNodeId] !== undefined
      ? rootNodeId
      : Object.keys(data).find((key) => key.startsWith('orderList_'))

  if (!operator || data[operator] === undefined) {
    throw new Error('Lazada order-list operator was not found. Endpoint contract may have changed.')
  }

  const queryParams = asString(linkageCommon.queryParams)
  const signature = asString(linkage.signature)
  if (!queryParams || !signature) {
    throw new Error('Lazada order-list linkage token was missing. Endpoint contract may have changed.')
  }

  const pageSize = Math.max(1, Math.floor(asNumber(lifecycle.pageSize) ?? 10))

  return {
    operator,
    data: {
      [operator]: data[operator],
    },
    linkage: {
      common: {
        compress: true,
        queryParams,
      },
      signature,
    },
    hierarchy: {
      structure: hierarchyStructure,
    },
    lifecycle: {
      isForceClearCache: true,
      pageSize,
      totalPageNum,
      pageNum,
    },
    params: {
      ultronVersion: '2.0',
    },
  }
}

function storeLazadaOrderContexts(contexts: LazadaOrderContext[]): void {
  for (const context of contexts) {
    lazadaOrderContextById.set(context.orderId, context)
  }
}

async function fetchFoodpandaOrderHistory(offset: number, limit: number): Promise<Record<string, unknown>> {
  const normalizedOffset = Math.max(0, Math.floor(offset))
  const normalizedLimit = Math.max(1, Math.floor(limit))
  const requestUrl = `${FOODPANDA_ORDER_HISTORY_ENDPOINT}?language_id=1&offset=${normalizedOffset}&limit=${normalizedLimit}&item_replacement=true&include=order_products,order_details`

  const headers: Record<string, string> = {
    accept: 'application/json, text/plain, */*',
    'x-fp-api-key': 'volo',
  }

  const authToken = extractFoodpandaAuthToken()
  if (!authToken) {
    throw new Error('Foodpanda auth token not found. Refresh Foodpanda orders page, then retry.')
  }

  headers.authorization = `Bearer ${authToken}`

  const response = await fetch(requestUrl, {
    method: 'GET',
    credentials: 'omit',
    headers,
  })

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('Foodpanda API authorization failed. Open Foodpanda orders page while logged in, then retry.')
    }

    throw new Error(`Foodpanda API returned HTTP ${response.status}.`)
  }

  return (await response.json()) as Record<string, unknown>
}

async function fetchPage(url: string): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    accept: 'application/json, text/plain, */*',
    'x-requested-with': 'XMLHttpRequest',
  }

  const csrf = extractCookieValue('csrftoken')
  if (csrf) {
    headers['x-csrftoken'] = csrf
  }

  const response = await fetch(url, {
    credentials: 'include',
    headers,
  })

  if (!response.ok) {
    throw new Error(`Shopee API returned HTTP ${response.status}.`)
  }

  return (await response.json()) as Record<string, unknown>
}

async function ensurePageBridge(): Promise<void> {
  if (bridgeLoadPromise) {
    return bridgeLoadPromise
  }

  bridgeLoadPromise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById('imongspend-page-bridge')
    if (existing) {
      resolve()
      return
    }

    const bridgeUrl = runtime?.runtime?.getURL?.('page-bridge.js')
    if (!bridgeUrl) {
      reject(new Error('Cannot resolve page bridge URL.'))
      return
    }

    const script = document.createElement('script')
    script.id = 'imongspend-page-bridge'
    script.src = bridgeUrl
    script.onload = () => {
      script.remove()
      resolve()
    }
    script.onerror = () => {
      script.remove()
      reject(new Error('Page bridge blocked by CSP.'))
    }

    ;(document.head || document.documentElement).appendChild(script)
  })

  try {
    await bridgeLoadPromise
  } catch (error) {
    bridgeLoadPromise = null
    throw error
  }
}

function extractCookieValue(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]+)`))
  return match?.[1] ?? null
}

function extractFoodpandaAuthToken(): string | null {
  const tokenCandidates = new Set<string>()

  const collectFromRaw = (raw: string | null): void => {
    for (const candidate of extractPossibleTokens(raw)) {
      tokenCandidates.add(candidate)
    }
  }

  const storages: Array<Storage | null> = []

  try {
    storages.push(window.localStorage)
  } catch {
    void 0
  }

  try {
    storages.push(window.sessionStorage)
  } catch {
    void 0
  }

  const exactKeyCandidates = [
    'token',
    'accessToken',
    'access_token',
    'authToken',
    'auth_token',
    'authorization',
  ]

  for (const storage of storages) {
    if (!storage) {
      continue
    }

    for (const key of exactKeyCandidates) {
      const value = storage.getItem(key)
      collectFromRaw(value)
    }

    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (!key) {
        continue
      }

      const lower = key.toLowerCase()
      if (!lower.includes('token') && !lower.includes('auth')) {
        continue
      }

      const value = storage.getItem(key)
      collectFromRaw(value)
    }
  }

  const cookiePairs = document.cookie
    .split(';')
    .map((entry) => entry.trim())
    .filter((entry) => entry.includes('='))

  for (const pair of cookiePairs) {
    const separator = pair.indexOf('=')
    const key = pair.slice(0, separator).trim().toLowerCase()
    if (!key.includes('token') && !key.includes('auth')) {
      continue
    }

    const rawValue = pair.slice(separator + 1).trim()
    const decodedValue = safeDecodeURIComponent(rawValue)
    collectFromRaw(decodedValue)
  }

  if (tokenCandidates.size === 0) {
    return null
  }

  return pickBestFoodpandaToken(Array.from(tokenCandidates))
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function extractPossibleTokens(raw: string | null): string[] {
  const tokens = new Set<string>()

  if (!raw) {
    return []
  }

  const direct = raw.trim().replace(/^Bearer\s+/i, '')
  if (looksLikeJwt(direct)) {
    tokens.add(direct)
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    collectPossibleTokensFromUnknown(parsed, tokens, 0)
  } catch {
    return Array.from(tokens)
  }

  return Array.from(tokens)
}

function collectPossibleTokensFromUnknown(value: unknown, tokens: Set<string>, depth: number): void {
  if (depth > 4 || value === null || value === undefined) {
    return
  }

  if (typeof value === 'string') {
    const normalized = value.trim().replace(/^Bearer\s+/i, '')
    if (looksLikeJwt(normalized)) {
      tokens.add(normalized)
    }
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectPossibleTokensFromUnknown(item, tokens, depth + 1)
    }
    return
  }

  if (typeof value !== 'object') {
    return
  }

  const object = value as Record<string, unknown>
  const directKeys = ['access_token', 'accessToken', 'token', 'authToken', 'authorization', 'idToken']

  for (const key of directKeys) {
    collectPossibleTokensFromUnknown(object[key], tokens, depth + 1)
  }

  for (const [key, item] of Object.entries(object)) {
    const lowerKey = key.toLowerCase()
    if (lowerKey.includes('token') || lowerKey.includes('auth') || lowerKey.includes('bearer')) {
      collectPossibleTokensFromUnknown(item, tokens, depth + 1)
    }
  }
}

function pickBestFoodpandaToken(candidates: string[]): string | null {
  let bestToken: string | null = null
  let bestScore = Number.NEGATIVE_INFINITY

  for (const candidate of candidates) {
    const score = scoreFoodpandaToken(candidate)
    if (score > bestScore) {
      bestScore = score
      bestToken = candidate
    }
  }

  if (bestToken) {
    return bestToken
  }

  return candidates[0] ?? null
}

function scoreFoodpandaToken(token: string): number {
  const payload = parseJwtPayload(token)
  if (!payload) {
    return 1
  }

  let score = 0

  const clientId = asString(payload.client_id)
  if (clientId === 'volo') {
    score += 100
  }

  const scope = asString(payload.scope)
  if (scope && /API_CUSTOMER/i.test(scope)) {
    score += 60
  }

  const userId = asString(payload.user_id)
  if (userId) {
    score += 15
  }

  const expires = asNumber(payload.expires) ?? asNumber(payload.exp)
  if (expires !== null) {
    const nowSeconds = Date.now() / 1000
    if (expires > nowSeconds) {
      score += 20
    } else {
      score -= 120
    }
  }

  return score
}

function parseJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length !== 3) {
    return null
  }

  const payloadPart = parts[1]
  if (!payloadPart) {
    return null
  }

  const normalized = payloadPart.replace(/-/g, '+').replace(/_/g, '/')
  const padLength = (4 - (normalized.length % 4)) % 4
  const padded = normalized.padEnd(normalized.length + padLength, '=')

  try {
    const decoded = atob(padded)
    const parsed = JSON.parse(decoded) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }

    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

function looksLikeJwt(value: string): boolean {
  if (!value) {
    return false
  }

  const parts = value.split('.')
  return parts.length === 3 && parts.every((part) => part.length > 0)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
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

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms)
  })
}
