import type { ResearchCalculationResult, ResearchOrderRow } from '@shared/index'
import { buildResearchResult } from './calculate'
import {
  collectOrderDetailsViaPageBridge,
  collectRowsViaContentApi,
  collectRowsViaPageBridge,
  withStageTimeout,
} from './pipeline'

type RequestMessage =
  | {
      type: 'IMONGSPEND_RESEARCH_CALCULATE'
      payload?: {
        maxPages?: number
      }
    }
  | {
      type: 'IMONGSPEND_FETCH_ORDER_DETAILS'
      payload?: {
        orderIds?: string[]
      }
    }

type ResponseMessage =
  | { ok: true; result: ResearchCalculationResult }
  | { ok: true; rows: ResearchOrderRow[] }
  | { ok: false; error: string }

type RuntimeLike = {
  runtime?: {
    onMessage?: {
      addListener: (
        callback: (
          message: unknown,
          sender: unknown,
          sendResponse: (response: ResponseMessage) => void,
        ) => boolean | void,
      ) => void
    }
  }
}

const runtime = (globalThis as { chrome?: RuntimeLike }).chrome?.runtime

runtime?.onMessage?.addListener((message, _sender, sendResponse) => {
  const typed = message as RequestMessage
  if (!typed?.type) {
    return
  }

  if (typed.type === 'IMONGSPEND_FETCH_ORDER_DETAILS') {
    const orderIds = Array.isArray(typed.payload?.orderIds) ? typed.payload.orderIds : []

    void collectOrderDetailsViaPageBridge(orderIds)
      .then((rows) => sendResponse({ ok: true, rows }))
      .catch((error: unknown) => {
        const messageText = error instanceof Error ? error.message : 'Unexpected error'
        sendResponse({ ok: false, error: messageText })
      })

    return true
  }

  if (typed.type !== 'IMONGSPEND_RESEARCH_CALCULATE') {
    return
  }

  void runResearchCalculation(typed.payload?.maxPages)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error: unknown) => {
      const messageText = error instanceof Error ? error.message : 'Unexpected error'
      sendResponse({ ok: false, error: messageText })
    })

  return true
})

async function runResearchCalculation(maxPagesInput?: number): Promise<ResearchCalculationResult> {
  const maxPages = clampMaxPages(maxPagesInput)
  const notes: string[] = []

  try {
    const bridgeResult = await withStageTimeout(
      collectRowsViaPageBridge(maxPages),
      12_000,
      'Page-context collection timed out.',
    )

    if (bridgeResult.notes.length > 0) {
      notes.push(...bridgeResult.notes)
    }
    return buildResearchResult(bridgeResult.rows, notes)
  } catch (error) {
    void error
  }

  const apiResult = await withStageTimeout(
    collectRowsViaContentApi(maxPages),
    8_000,
    'Content API collection timed out.',
  )

  if (apiResult.notes.length > 0) {
    notes.push(...apiResult.notes)
  }

  return buildResearchResult(apiResult.rows, notes)
}

function clampMaxPages(input: number | undefined): number {
  if (!input || Number.isNaN(input)) {
    return 30
  }

  return Math.max(1, Math.min(120, Math.floor(input)))
}

console.info('[ImongSpend] Content script ready (lean calculator mode).')
