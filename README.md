# ImongSpend

ImongSpend is a two-part project:

1. A landing page that explains the problem and captures early users.
2. A Chrome extension MVP that starts with Shopee spend estimation.

## MVP Scope

- Included now: landing page, extension scaffold, shared spend types, Shopee-first contracts.
- Not included now: production Shopee ingestion, Foodpanda/Grab integrations, advanced analytics dashboards.

## Project Structure

```txt
.
|- apps/
|  |- landing/      # Vite + React marketing site
|  |- extension/    # Chrome extension (Manifest V3)
|- packages/
|  |- shared/       # Shared types/provider contracts
|- .github/
|  |- copilot-instructions.md
|  |- agents/
|     |- mvp.agent.md
|- agent.md
```

## Commands

Run from the repository root:

- `npm run dev` starts the landing page.
- `npm run dev:landing` starts only landing.
- `npm run dev:extension` starts extension dev build.
- `npm run build` builds landing and extension.
- `npm run lint` lints landing and extension.
- `npm run typecheck` checks landing, extension, and shared package.

## Chrome Extension Notes

- The extension is scaffolded for Manifest V3.
- Current provider logic uses placeholder data contracts.
- Before implementing live Shopee extraction, verify legal and technical compliance for any data source (official APIs, exports, or allowed page parsing).

## Immediate Next Build Targets

1. Add waitlist capture backend for landing CTA.
2. Implement Shopee provider with a compliant data path.
3. Add tests for shared spend summarization logic.
