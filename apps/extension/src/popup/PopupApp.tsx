import { useEffect, useMemo, useState } from 'react'
import type { ResearchCalculationResult, ResearchOrderRow } from '@shared/index'

type Stage = 'idle' | 'running' | 'done' | 'error'
type PopupProvider = 'shopee' | 'lazada'

type CalculationResponse =
  | { ok: true; result: ResearchCalculationResult }
  | { ok: false; error: string }

type DetailResponse =
  | { ok: true; rows: ResearchOrderRow[] }
  | { ok: false; error: string }

type SavedSummary = {
  positiveSpend: number
  totalSaved: number
  orderCount: number
  completedCount: number
  cancelledCount: number
  updatedAt: string
}

const STEPS_BY_PROVIDER: Record<PopupProvider, string[]> = {
  shopee: [
    'Open Shopee My Purchase in this browser.',
    'Click Calculate My Spending to fetch and compute totals locally.',
    'Review totals and export CSV if needed.',
  ],
  lazada: [
    'Open Lazada My Orders in this browser.',
    'Click Calculate My Spending to fetch and compute totals locally.',
    'Review totals and export CSV if needed.',
  ],
}

const POLICY_DECISION_KEY = 'imongspend.popup.policy.decision.v1'
const POLICY_ACKNOWLEDGED_KEY = 'imongspend.popup.policy.acknowledged.v1'
const LEGACY_ONBOARDING_KEY = 'imongspend.popup.onboarding.accepted.v1'
const SAVED_SUMMARY_KEY = 'imongspend.popup.saved-summary.v1'
const PROVIDER_SELECTION_KEY = 'imongspend.popup.provider.v1'
const FAQ_URL = 'https://imongspend.com/faq'

const PROVIDER_LABEL: Record<PopupProvider, string> = {
  shopee: 'Shopee',
  lazada: 'Lazada',
}

type PolicyDecision = 'pending' | 'accepted'

const statusLabel: Record<Stage, string> = {
  idle: 'Ready',
  running: 'Calculating',
  done: 'Complete',
  error: 'Needs attention',
}

export function PopupApp() {
  const [provider, setProvider] = useState<PopupProvider>(() => readProviderFromStorage())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [policyReady, setPolicyReady] = useState(false)
  const [policyDecision, setPolicyDecision] = useState<PolicyDecision>('pending')
  const [savedSummary, setSavedSummary] = useState<SavedSummary | null>(null)
  const [stage, setStage] = useState<Stage>('idle')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ResearchCalculationResult | null>(null)

  useEffect(() => {
    const storedDecision = window.localStorage.getItem(POLICY_DECISION_KEY)
    const hasAcknowledgedPolicy =
      window.localStorage.getItem(POLICY_ACKNOWLEDGED_KEY) === 'true' ||
      window.localStorage.getItem(LEGACY_ONBOARDING_KEY) === 'true'

    if (storedDecision === 'accepted') {
      setPolicyDecision(storedDecision)
      setPolicyReady(true)
      return
    }

    if (storedDecision === 'declined') {
      window.localStorage.setItem(POLICY_DECISION_KEY, 'pending')
    }

    if (hasAcknowledgedPolicy) {
      window.localStorage.setItem(POLICY_DECISION_KEY, 'accepted')
      setPolicyDecision('accepted')
      setPolicyReady(true)
      return
    }

    setPolicyDecision('pending')
    setPolicyReady(true)
  }, [])

  useEffect(() => {
    window.localStorage.setItem(PROVIDER_SELECTION_KEY, provider)
    setSavedSummary(readSavedSummaryFromStorage(provider))
    setResult(null)
    setError(null)
    setStage('idle')
  }, [provider])

  const currency = useMemo(
    () =>
      new Intl.NumberFormat('en-PH', {
        style: 'currency',
        currency: 'PHP',
        maximumFractionDigits: 2,
      }),
    [],
  )

  const dateTimeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat('en-PH', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
    [],
  )

  async function handleCalculate(): Promise<void> {
    setError(null)

    if (policyDecision !== 'accepted') {
      setStage('error')
      setError('You must accept the Privacy Policy before calculating.')
      return
    }

    setStage('running')

    try {
      const tabId = await getActiveTabId(provider)
      const calculateTimeoutMs = provider === 'lazada' ? 4 * 60_000 : 30_000
      const response = await withTimeout(
        sendResearchCalculation(tabId, provider),
        calculateTimeoutMs,
        `Calculation timed out. Keep ${PROVIDER_LABEL[provider]} orders page open, scroll once, then retry.`,
      )

      if (!response.ok) {
        throw new Error(response.error)
      }

      const summary = resultToSavedSummary(response.result)
      persistSavedSummary(summary, provider)
      setSavedSummary(summary)
      setResult(response.result)
      setStage('done')
    } catch (unknownError) {
      const raw = unknownError instanceof Error ? unknownError.message : 'Unable to calculate now.'
      const normalized = normalizeProviderError(provider, raw, 'calculate')

      setResult(null)
      setStage('error')
      setError(normalized)
    }
  }

  async function handleDownloadCsv(): Promise<void> {
    if (!result || stage === 'running') {
      return
    }

    setError(null)
    setStage('running')

    try {
      if (provider === 'lazada') {
        triggerCsvDownload(resultToCsv(result), provider)
        setStage('done')
        return
      }

      const orderIds = getUniqueKnownOrderIds(result.rows)

      if (orderIds.length === 0) {
        triggerCsvDownload(resultToCsv(result), provider)
        setStage('done')
        return
      }

      const tabId = await getActiveTabId(provider)
      const detailFetchTimeoutMs = estimateDetailFetchTimeoutMs(orderIds.length)
      const response = await withTimeout(
        sendOrderDetailsFetch(tabId, provider, orderIds),
        detailFetchTimeoutMs,
        `Fetching order details timed out. Keep ${PROVIDER_LABEL[provider]} orders page open and retry.`,
      )

      if (!response.ok) {
        throw new Error(response.error)
      }

      const mergedRows = mergeRowsWithDetails(result.rows, response.rows)
      const mergedResult: ResearchCalculationResult = {
        ...result,
        rows: mergedRows,
      }

      triggerCsvDownload(resultToCsv(mergedResult), provider)

      const summary = resultToSavedSummary(mergedResult)
      persistSavedSummary(summary, provider)
      setSavedSummary(summary)
      setResult(mergedResult)
      setStage('done')
    } catch (unknownError) {
      const raw = unknownError instanceof Error ? unknownError.message : 'Unable to fetch order details now.'
      const normalized = normalizeProviderError(provider, raw, 'detail')

      setStage('error')
      setError(normalized)
    }
  }

  function handleReset(): void {
    setResult(null)
    setError(null)
    setStage('idle')
  }

  function handleAcceptPolicy(): void {
    window.localStorage.setItem(POLICY_DECISION_KEY, 'accepted')
    window.localStorage.setItem(POLICY_ACKNOWLEDGED_KEY, 'true')
    window.localStorage.setItem(LEGACY_ONBOARDING_KEY, 'true')
    setPolicyDecision('accepted')
    setError(null)
    setStage('idle')
  }

  function handleDeclinePolicy(): void {
    window.localStorage.setItem(POLICY_DECISION_KEY, 'pending')
    window.localStorage.removeItem(POLICY_ACKNOWLEDGED_KEY)
    window.localStorage.removeItem(LEGACY_ONBOARDING_KEY)
    setPolicyDecision('pending')
    setError(null)
    setStage('idle')
    window.close()
  }

  function handleToggleSettings(): void {
    setSettingsOpen((current) => !current)
  }

  function handleShowPolicyAgain(): void {
    setSettingsOpen(false)
    window.localStorage.setItem(POLICY_DECISION_KEY, 'pending')
    window.localStorage.removeItem(POLICY_ACKNOWLEDGED_KEY)
    window.localStorage.removeItem(LEGACY_ONBOARDING_KEY)
    setPolicyDecision('pending')
    setError(null)
    setStage('idle')
  }

  function handleClearLocalStorage(): void {
    window.localStorage.clear()
    setSettingsOpen(false)
    setProvider('shopee')
    setSavedSummary(null)
    setResult(null)
    setError(null)
    setStage('idle')
    setPolicyDecision('pending')
  }

  function handleClearSavedResults(): void {
    window.localStorage.removeItem(getSavedSummaryStorageKey(provider))
    setSavedSummary(null)
    setResult(null)
    setError(null)
    setStage('idle')
  }

  function handleProviderChange(nextProvider: PopupProvider): void {
    if (nextProvider === provider || stage === 'running') {
      return
    }

    setProvider(nextProvider)
  }

  function handleOpenFaq(): void {
    window.open(FAQ_URL, '_blank', 'noopener,noreferrer')
  }

  const stageClass = `status-pill status-${stage}`
  const hasSavedSummary = savedSummary !== null
  const totalSpent = savedSummary?.positiveSpend ?? 0
  const totalOrders = savedSummary?.orderCount ?? 0
  const lastUpdatedLabel = savedSummary ? formatLastUpdatedLabel(savedSummary.updatedAt, dateTimeFormatter) : null
  const providerSteps = STEPS_BY_PROVIDER[provider]

  if (!policyReady) {
    return <main className="panel panel-popup" aria-busy="true" />
  }

  if (policyDecision !== 'accepted') {
    return (
      <main className="panel panel-popup popup-shell popup-gate">
        <div className="aurora" aria-hidden="true" />

        <section className="glass-card policy-card" aria-label="Onboarding privacy policy">
          <header className="popup-topbar onboarding-brand">
            <div className="brand-cluster">
              <img className="brand-logo" src="/imongspend-logo.png" alt="ImongSpend logo" />
              <div>
                <p className="kicker">Onboarding Policy</p>
                <h1>Privacy and Data Use</h1>
              </div>
            </div>
          </header>

          <p className="hero-copy policy-copy">
            ImongSpend reads your Shopee or Lazada order history from the active browser tab to calculate spending insights for you.
          </p>

          <ul className="policy-list">
            <li>All calculations run locally in your browser session.</li>
            <li>We do not store or upload your purchase or order data.</li>
            <li>We never ask for passwords, OTP codes, bank cards, or payment credentials.</li>
            <li>You can clear local extension data any time from Settings.</li>
          </ul>

          <div className="policy-actions">
            <button className="action-btn policy-btn" onClick={handleAcceptPolicy}>
              Accept and Continue
            </button>
            <button className="secondary-btn decline-btn" onClick={handleDeclinePolicy}>
              Decline and Close
            </button>
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="panel panel-popup popup-shell">
      <div className="aurora" aria-hidden="true" />

      <header className="popup-topbar">
        <div className="brand-cluster">
          <img className="brand-logo" src="/imongspend-logo.png" alt="ImongSpend logo" />
          <div>
            <p className="kicker">{PROVIDER_LABEL[provider]} Order Calculator</p>
            <h1>ImongSpend</h1>
          </div>
        </div>
        <button
          className="icon-btn"
          aria-label={settingsOpen ? 'Close settings' : 'Open settings'}
          aria-expanded={settingsOpen}
          onClick={handleToggleSettings}
        >
          {settingsOpen ? 'Close' : 'Settings'}
        </button>
      </header>

      <section className="glass-card settings-card" aria-label="Provider selection">
        <p className="subhead">Provider</p>
        <div className="provider-switch" role="group" aria-label="Provider selection">
          <button
            className={`provider-btn ${provider === 'shopee' ? 'provider-btn-active' : ''}`}
            onClick={() => handleProviderChange('shopee')}
            disabled={stage === 'running'}
          >
            Shopee
          </button>
          <button
            className={`provider-btn ${provider === 'lazada' ? 'provider-btn-active' : ''}`}
            onClick={() => handleProviderChange('lazada')}
            disabled={stage === 'running'}
          >
            Lazada
          </button>
        </div>
      </section>

      {settingsOpen ? (
        <section className="glass-card settings-card" aria-label="In-popup settings">
          <p className="subhead">Settings</p>

          <div className="settings-row">
            <span>Policy Notice</span>
            <button className="settings-link-btn" onClick={handleShowPolicyAgain}>
              Show Again
            </button>
          </div>

          <div className="settings-row">
            <span>Storage</span>
            <button className="settings-link-btn danger-btn" onClick={handleClearLocalStorage}>
              Clear Local Storage
            </button>
          </div>

          <div className="settings-row">
            <span>Saved Results</span>
            <button className="settings-link-btn" onClick={handleClearSavedResults}>
              Clear Saved Results
            </button>
          </div>
        </section>
      ) : null}

      <section className="metric-split" aria-label="Spending summary">
        <article className="metric-card metric-primary">
          <p className="subhead">Total Spent</p>
          <p className="amount">{currency.format(totalSpent)}</p>
        </article>

        <article className="metric-card metric-secondary">
          <p className="subhead">Total Orders</p>
          <p className="metric-number">{totalOrders.toLocaleString()}</p>
        </article>
      </section>

      <div className={stageClass}>{statusLabel[stage]}</div>

      {lastUpdatedLabel ? <p className="status-meta">{lastUpdatedLabel}</p> : null}

      <button className="action-btn" onClick={() => void handleCalculate()} disabled={stage === 'running'}>
        {stage === 'running' ? 'Calculating Spend...' : hasSavedSummary ? 'Recalculate My Spending' : 'Calculate My Spending'}
      </button>

      {error ? <p className="error-text">{error}</p> : null}

      {result ? (
        <section className="result-shell" aria-label="Calculation details">
          <div className="stats-grid">
            <article className="stat-chip">
              <p>Completed orders</p>
              <strong>{result.completedCount.toLocaleString()}</strong>
            </article>
            <article className="stat-chip">
              <p>Total saved</p>
              <strong>{currency.format(result.totalSaved)}</strong>
            </article>
          </div>

          <div className="button-row">
            <button className="download-btn" onClick={() => void handleDownloadCsv()} disabled={stage === 'running'}>
              {stage === 'running' ? 'Fetching details...' : 'Download CSV'}
            </button>
            <button className="secondary-btn" onClick={handleReset}>
              Clear Result
            </button>
          </div>
        </section>
      ) : null}

      <section className="glass-card" aria-label="Steps">
        <p className="subhead">Steps</p>
        <ol className="step-list">
          {providerSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>

      <section className="glass-card faq-card" aria-label="FAQ">
        <h2>FAQ</h2>
        <p className="hero-copy faq-copy">
          Answers about data scope, privacy, and result accuracy will live on the ImongSpend website.
        </p>
        <button className="secondary-btn" onClick={handleOpenFaq}>
          Open FAQ Website
        </button>
      </section>
    </main>
  )
}

  type RuntimeWithLastError = {
  runtime?: {
    lastError?: {
      message?: string
    }
  }
  tabs?: {
    query: (
      queryInfo: { active: boolean; currentWindow: boolean },
      callback: (tabs: Array<{ id?: number; url?: string }>) => void,
    ) => void
    sendMessage: (
      tabId: number,
      message:
        | { type: 'IMONGSPEND_RESEARCH_CALCULATE'; payload: { maxPages: number; provider: PopupProvider } }
        | { type: 'IMONGSPEND_FETCH_ORDER_DETAILS'; payload: { orderIds: string[]; provider: PopupProvider } },
      callback: (response?: unknown) => void,
    ) => void
  }
  scripting?: {
    executeScript: (
      injection: {
        target: { tabId: number }
        files: string[]
      },
      callback: (results?: unknown[]) => void,
    ) => void
  }
}

async function getActiveTabId(provider: PopupProvider): Promise<number> {
  const chromeRef = (globalThis as { chrome?: RuntimeWithLastError }).chrome
  if (!chromeRef?.tabs?.query) {
    throw new Error('Chrome tabs API is unavailable in this context.')
  }

  const tabs = await new Promise<Array<{ id?: number; url?: string }>>((resolve) => {
    chromeRef.tabs?.query({ active: true, currentWindow: true }, (currentTabs) => {
      resolve(currentTabs ?? [])
    })
  })

  const activeTab = tabs[0]
  if (!activeTab?.id) {
    throw new Error(`Open a ${PROVIDER_LABEL[provider]} tab first, then retry.`)
  }

  const tabUrl = activeTab.url ?? ''

  if (provider === 'shopee') {
    if (!tabUrl.includes('shopee.')) {
      throw new Error('Active tab is not Shopee. Open Shopee My Purchase page first.')
    }

    if (!/\/user\/purchase/i.test(tabUrl)) {
      throw new Error('Open Shopee My Purchase page first (URL should include /user/purchase), then retry.')
    }

    return activeTab.id
  }

  if (!tabUrl.includes('lazada.')) {
    throw new Error('Active tab is not Lazada. Open Lazada My Orders page first.')
  }

  if (!/\/customer\/order\/(index|view)\//i.test(tabUrl)) {
    throw new Error('Open Lazada My Orders page first (URL should include /customer/order/index), then retry.')
  }

  return activeTab.id
}

async function sendResearchCalculation(tabId: number, provider: PopupProvider): Promise<CalculationResponse> {
  const chromeRef = (globalThis as { chrome?: RuntimeWithLastError }).chrome
  if (!chromeRef?.tabs?.sendMessage) {
    throw new Error('Unable to communicate with active tab.')
  }

  const failures: string[] = []

  try {
    return await sendCalculationMessageOnce(chromeRef, tabId, provider)
  } catch (unknownError) {
    const message = unknownError instanceof Error ? unknownError.message : 'Initial tab message failed.'
    failures.push(message)
  }

  try {
    await ensureContentScriptInjected(chromeRef, tabId)
    await sleep(120)
    return await sendCalculationMessageOnce(chromeRef, tabId, provider)
  } catch (unknownError) {
    const message = unknownError instanceof Error ? unknownError.message : 'Script injection retry failed.'
    failures.push(message)
  }

  throw new Error(formatTabConnectionError(provider, failures))
}

async function sendCalculationMessageOnce(
  chromeRef: RuntimeWithLastError,
  tabId: number,
  provider: PopupProvider,
): Promise<CalculationResponse> {
  return new Promise<CalculationResponse>((resolve, reject) => {
    chromeRef.tabs?.sendMessage(
      tabId,
      {
        type: 'IMONGSPEND_RESEARCH_CALCULATE',
        payload: { maxPages: 60, provider },
      },
      (response) => {
        const runtimeError = chromeRef.runtime?.lastError?.message
        if (runtimeError) {
          reject(new Error(runtimeError))
          return
        }

        if (!response) {
          reject(new Error(`No response from ${PROVIDER_LABEL[provider]} page. Refresh and retry.`))
          return
        }

        if (typeof response !== 'object' || response === null || !('ok' in response)) {
          reject(new Error(`Malformed response from ${PROVIDER_LABEL[provider]} page.`))
          return
        }

        resolve(response as CalculationResponse)
      },
    )
  })
}

async function sendOrderDetailsFetch(
  tabId: number,
  provider: PopupProvider,
  orderIds: string[],
): Promise<DetailResponse> {
  const chromeRef = (globalThis as { chrome?: RuntimeWithLastError }).chrome
  if (!chromeRef?.tabs?.sendMessage) {
    throw new Error('Unable to communicate with active tab.')
  }

  const failures: string[] = []

  try {
    return await sendOrderDetailsMessageOnce(chromeRef, tabId, provider, orderIds)
  } catch (unknownError) {
    const message = unknownError instanceof Error ? unknownError.message : 'Initial tab message failed.'
    failures.push(message)
  }

  try {
    await ensureContentScriptInjected(chromeRef, tabId)
    await sleep(120)
    return await sendOrderDetailsMessageOnce(chromeRef, tabId, provider, orderIds)
  } catch (unknownError) {
    const message = unknownError instanceof Error ? unknownError.message : 'Script injection retry failed.'
    failures.push(message)
  }

  throw new Error(formatTabConnectionError(provider, failures))
}

async function sendOrderDetailsMessageOnce(
  chromeRef: RuntimeWithLastError,
  tabId: number,
  provider: PopupProvider,
  orderIds: string[],
): Promise<DetailResponse> {
  return new Promise<DetailResponse>((resolve, reject) => {
    chromeRef.tabs?.sendMessage(
      tabId,
      {
        type: 'IMONGSPEND_FETCH_ORDER_DETAILS',
        payload: { orderIds, provider },
      },
      (response) => {
        const runtimeError = chromeRef.runtime?.lastError?.message
        if (runtimeError) {
          reject(new Error(runtimeError))
          return
        }

        if (!response) {
          reject(new Error(`No detail response from ${PROVIDER_LABEL[provider]} page. Refresh and retry.`))
          return
        }

        if (typeof response !== 'object' || response === null || !('ok' in response)) {
          reject(new Error(`Malformed detail response from ${PROVIDER_LABEL[provider]} page.`))
          return
        }

        resolve(response as DetailResponse)
      },
    )
  })
}

async function ensureContentScriptInjected(
  chromeRef: RuntimeWithLastError,
  tabId: number,
): Promise<void> {
  if (!chromeRef.scripting?.executeScript) {
    throw new Error('Unable to initialize page connection for this tab.')
  }

  await new Promise<void>((resolve, reject) => {
    chromeRef.scripting?.executeScript(
      {
        target: { tabId },
        files: ['assets/content.js'],
      },
      () => {
        const runtimeError = chromeRef.runtime?.lastError?.message
        if (runtimeError) {
          reject(new Error(runtimeError))
          return
        }

        resolve()
      },
    )
  })
}

function resultToCsv(result: ResearchCalculationResult): string {
  const downloadedAt = new Date()
  const downloadedAtLabel = formatUserFriendlyDateTime(downloadedAt)
  const lines: string[] = []
  const orderHeaders = [
    'order_id',
    'ordered_at',
    'status',
    'shop_name',
    'merchandise_subtotal',
    'shipping_fee',
    'shipping_discount_subtotal',
    'shop_voucher_discount',
    'order_total',
    'payment_method',
    'total_saved',
    'amount',
    'item_summary',
  ]
  const separatorHeader = ['']
  const metricHeaders = ['core_metric', 'core_value']
  lines.push([...orderHeaders, ...separatorHeader, ...metricHeaders].map(escapeCsv).join(','))

  const orderRows = result.rows.map((row) => [
    row.orderId,
    formatUserFriendlyOrderedAt(row.orderedAt),
    row.status,
    row.shopName,
    row.merchandiseSubtotal.toFixed(2),
    row.shippingFee.toFixed(2),
    row.shippingDiscountSubtotal.toFixed(2),
    row.shopVoucherDiscount.toFixed(2),
    row.orderTotal.toFixed(2),
    row.paymentMethod,
    row.totalSaved.toFixed(2),
    row.amount.toFixed(2),
    row.itemSummary,
  ])

  const coreMetricRows: string[][] = [
    ['positive_spend', result.positiveSpend.toFixed(2)],
    ['order_count', String(result.orderCount)],
    ['completed_count', String(result.completedCount)],
    ['cancelled_count', String(result.cancelledCount)],
    ['total_saved', result.totalSaved.toFixed(2)],
    ['downloaded_at', downloadedAtLabel],
  ]

  const totalRows = Math.max(orderRows.length, coreMetricRows.length)
  for (let index = 0; index < totalRows; index += 1) {
    const orderCols =
      orderRows[index] ??
      [
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
      ]
    const metricCols = coreMetricRows[index] ?? ['', '']
    lines.push([...orderCols, '', ...metricCols].map(escapeCsv).join(','))
  }

  return lines.join('\n')
}

function escapeCsv(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

function triggerCsvDownload(csv: string, provider: PopupProvider): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `imongspend-${provider}-${Date.now()}.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}

function getUniqueKnownOrderIds(rows: ResearchOrderRow[]): string[] {
  return Array.from(
    new Set(
      rows
        .map((row) => row.orderId.trim())
        .filter((orderId) => orderId.length > 0 && orderId !== 'unknown'),
    ),
  )
}

function estimateDetailFetchTimeoutMs(orderCount: number): number {
  const perOrderBudgetMs = 1_100
  const fixedOverheadMs = 60_000
  const estimatedMs = Math.ceil((orderCount / 3) * perOrderBudgetMs) + fixedOverheadMs
  return Math.max(90_000, Math.min(20 * 60_000, estimatedMs))
}

function mergeRowsWithDetails(rows: ResearchOrderRow[], enrichedRows: ResearchOrderRow[]): ResearchOrderRow[] {
  const detailByOrderId = new Map<string, ResearchOrderRow>()

  for (const row of enrichedRows) {
    if (row.orderId && row.orderId !== 'unknown') {
      detailByOrderId.set(row.orderId, row)
    }
  }

  return rows.map((row) => {
    const enriched = detailByOrderId.get(row.orderId)
    if (!enriched) {
      return row
    }

    return {
      ...row,
      orderedAt: enriched.orderedAt,
      merchandiseSubtotal: enriched.merchandiseSubtotal,
      shippingFee: enriched.shippingFee,
      shippingDiscountSubtotal: enriched.shippingDiscountSubtotal,
      shopVoucherDiscount: enriched.shopVoucherDiscount,
      paymentMethod: enriched.paymentMethod,
      totalSaved: enriched.totalSaved,
      itemSummary: enriched.itemSummary,
    }
  })
}

function resultToSavedSummary(result: ResearchCalculationResult): SavedSummary {
  return {
    positiveSpend: result.positiveSpend,
    totalSaved: result.totalSaved,
    orderCount: result.orderCount,
    completedCount: result.completedCount,
    cancelledCount: result.cancelledCount,
    updatedAt: new Date().toISOString(),
  }
}

function persistSavedSummary(summary: SavedSummary, provider: PopupProvider): void {
  window.localStorage.setItem(getSavedSummaryStorageKey(provider), JSON.stringify(summary))
}

function readSavedSummaryFromStorage(provider: PopupProvider): SavedSummary | null {
  const storageKey = getSavedSummaryStorageKey(provider)
  const raw = window.localStorage.getItem(storageKey)

  if (!raw && provider === 'shopee') {
    const legacyRaw = window.localStorage.getItem(SAVED_SUMMARY_KEY)
    if (legacyRaw) {
      window.localStorage.setItem(storageKey, legacyRaw)
      window.localStorage.removeItem(SAVED_SUMMARY_KEY)
      return readSavedSummaryFromStorage(provider)
    }
  }

  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as Partial<SavedSummary>
    const positiveSpend = Number(parsed.positiveSpend)
    const totalSaved = Number(parsed.totalSaved)
    const orderCount = Number(parsed.orderCount)
    const completedCount = Number(parsed.completedCount)
    const cancelledCount = Number(parsed.cancelledCount)
    const updatedAt = typeof parsed.updatedAt === 'string' ? parsed.updatedAt : ''

    if (
      !Number.isFinite(positiveSpend) ||
      !Number.isFinite(totalSaved) ||
      !Number.isFinite(orderCount) ||
      !Number.isFinite(completedCount) ||
      !Number.isFinite(cancelledCount) ||
      updatedAt.length === 0
    ) {
      window.localStorage.removeItem(storageKey)
      return null
    }

    return {
      positiveSpend,
      totalSaved,
      orderCount,
      completedCount,
      cancelledCount,
      updatedAt,
    }
  } catch {
    window.localStorage.removeItem(storageKey)
    return null
  }
}

function getSavedSummaryStorageKey(provider: PopupProvider): string {
  return `${SAVED_SUMMARY_KEY}.${provider}`
}

function readProviderFromStorage(): PopupProvider {
  const raw = window.localStorage.getItem(PROVIDER_SELECTION_KEY)
  return raw === 'lazada' ? 'lazada' : 'shopee'
}

function formatLastUpdatedLabel(updatedAt: string, formatter: Intl.DateTimeFormat): string {
  const date = new Date(updatedAt)
  if (Number.isNaN(date.getTime())) {
    return 'Last updated: recently'
  }

  return `Last updated: ${formatter.format(date)}`
}

function formatUserFriendlyOrderedAt(orderedAt: string): string {
  if (orderedAt === 'unknown') {
    return 'unknown'
  }

  const parsed = new Date(orderedAt)
  if (Number.isNaN(parsed.getTime())) {
    return orderedAt
  }

  return formatUserFriendlyDateTime(parsed)
}

function formatUserFriendlyDateTime(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0')
  const month = MONTH_NAMES[date.getMonth()] ?? 'Jan'
  const year = date.getFullYear()
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${day} ${month} ${year} ${hours}:${minutes}:${seconds}`
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function isConnectionError(message: string): boolean {
  return /(receiving end does not exist|could not establish connection|no tab with id|message port closed|extension context invalidated)/i.test(
    message,
  )
}

function formatTabConnectionError(provider: PopupProvider, failures: string[]): string {
  const combined = failures.join(' | ')
  const providerLabel = PROVIDER_LABEL[provider]

  if (/cannot access contents of url/i.test(combined)) {
    return `This ${providerLabel} page does not allow extension access yet. Open a regular ${providerLabel} orders page tab, then retry.`
  }

  if (/missing host permission/i.test(combined)) {
    return `This ${providerLabel} domain is not in extension permissions. Add the domain to manifest host_permissions and reload extension.`
  }

  if (isConnectionError(combined) || /no response from (shopee|lazada) page/i.test(combined)) {
    return `Unable to connect to ${providerLabel} tab. Refresh ${providerLabel} orders page and retry. If needed, reload extension in edge://extensions.`
  }

  return combined || `Unable to connect to ${providerLabel} tab.`
}

function normalizeProviderError(
  provider: PopupProvider,
  raw: string,
  mode: 'calculate' | 'detail',
): string {
  if (/(403|forbidden|blocked|failed to fetch)/i.test(raw)) {
    if (provider === 'shopee') {
      return mode === 'detail'
        ? 'Shopee blocked detail fetch. Keep My Purchase open, scroll once, disable blockers for Shopee, then retry.'
        : 'Shopee blocked this request. Keep My Purchase open, scroll once, disable blockers for Shopee, then retry.'
    }

    return mode === 'detail'
      ? 'Lazada blocked detail fetch. Keep My Orders open, scroll once, disable blockers for Lazada, then retry.'
      : 'Lazada blocked this request. Keep My Orders open, scroll once, disable blockers for Lazada, then retry.'
  }

  if (isConnectionError(raw)) {
    if (provider === 'shopee') {
      return 'ImongSpend cannot reach this Shopee tab. Refresh Shopee, then retry. If it persists, reload extension in edge://extensions.'
    }

    return 'ImongSpend cannot reach this Lazada tab. Refresh Lazada, then retry. If it persists, reload extension in edge://extensions.'
  }

  return raw
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  let timer: number | undefined

  try {
    const timeoutPromise = new Promise<T>((_, reject) => {
      timer = window.setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
    })

    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timer !== undefined) {
      window.clearTimeout(timer)
    }
  }
}
