type RuntimeLike = {
  onInstalled?: {
    addListener: (callback: () => void) => void
  }
}

const runtime = (globalThis as { chrome?: { runtime?: RuntimeLike } }).chrome?.runtime

runtime?.onInstalled?.addListener(() => {
  console.info('[ImongSpend] Extension installed. Shopee-first MVP mode enabled.')
})