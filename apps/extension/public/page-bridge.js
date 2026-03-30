(() => {
  if (window.__IMONGSPEND_PAGE_BRIDGE__) {
    return
  }

  window.__IMONGSPEND_PAGE_BRIDGE__ = true

  const COMMAND_EVENT = '__IMONGSPEND_PAGE_COMMAND__'
  const RESULT_EVENT = '__IMONGSPEND_PAGE_FETCH_RESULT__'
  const DEFAULT_MAX_PAGES = 30
  const DEFAULT_DELAY_MS = 320
  const DEFAULT_MAX_DETAIL_FETCH = 0
  const DEFAULT_DETAIL_DELAY_MS = 700
  const DEFAULT_DETAIL_CONCURRENCY = 3
  const MAX_DETAIL_FETCH_LIMIT = 12
  const MAX_DETAIL_CONCURRENCY = 4
  const DETAIL_RATE_LIMIT_CODE = 'DETAIL_RATE_LIMITED'
  const DETAIL_RATE_LIMIT_COOLDOWN_MS = 60_000
  const MAX_DETAIL_CACHE_SIZE = 400

  const detailCache = new Map()
  let detailRateLimitedUntil = 0

  const endpointBuilders = [
    (origin, offset) => `${origin}/api/v4/order/get_all_order_and_checkout_list?_oft=0&limit=20&offset=${offset}`,
    (origin, offset) => `${origin}/api/v4/order/get_order_list?limit=20&list_type=3&offset=${offset}`,
  ]

  const parseOrderData = (body) => {
    if (!body || typeof body !== 'object') {
      return []
    }

    const listA = body.new_data && body.new_data.order_or_checkout_data
    if (Array.isArray(listA)) {
      const mapped = []
      for (const entry of listA) {
        if (entry && typeof entry === 'object' && entry.order_list_detail && typeof entry.order_list_detail === 'object') {
          mapped.push(entry.order_list_detail)
        }
      }

      if (mapped.length > 0) {
        return mapped
      }
    }

    const detailsA = body.data && body.data.details_list
    if (Array.isArray(detailsA)) {
      return detailsA
    }

    const detailsB = body.data && body.data.order_data && body.data.order_data.details_list
    if (Array.isArray(detailsB)) {
      return detailsB
    }

    return []
  }

  const parseNextOffset = (body) => {
    if (!body || typeof body !== 'object') {
      return null
    }

    const offsetCandidates = [
      body.new_data && body.new_data.next_offset,
      body.data && body.data.next_offset,
      body.data && body.data.order_data && body.data.order_data.next_offset,
    ]

    for (const candidate of offsetCandidates) {
      const parsed = Number(candidate)
      if (Number.isFinite(parsed) && parsed >= 0) {
        return parsed
      }
    }

    return null
  }

  const extractOrderId = (order) => {
    if (!order || typeof order !== 'object') {
      return null
    }

    const infoOrderId = order.info_card && typeof order.info_card === 'object' ? order.info_card.order_id : null
    if (typeof infoOrderId === 'number' || typeof infoOrderId === 'string') {
      return String(infoOrderId)
    }

    if (typeof order.order_id === 'number' || typeof order.order_id === 'string') {
      return String(order.order_id)
    }

    return null
  }

  const createErrorWithCode = (message, code) => {
    const error = new Error(message)
    error.code = code
    return error
  }

  const extractErrorCode = (error) => {
    if (!error || typeof error !== 'object') {
      return ''
    }

    const code = error.code
    return typeof code === 'string' ? code : ''
  }

  const setDetailCache = (orderId, detail) => {
    if (detailCache.has(orderId)) {
      detailCache.delete(orderId)
      detailCache.set(orderId, detail)
      return
    }

    detailCache.set(orderId, detail)

    if (detailCache.size > MAX_DETAIL_CACHE_SIZE) {
      const oldestKey = detailCache.keys().next().value
      if (oldestKey !== undefined) {
        detailCache.delete(oldestKey)
      }
    }
  }

  const buildJitteredDelay = (baseMs) => {
    const spread = Math.max(25, Math.floor(baseMs * 0.25))
    return Math.max(0, baseMs + Math.floor(Math.random() * (spread * 2 + 1)) - spread)
  }

  const isLikelyRateLimitPayload = (body) => {
    if (!body || typeof body !== 'object') {
      return false
    }

    if (Number(body.error) === 429) {
      return true
    }

    if (typeof body.error === 'string' && /rate|throttle|too\s*many|frequen/i.test(body.error)) {
      return true
    }

    const messages = [
      body.message,
      body.msg,
      body.error_msg,
      body.error_message,
      body.errorMsg,
    ].filter((value) => typeof value === 'string')

    return messages.some((message) => /rate|throttle|too\s*many|frequen/i.test(message))
  }

  const isTransientDetailError = (error) => {
    if (!(error instanceof Error)) {
      return false
    }

    return /failed to fetch|network|timeout|http 5\d\d/i.test(error.message)
  }

  const fetchOrderDetail = async (orderId) => {
    if (detailCache.has(orderId)) {
      return {
        data: detailCache.get(orderId),
        fromCache: true,
      }
    }

    const now = Date.now()
    if (detailRateLimitedUntil > now) {
      throw createErrorWithCode('Detail requests paused by Shopee rate limit.', DETAIL_RATE_LIMIT_CODE)
    }

    const endpoint = `${window.location.origin}/api/v4/order/get_order_detail?_oft=0&order_id=${encodeURIComponent(orderId)}`
    const response = await fetch(endpoint, {
      credentials: 'include',
    })

    if (response.status === 429) {
      detailRateLimitedUntil = Date.now() + DETAIL_RATE_LIMIT_COOLDOWN_MS
      throw createErrorWithCode('Shopee returned HTTP 429 for get_order_detail.', DETAIL_RATE_LIMIT_CODE)
    }

    if (!response.ok) {
      throw new Error(`Detail HTTP ${response.status}`)
    }

    const body = await response.json()
    if (isLikelyRateLimitPayload(body)) {
      detailRateLimitedUntil = Date.now() + DETAIL_RATE_LIMIT_COOLDOWN_MS
      throw createErrorWithCode('Shopee throttled get_order_detail payload.', DETAIL_RATE_LIMIT_CODE)
    }

    const isOk = body && typeof body === 'object' && body.error === 0
    if (!isOk || !body.data || typeof body.data !== 'object') {
      throw new Error('Detail payload unavailable')
    }

    setDetailCache(orderId, body.data)

    return {
      data: body.data,
      fromCache: false,
    }
  }

  const enrichWithOrderDetails = async (orders, maxDetailFetch, detailDelayMs, detailConcurrency) => {
    const uniqueOrderDetails = []
    const orderBuckets = new Map()

    for (const order of orders) {
      const orderId = extractOrderId(order)
      if (!orderId) {
        continue
      }

      if (!orderBuckets.has(orderId)) {
        orderBuckets.set(orderId, [])
      }

      orderBuckets.get(orderId).push(order)
    }

    for (const [orderId, linkedOrders] of orderBuckets.entries()) {
      if (uniqueOrderDetails.length >= maxDetailFetch) {
        break
      }

      if (detailCache.has(orderId)) {
        const cachedDetail = detailCache.get(orderId)
        for (const linkedOrder of linkedOrders) {
          linkedOrder.__detail = cachedDetail
        }
      }

      uniqueOrderDetails.push({
        orderId,
        linkedOrders,
      })
    }

    const queue = [...uniqueOrderDetails]
    const inFlight = new Set()

    let attempted = 0
    let enriched = 0
    let cached = 0
    let failed = 0
    let rateLimited = false
    let skippedAfterRateLimit = 0

    const processOne = async (item) => {
      const { orderId, linkedOrders } = item
      attempted += 1

      for (let retry = 0; retry < 2; retry += 1) {
        try {
          const detail = await fetchOrderDetail(orderId)
          for (const linkedOrder of linkedOrders) {
            linkedOrder.__detail = detail.data
          }
          enriched += 1
          if (detail.fromCache) {
            cached += 1
          } else {
            await wait(buildJitteredDelay(detailDelayMs))
          }
          return
        } catch (error) {
          const errorCode = extractErrorCode(error)
          if (errorCode === DETAIL_RATE_LIMIT_CODE) {
            rateLimited = true
            return
          }

          if (retry === 0 && isTransientDetailError(error)) {
            await wait(Math.max(300, buildJitteredDelay(detailDelayMs * 2)))
            continue
          }

          failed += 1
          return
        }
      }
    }

    while (queue.length > 0 || inFlight.size > 0) {
      if (rateLimited) {
        skippedAfterRateLimit = queue.length
      }

      while (!rateLimited && queue.length > 0 && inFlight.size < detailConcurrency) {
        const item = queue.shift()
        if (!item) {
          break
        }

        const task = processOne(item).finally(() => {
          inFlight.delete(task)
        })
        inFlight.add(task)
      }

      if (inFlight.size === 0) {
        break
      }

      await Promise.race(inFlight)
    }

    return {
      attempted,
      enriched,
      cached,
      failed,
      rateLimited,
      skippedAfterRateLimit,
    }
  }

  const wait = (ms) => new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

  const runEndpoint = async (buildEndpoint, maxPages, delayMs) => {
    let offset = 0
    let page = 0
    const visited = new Set()
    const orders = []

    while (page < maxPages) {
      if (visited.has(offset)) {
        break
      }

      visited.add(offset)
      const url = buildEndpoint(window.location.origin, offset)

      const response = await fetch(url, {
        credentials: 'include',
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const body = await response.json()
      const details = parseOrderData(body)
      if (!details.length) {
        break
      }

      for (const order of details) {
        orders.push(order)
      }

      const nextOffset = parseNextOffset(body)
      if (typeof nextOffset !== 'number' || nextOffset < 0 || nextOffset === offset) {
        break
      }

      offset = nextOffset
      page += 1
      await wait(delayMs)
    }

    return orders
  }

  window.addEventListener(COMMAND_EVENT, async (event) => {
    const detail = event && event.detail ? event.detail : {}
    if (detail.type !== 'RUN_FETCH') {
      return
    }

    const requestId = detail.requestId
    const maxPages = Math.max(1, Math.min(120, Number(detail.maxPages) || DEFAULT_MAX_PAGES))
    const delayMs = Math.max(120, Math.min(1500, Number(detail.delayMs) || DEFAULT_DELAY_MS))
    const includeOrderDetail = detail.includeOrderDetail === true
    const maxDetailFetch = Math.max(0, Math.min(MAX_DETAIL_FETCH_LIMIT, Number(detail.maxDetailFetch) || DEFAULT_MAX_DETAIL_FETCH))
    const detailDelayMs = Math.max(250, Math.min(2500, Number(detail.detailDelayMs) || DEFAULT_DETAIL_DELAY_MS))
    const detailConcurrency = Math.max(
      1,
      Math.min(MAX_DETAIL_CONCURRENCY, Number(detail.detailConcurrency) || DEFAULT_DETAIL_CONCURRENCY),
    )

    try {
      let orders = []
      let endpoint = '/api/v4/order/get_all_order_and_checkout_list'
      const endpointErrors = []

      for (const buildEndpoint of endpointBuilders) {
        try {
          const result = await runEndpoint(buildEndpoint, maxPages, delayMs)
          if (result.length > 0) {
            orders = result
            endpoint = buildEndpoint(window.location.origin, 0).replace(window.location.origin, '').split('?')[0]
            break
          }
        } catch (endpointError) {
          endpointErrors.push(endpointError instanceof Error ? endpointError.message : 'Endpoint failed')
        }
      }

      if (!orders.length) {
        const reason = endpointErrors.join(' | ') || 'No orders returned from Shopee endpoints.'
        throw new Error(reason)
      }

      let detailAttempted = 0
      let detailEnriched = 0
      let detailCached = 0
      let detailFailed = 0
      let detailRateLimited = false
      let detailSkippedAfterRateLimit = 0
      if (includeOrderDetail && maxDetailFetch > 0) {
        const detailResult = await enrichWithOrderDetails(orders, maxDetailFetch, detailDelayMs, detailConcurrency)
        detailAttempted = detailResult.attempted
        detailEnriched = detailResult.enriched
        detailCached = detailResult.cached
        detailFailed = detailResult.failed
        detailRateLimited = detailResult.rateLimited
        detailSkippedAfterRateLimit = detailResult.skippedAfterRateLimit
      }

      window.dispatchEvent(
        new CustomEvent(RESULT_EVENT, {
          detail: {
            requestId,
            ok: true,
            payload: JSON.stringify({
              endpoint,
              orders,
              detailAttempted,
              detailEnriched,
              detailCached,
              detailFailed,
              detailRateLimited,
              detailSkippedAfterRateLimit,
            }),
          },
        }),
      )
    } catch (error) {
      window.dispatchEvent(
        new CustomEvent(RESULT_EVENT, {
          detail: {
            requestId,
            ok: false,
            error: error instanceof Error ? error.message : 'Page fetch failed',
          },
        }),
      )
    }
  })
})()
