import type { ResearchOrderRow } from '@shared/index'
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

type EndpointConfig = {
  key: 'order_list' | 'all_order_list'
  build: (offset: number) => string
}

const PAGE_COMMAND_EVENT = '__IMONGSPEND_PAGE_COMMAND__'
const PAGE_FETCH_RESULT_EVENT = '__IMONGSPEND_PAGE_FETCH_RESULT__'

const runtime = (globalThis as { chrome?: RuntimeLike }).chrome
let bridgeLoadPromise: Promise<void> | null = null

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

  const parsed = JSON.parse(payload.payload) as { orders?: unknown[]; endpoint?: string }
  const orders = Array.isArray(parsed.orders) ? parsed.orders : []
  const endpointLabel = parsed.endpoint ?? '/api/v4/order/get_order_list'

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
    notes: [`Data source: page-context authenticated fetch (${endpointLabel}).`],
  }
}

export async function collectRowsViaContentApi(maxPages: number): Promise<CollectionResult> {
  const endpoints: EndpointConfig[] = [
    {
      key: 'order_list',
      build: (offset) => `/api/v4/order/get_order_list?limit=20&list_type=3&offset=${offset}`,
    },
    {
      key: 'all_order_list',
      build: (offset) => `/api/v4/order/get_all_order_and_checkout_list?limit=20&offset=${offset}`,
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
        return {
          rows,
          notes: [`Data source: content-script API fallback (${firstUrl}).`],
        }
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Unknown content API error')
    }
  }

  throw new Error(errors.join(' | ') || 'No API rows returned.')
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
