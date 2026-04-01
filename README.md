<img width="1200" height="630" alt="imong-spend" src="https://github.com/user-attachments/assets/ea97c58a-f566-48ff-9df4-49ef8a892e15" />

# ImongSpend

ImongSpend is a browser extension + landing page project for estimating marketplace spending without manual spreadsheet work.

Current focus:
- Supported providers in extension UI: Shopee and Lazada
- Landing page download/install flow for latest GitHub release
- Browser-first processing and local saved summaries

## Why this project exists

People often want quick visibility into order spending, but platform UIs are not optimized for simple total tracking across many orders. ImongSpend aims to:

- Pull order data from your active marketplace session
- Compute totals quickly in the extension popup
- Export CSV for review or budgeting

## Repository overview

This is an npm workspace monorepo with two apps and one shared package.

```txt
.
|- apps/
|  |- landing/       # Marketing/download site (Vite + React + TypeScript)
|  |- extension/     # Browser extension app (Manifest V3, Vite + React + TypeScript)
|- packages/
|  |- shared/        # Shared types and provider-facing domain helpers
|- docs/             # Product notes, investigations, and MVP docs
|- .github/workflows/
|  |- extension-cicd.yml
```

## Tech stack

- Runtime/build: Node.js + npm workspaces
- Frontend: React 19, TypeScript, Vite 8
- Linting: ESLint 9
- Extension model: Manifest V3
- CI/CD: GitHub Actions
- Landing deployment target: Vercel (`vercel.json`)

## Requirements

- Node.js 22+ recommended (CI uses Node 22)
- npm 10+

## Getting started

From repository root:

```bash
npm ci
```

### Run landing app

```bash
npm run dev
# or
npm run dev:landing
```

### Run extension dev build

```bash
npm run dev:extension
```

### Build everything

```bash
npm run build
```

### Quality checks

```bash
npm run lint
npm run typecheck
```

## Workspace scripts

Root-level scripts:

- `npm run dev` -> runs landing dev server
- `npm run dev:landing` -> runs `@imongspend/landing`
- `npm run dev:extension` -> runs `@imongspend/extension`
- `npm run build` -> builds landing + extension
- `npm run build:landing` -> builds landing only
- `npm run build:extension` -> builds extension only
- `npm run lint` -> lints landing + extension
- `npm run typecheck` -> typechecks landing + extension + shared
- `npm run preview` -> previews landing build

## Browser extension usage

### Load unpacked in Chromium browsers (Chrome/Edge/Brave/Opera)

1. Build extension:

   ```bash
   npm run build:extension
   ```

2. Open your browser extension manager:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
   - Brave: `brave://extensions`
   - Opera: `opera://extensions`

3. Enable Developer mode.
4. Click **Load unpacked**.
5. Select `apps/extension/dist`.

If you see `Manifest file is missing or unreadable`, you likely selected the wrong folder.

### Basic in-product flow

1. Open your Shopee or Lazada orders page.
2. Open the ImongSpend extension popup.
3. Click **Calculate My Spending**.
4. Review totals and optionally export CSV.

## Landing page behavior

Landing app (`apps/landing`) includes:

- Install CTA that resolves latest release asset from GitHub API
- Clear Setup view with browser-specific setup steps
- Data Policy page and FAQ section

## Data handling (project-level summary)

- Extension calculations run in your browser session.
- ImongSpend does not require a separate app account.
- Full order history is not uploaded to an ImongSpend backend database.
- Saved summaries/preferences are stored locally (browser localStorage).

Always validate this behavior against current code before publishing legal/privacy claims.

## CI/CD and releases

GitHub Actions workflow: `.github/workflows/extension-cicd.yml`

- On PR to `main`: lint, typecheck, and build extension (checks only)
- On push to `main`: lint/typecheck/build, then auto-publish extension release
- Auto release tag format: `v<major>.<minor>.<patch>` and computed from the higher of:
  - patch bump of latest merged `v*` tag on `main`/`HEAD`
  - current extension version in `apps/extension/public/manifest.json` / `apps/extension/package.json`
- Extension `version` is synced to the new tag in both `apps/extension/public/manifest.json` and `apps/extension/package.json` before packaging
- If `HEAD` already has a `v*` tag, auto-release is skipped to avoid duplicates
- Workflow fails if manifest/package versions are invalid or mismatched
- Release notes are generated from commit messages since the previous tag
- Release job uses a `main`-scoped concurrency group to serialize version/tag creation and avoid race conditions on rapid consecutive merges

Release artifact format:
- `imongspend-extension-vX.Y.Z.zip`
- Zip root contains a single folder: `imongspend-extension-vX.Y.Z/` (to avoid scattered files on "Extract Here")

## Useful paths

- Landing app entry: `apps/landing/src/App.tsx`
- Extension popup entry: `apps/extension/src/popup/PopupApp.tsx`
- Extension manifest: `apps/extension/public/manifest.json`
- Shared exports: `packages/shared/src/index.ts`

## Notes for contributors

- Keep changes scoped by workspace (`apps/landing`, `apps/extension`, `packages/shared`).
- Run `npm run typecheck` before opening PRs.
- For extension host/domain behavior, verify manifest permissions and content script matches.

---

If you are a user looking to install quickly, use the landing page Install button and follow the Clear Setup guide.
