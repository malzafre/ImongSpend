(() => {
  if (window.__IMONGSPEND_PAGE_BRIDGE__) {
    return
  }

  window.__IMONGSPEND_PAGE_BRIDGE__ = true

  const COMMAND_EVENT = '__IMONGSPEND_PAGE_COMMAND__'
  const RESULT_EVENT = '__IMONGSPEND_PAGE_FETCH_RESULT__'
  const DEFAULT_MAX_PAGES = 30
  const DEFAULT_DELAY_MS = 320

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

    const offsetA = body.new_data && body.new_data.next_offset
    if (typeof offsetA === 'number' && Number.isFinite(offsetA)) {
      return offsetA
    }

    const offsetB = body.data && body.data.next_offset
    if (typeof offsetB === 'number' && Number.isFinite(offsetB)) {
      return offsetB
    }

    const offsetC = body.data && body.data.order_data && body.data.order_data.next_offset
    if (typeof offsetC === 'number' && Number.isFinite(offsetC)) {
      return offsetC
    }

    return null
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

      window.dispatchEvent(
        new CustomEvent(RESULT_EVENT, {
          detail: {
            requestId,
            ok: true,
            payload: JSON.stringify({
              endpoint,
              orders,
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
