import { useEffect, useMemo, useState } from 'react'
import type { ResearchCalculationResult, ResearchOrderRow } from '@shared/index'

type Stage = 'idle' | 'running' | 'done' | 'error'

type CalculationResponse =
  | { ok: true; result: ResearchCalculationResult }
  | { ok: false; error: string }

type DetailResponse =
  | { ok: true; rows: ResearchOrderRow[] }
  | { ok: false; error: string }

const STEPS = [
  'Open Shopee My Purchase in this browser.',
  'Click Calculate My Spending to fetch and compute totals locally.',
  'Review totals and export CSV if needed.',
]

const POLICY_DECISION_KEY = 'imongspend.popup.policy.decision.v1'
const POLICY_ACKNOWLEDGED_KEY = 'imongspend.popup.policy.acknowledged.v1'
const LEGACY_ONBOARDING_KEY = 'imongspend.popup.onboarding.accepted.v1'
const FAQ_URL = 'https://imongspend.com/faq'

type PolicyDecision = 'pending' | 'accepted'

const statusLabel: Record<Stage, string> = {
  idle: 'Ready',
  running: 'Calculating',
  done: 'Complete',
  error: 'Needs attention',
}

export function PopupApp() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [policyReady, setPolicyReady] = useState(false)
  const [policyDecision, setPolicyDecision] = useState<PolicyDecision>('pending')
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

  const currency = useMemo(
    () =>
      new Intl.NumberFormat('en-PH', {
        style: 'currency',
        currency: 'PHP',
        maximumFractionDigits: 2,
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
      const tabId = await getActiveTabId()
      const response = await withTimeout(
        sendResearchCalculation(tabId),
        30_000,
        'Calculation timed out. Keep Shopee My Purchase open, scroll once, then retry.',
      )

      if (!response.ok) {
        throw new Error(response.error)
      }

      setResult(response.result)
      setStage('done')
    } catch (unknownError) {
      const raw = unknownError instanceof Error ? unknownError.message : 'Unable to calculate now.'
      const normalized = /(403|forbidden|blocked|failed to fetch)/i.test(raw)
        ? 'Shopee blocked this request. Keep My Purchase open, scroll once, disable blockers for Shopee, then retry.'
        : isConnectionError(raw)
          ? 'ImongSpend cannot reach this Shopee tab. Refresh Shopee, then retry. If it persists, reload extension in edge://extensions.'
          : raw

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
      const orderIds = getUniqueKnownOrderIds(result.rows)

      if (orderIds.length === 0) {
        triggerCsvDownload(resultToCsv(result))
        setStage('done')
        return
      }

      const tabId = await getActiveTabId()
      const detailFetchTimeoutMs = estimateDetailFetchTimeoutMs(orderIds.length)
      const response = await withTimeout(
        sendOrderDetailsFetch(tabId, orderIds),
        detailFetchTimeoutMs,
        'Fetching order details timed out. Keep Shopee My Purchase open and retry.',
      )

      if (!response.ok) {
        throw new Error(response.error)
      }

      const mergedRows = mergeRowsWithDetails(result.rows, response.rows)
      const mergedResult: ResearchCalculationResult = {
        ...result,
        rows: mergedRows,
      }

      triggerCsvDownload(resultToCsv(mergedResult))

      setResult(mergedResult)
      setStage('done')
    } catch (unknownError) {
      const raw = unknownError instanceof Error ? unknownError.message : 'Unable to fetch order details now.'
      const normalized = /(403|forbidden|blocked|failed to fetch)/i.test(raw)
        ? 'Shopee blocked detail fetch. Keep My Purchase open, scroll once, disable blockers for Shopee, then retry.'
        : isConnectionError(raw)
          ? 'ImongSpend cannot reach this Shopee tab. Refresh Shopee, then retry. If it persists, reload extension in edge://extensions.'
          : raw

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
    setResult(null)
    setError(null)
    setStage('idle')
    setPolicyDecision('pending')
  }

  function handleOpenFaq(): void {
    window.open(FAQ_URL, '_blank', 'noopener,noreferrer')
  }

  const stageClass = `status-pill status-${stage}`
  const totalSpent = result?.positiveSpend ?? 0
  const totalOrders = result?.orderCount ?? 0

  if (!policyReady) {
    return <main className="panel panel-popup" aria-busy="true" />
  }

  if (policyDecision !== 'accepted') {
    return (
      <main className="panel panel-popup popup-shell">
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
            ImongSpend reads your Shopee purchase history from the active browser tab to calculate spending insights for you.
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
            <p className="kicker">Shopee Order Calculator</p>
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

      {settingsOpen ? (
        <section className="glass-card settings-card" aria-label="In-popup settings">
          <p className="subhead">Settings</p>

          <div className="settings-row">
            <span>Provider</span>
            <strong>Shopee (active)</strong>
          </div>

          <div className="settings-row">
            <span>Mode</span>
            <strong>Research</strong>
          </div>

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

      <button className="action-btn" onClick={() => void handleCalculate()} disabled={stage === 'running'}>
        {stage === 'running' ? 'Calculating Spend...' : 'Calculate My Spending'}
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
              <p>Estimated grand total</p>
              <strong>{currency.format(result.estimatedGrandTotal)}</strong>
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

          <p className="fineprint">{result.notes.join(' ')}</p>
        </section>
      ) : null}

      <section className="glass-card" aria-label="Steps">
        <p className="subhead">Steps</p>
        <ol className="step-list">
          {STEPS.map((step) => (
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
        | { type: 'IMONGSPEND_RESEARCH_CALCULATE'; payload: { maxPages: number } }
        | { type: 'IMONGSPEND_FETCH_ORDER_DETAILS'; payload: { orderIds: string[] } },
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

async function getActiveTabId(): Promise<number> {
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
    throw new Error('Open a Shopee tab first, then retry.')
  }

  if (!activeTab.url?.includes('shopee.')) {
    throw new Error('Active tab is not Shopee. Open Shopee My Purchase page first.')
  }

  if (!/\/user\/purchase/i.test(activeTab.url)) {
    throw new Error('Open Shopee My Purchase page first (URL should include /user/purchase), then retry.')
  }

  return activeTab.id
}

async function sendResearchCalculation(tabId: number): Promise<CalculationResponse> {
  const chromeRef = (globalThis as { chrome?: RuntimeWithLastError }).chrome
  if (!chromeRef?.tabs?.sendMessage) {
    throw new Error('Unable to communicate with active tab.')
  }

  const failures: string[] = []

  try {
    return await sendCalculationMessageOnce(chromeRef, tabId)
  } catch (unknownError) {
    const message = unknownError instanceof Error ? unknownError.message : 'Initial tab message failed.'
    failures.push(message)
  }

  try {
    await ensureContentScriptInjected(chromeRef, tabId)
    await sleep(120)
    return await sendCalculationMessageOnce(chromeRef, tabId)
  } catch (unknownError) {
    const message = unknownError instanceof Error ? unknownError.message : 'Script injection retry failed.'
    failures.push(message)
  }

  throw new Error(formatTabConnectionError(failures))
}

async function sendCalculationMessageOnce(
  chromeRef: RuntimeWithLastError,
  tabId: number,
): Promise<CalculationResponse> {
  return new Promise<CalculationResponse>((resolve, reject) => {
    chromeRef.tabs?.sendMessage(
      tabId,
      {
        type: 'IMONGSPEND_RESEARCH_CALCULATE',
        payload: { maxPages: 60 },
      },
      (response) => {
        const runtimeError = chromeRef.runtime?.lastError?.message
        if (runtimeError) {
          reject(new Error(runtimeError))
          return
        }

        if (!response) {
          reject(new Error('No response from Shopee page. Refresh and retry.'))
          return
        }

        if (typeof response !== 'object' || response === null || !('ok' in response)) {
          reject(new Error('Malformed response from Shopee page.'))
          return
        }

        resolve(response as CalculationResponse)
      },
    )
  })
}

async function sendOrderDetailsFetch(tabId: number, orderIds: string[]): Promise<DetailResponse> {
  const chromeRef = (globalThis as { chrome?: RuntimeWithLastError }).chrome
  if (!chromeRef?.tabs?.sendMessage) {
    throw new Error('Unable to communicate with active tab.')
  }

  const failures: string[] = []

  try {
    return await sendOrderDetailsMessageOnce(chromeRef, tabId, orderIds)
  } catch (unknownError) {
    const message = unknownError instanceof Error ? unknownError.message : 'Initial tab message failed.'
    failures.push(message)
  }

  try {
    await ensureContentScriptInjected(chromeRef, tabId)
    await sleep(120)
    return await sendOrderDetailsMessageOnce(chromeRef, tabId, orderIds)
  } catch (unknownError) {
    const message = unknownError instanceof Error ? unknownError.message : 'Script injection retry failed.'
    failures.push(message)
  }

  throw new Error(formatTabConnectionError(failures))
}

async function sendOrderDetailsMessageOnce(
  chromeRef: RuntimeWithLastError,
  tabId: number,
  orderIds: string[],
): Promise<DetailResponse> {
  return new Promise<DetailResponse>((resolve, reject) => {
    chromeRef.tabs?.sendMessage(
      tabId,
      {
        type: 'IMONGSPEND_FETCH_ORDER_DETAILS',
        payload: { orderIds },
      },
      (response) => {
        const runtimeError = chromeRef.runtime?.lastError?.message
        if (runtimeError) {
          reject(new Error(runtimeError))
          return
        }

        if (!response) {
          reject(new Error('No detail response from Shopee page. Refresh and retry.'))
          return
        }

        if (typeof response !== 'object' || response === null || !('ok' in response)) {
          reject(new Error('Malformed detail response from Shopee page.'))
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
  const lines: string[] = []
  lines.push(
    'order_id,ordered_at,status,shop_name,merchandise_subtotal,shipping_fee,shipping_discount_subtotal,shop_voucher_discount,order_total,payment_method,total_saved,amount,item_summary',
  )

  for (const row of result.rows) {
    const cols = [
      row.orderId,
      row.orderedAt,
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
    ]
    lines.push(cols.map(escapeCsv).join(','))
  }

  lines.push('')
  lines.push(`"positive_spend",${result.positiveSpend.toFixed(2)}`)
  lines.push(`"total_saved",${result.totalSaved.toFixed(2)}`)
  lines.push(`"total_adjustments",${result.totalAdjustments.toFixed(2)}`)
  lines.push(`"estimated_grand_total",${result.estimatedGrandTotal.toFixed(2)}`)
  lines.push(`"completed_count",${result.completedCount}`)
  lines.push(`"cancelled_count",${result.cancelledCount}`)
  lines.push(`"order_count",${result.orderCount}`)

  return lines.join('\n')
}

function escapeCsv(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

function triggerCsvDownload(csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `imongspend-shopee-${Date.now()}.csv`
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

function isConnectionError(message: string): boolean {
  return /(receiving end does not exist|could not establish connection|no tab with id|message port closed|extension context invalidated)/i.test(
    message,
  )
}

function formatTabConnectionError(failures: string[]): string {
  const combined = failures.join(' | ')

  if (/cannot access contents of url/i.test(combined)) {
    return 'This Shopee page does not allow extension access yet. Open a regular Shopee purchase page tab, then retry.'
  }

  if (/missing host permission/i.test(combined)) {
    return 'This Shopee domain is not in extension permissions. Add the domain to manifest host_permissions and reload extension.'
  }

  if (isConnectionError(combined) || /no response from shopee page/i.test(combined)) {
    return 'Unable to connect to Shopee tab. Refresh Shopee My Purchase page and retry. If needed, reload extension in edge://extensions.'
  }

  return combined || 'Unable to connect to Shopee tab.'
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
