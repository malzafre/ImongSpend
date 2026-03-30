import { useMemo, useState } from 'react'
import type { ResearchCalculationResult } from '@shared/index'

type Stage = 'idle' | 'running' | 'done' | 'error'

const STEPS = [
  'Open Shopee My Purchase in this browser.',
  'Confirm consent below.',
  'Run calculator to fetch and compute totals locally.',
  'Review totals and export CSV if needed.',
]

const statusLabel: Record<Stage, string> = {
  idle: 'Ready',
  running: 'Calculating',
  done: 'Complete',
  error: 'Needs attention',
}

export function PopupApp() {
  const [consent, setConsent] = useState(false)
  const [stage, setStage] = useState<Stage>('idle')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ResearchCalculationResult | null>(null)

  const currency = useMemo(
    () =>
      new Intl.NumberFormat('en-PH', {
        style: 'currency',
        currency: 'PHP',
        maximumFractionDigits: 2,
      }),
    [],
  )

  const startedAt = result ? formatDate(result.from) : '--'
  const endedAt = result ? formatDate(result.to) : '--'

  async function handleCalculate(): Promise<void> {
    setError(null)

    if (!consent) {
      setStage('error')
      setError('Please confirm consent before calculation.')
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

  function handleDownloadCsv(): void {
    if (!result) {
      return
    }

    const csv = resultToCsv(result)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `imongspend-shopee-${Date.now()}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  function handleReset(): void {
    setResult(null)
    setError(null)
    setStage('idle')
  }

  const stageClass = `status-pill status-${stage}`

  return (
    <main className="panel panel-popup">
      <div className="aurora" aria-hidden="true" />

      <header className="hero">
        <p className="kicker">Shopee Research Calculator</p>
        <h1>ImongSpend</h1>
        <p className="hero-copy">
          Lean mode: fast total estimate with local-only processing in your current session.
        </p>
        <div className={stageClass}>{statusLabel[stage]}</div>
      </header>

      <section className="glass-card" aria-label="Steps">
        <p className="subhead">How It Works</p>
        <ol className="step-list">
          {STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>

      <label className="consent-toggle">
        <input
          type="checkbox"
          checked={consent}
          onChange={(event) => setConsent(event.currentTarget.checked)}
        />
        <span>I understand this is research mode and totals may be incomplete.</span>
      </label>

      <button
        className="action-btn"
        onClick={() => void handleCalculate()}
        disabled={stage === 'running'}
      >
        {stage === 'running' ? 'Calculating Spend...' : 'Calculate My Shopee Spend'}
      </button>

      {error ? <p className="error-text">{error}</p> : null}

      {result ? (
        <section className="result-shell" aria-label="Results">
          <div className="result-top">
            <p className="subhead">Total Spent (Final Total)</p>
            <p className="amount">{currency.format(result.positiveSpend)}</p>
          </div>

          <div className="stats-grid">
            <article className="stat-chip">
              <p>Total orders scanned</p>
              <strong>{result.orderCount.toLocaleString()}</strong>
            </article>
            <article className="stat-chip">
              <p>Completed orders</p>
              <strong>{result.completedCount.toLocaleString()}</strong>
            </article>
            <article className="stat-chip">
              <p>Cancelled orders</p>
              <strong>{result.cancelledCount.toLocaleString()}</strong>
            </article>
            <article className="stat-chip">
              <p>Total saved</p>
              <strong>{currency.format(result.totalSaved)}</strong>
            </article>
            <article className="stat-chip">
              <p>Adjustments</p>
              <strong>{currency.format(result.totalAdjustments)}</strong>
            </article>
            <article className="stat-chip">
              <p>Merchandise subtotal</p>
              <strong>{currency.format(sumRows(result.rows.map((row) => row.merchandiseSubtotal)))}</strong>
            </article>
          </div>

          <div className="timeline">
            <span>{startedAt}</span>
            <span>{endedAt}</span>
          </div>

          <div className="button-row">
            <button className="download-btn" onClick={handleDownloadCsv}>
              Download CSV
            </button>
            <button className="secondary-btn" onClick={handleReset}>
              Clear Result
            </button>
          </div>

          <p className="fineprint">{result.notes.join(' ')}</p>
        </section>
      ) : null}
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
      message: { type: 'IMONGSPEND_RESEARCH_CALCULATE'; payload: { maxPages: number } },
      callback: (response?: ResponseMessage) => void,
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

type ResponseMessage =
  | { ok: true; result: ResearchCalculationResult }
  | { ok: false; error: string }

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

async function sendResearchCalculation(tabId: number): Promise<ResponseMessage> {
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
): Promise<ResponseMessage> {
  return new Promise<ResponseMessage>((resolve, reject) => {
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

        resolve(response)
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
    'order_id,ordered_at,status,shop_name,merchandise_subtotal,shipping_fee,shipping_discount_subtotal,order_total,payment_method,total_saved,amount,adjustment,item_summary',
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
      row.orderTotal.toFixed(2),
      row.paymentMethod,
      row.totalSaved.toFixed(2),
      row.amount.toFixed(2),
      row.adjustmentAmount.toFixed(2),
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

function formatDate(iso: string): string {
  if (iso === 'unknown') {
    return 'Date unknown'
  }

  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) {
    return 'Date unknown'
  }

  return parsed.toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  })
}

function sumRows(values: number[]): number {
  const total = values.reduce((acc, value) => acc + value, 0)
  return Math.round(total * 100) / 100
}
