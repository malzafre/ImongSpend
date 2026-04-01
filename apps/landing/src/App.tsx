import { useEffect, useState } from 'react'
import './App.css'
import heroGraphic from './assets/landing-hero.webp'
import brandLogo from './assets/extension-logo.webp'

type GitHubReleaseAsset = {
  name: string
  browser_download_url: string
  content_type?: string
}

type GitHubRelease = {
  html_url?: string
  tag_name?: string
  assets: GitHubReleaseAsset[]
}

type CachedGitHubRelease = {
  ts: number
  data: GitHubRelease
}

type InstallStep = {
  title: string
  detail: string
}

type SetupBrowser = 'chrome' | 'edge' | 'brave' | 'opera' | 'firefox' | 'other'

type SetupGuide = {
  description: string
  steps: InstallStep[]
  supportNote?: string
}

const RELEASE_CACHE_TTL_MS = 1000 * 60 * 60
const CLEAR_SETUP_HASH = '#clear-setup'
const DATA_POLICY_HASH = '#data-policy'

type AppRoute = 'landing' | 'clear-setup' | 'data-policy'

const BROWSER_OPTIONS: Array<{ id: SetupBrowser; label: string }> = [
  { id: 'chrome', label: 'Chrome' },
  { id: 'edge', label: 'Edge' },
  { id: 'brave', label: 'Brave' },
  { id: 'opera', label: 'Opera' },
  { id: 'firefox', label: 'Firefox' },
  { id: 'other', label: 'Other' },
]

const SETUP_GUIDES: Record<SetupBrowser, SetupGuide> = {
  chrome: {
    description: 'Your download has started. Follow these Chrome steps to finish setup.',
    steps: [
      {
        title: 'Download the latest package',
        detail: 'Use the button below to grab the newest extension package from GitHub Releases.',
      },
      {
        title: 'Unzip the downloaded file',
        detail:
          'Extract the zip to a folder you can keep, since Chrome loads the extension directly from that location.',
      },
      {
        title: 'Open Chrome extension settings',
        detail: 'In Chrome, go to chrome://extensions and toggle Developer mode in the top-right corner.',
      },
      {
        title: 'Load the extension folder',
        detail:
          'Click Load unpacked, choose the extracted folder, and confirm. ImongSpend should appear in your extension list.',
      },
    ],
  },
  edge: {
    description: 'Your download has started. Follow these Edge steps to finish setup.',
    steps: [
      {
        title: 'Download the latest package',
        detail: 'Use the button below to grab the newest extension package from GitHub Releases.',
      },
      {
        title: 'Unzip the downloaded file',
        detail:
          'Extract the zip to a folder you can keep, since Edge loads the extension directly from that location.',
      },
      {
        title: 'Open Edge extension settings',
        detail: 'In Edge, go to edge://extensions and enable Developer mode from the left panel.',
      },
      {
        title: 'Load unpacked extension',
        detail:
          'Click Load unpacked, select the extracted folder, and confirm. ImongSpend should show in your extensions.',
      },
    ],
  },
  brave: {
    description: 'Your download has started. Follow these Brave steps to finish setup.',
    steps: [
      {
        title: 'Download the latest package',
        detail: 'Use the button below to grab the newest extension package from GitHub Releases.',
      },
      {
        title: 'Unzip the downloaded file',
        detail:
          'Extract the zip to a folder you can keep, since Brave loads the extension directly from that location.',
      },
      {
        title: 'Open Brave extension settings',
        detail: 'In Brave, go to brave://extensions and toggle Developer mode in the top-right corner.',
      },
      {
        title: 'Load the extension folder',
        detail:
          'Click Load unpacked, choose the extracted folder, and confirm. ImongSpend should appear in your extension list.',
      },
    ],
  },
  opera: {
    description: 'Your download has started. Follow these Opera steps to finish setup.',
    steps: [
      {
        title: 'Download the latest package',
        detail: 'Use the button below to grab the newest extension package from GitHub Releases.',
      },
      {
        title: 'Unzip the downloaded file',
        detail:
          'Extract the zip to a folder you can keep, since Opera loads the extension directly from that location.',
      },
      {
        title: 'Open Opera extension manager',
        detail: 'In Opera, go to opera://extensions and enable Developer mode.',
      },
      {
        title: 'Load unpacked extension',
        detail:
          'Click Load unpacked, choose the extracted folder, and confirm. ImongSpend should appear in your extension list.',
      },
    ],
  },
  firefox: {
    description: 'Your download has started. You can test setup in Firefox with temporary loading.',
    supportNote:
      'Firefox uses temporary loading for unpacked installs. For persistent installs, use Chrome, Edge, Brave, or Opera.',
    steps: [
      {
        title: 'Download the latest package',
        detail: 'Use the button below to grab the newest extension package from GitHub Releases.',
      },
      {
        title: 'Unzip the downloaded file',
        detail: 'Extract the zip so the extension folder contains the manifest file.',
      },
      {
        title: 'Open Firefox debugging add-ons',
        detail: 'In Firefox, go to about:debugging#/runtime/this-firefox.',
      },
      {
        title: 'Load temporary add-on',
        detail:
          'Click Load Temporary Add-on and choose the manifest file from the extracted folder. You need to reload it after browser restart.',
      },
    ],
  },
  other: {
    description: 'Your download has started. Follow your browser-specific extension loading flow.',
    supportNote:
      'ImongSpend is optimized for Chromium browsers. If your browser cannot load unpacked extensions, use Chrome, Edge, Brave, or Opera.',
    steps: [
      {
        title: 'Download the latest package',
        detail: 'Use the button below to grab the newest extension package from GitHub Releases.',
      },
      {
        title: 'Unzip the downloaded file',
        detail: 'Extract the zip so you have an extension folder ready to load.',
      },
      {
        title: 'Open your extension manager',
        detail: 'Find your browser extension settings page and enable developer mode if available.',
      },
      {
        title: 'Load unpacked extension',
        detail:
          'Use the browser option to load an unpacked extension, then select the extracted ImongSpend folder.',
      },
    ],
  },
}

function resolveRouteFromHash(hash: string): AppRoute {
  if (hash === CLEAR_SETUP_HASH) {
    return 'clear-setup'
  }

  if (hash === DATA_POLICY_HASH) {
    return 'data-policy'
  }

  return 'landing'
}

async function resolveSetupBrowser(): Promise<SetupBrowser> {
  const userAgent = navigator.userAgent

  if (userAgent.includes('Edg/')) {
    return 'edge'
  }

  if (userAgent.includes('OPR/')) {
    return 'opera'
  }

  if (userAgent.includes('Firefox/')) {
    return 'firefox'
  }

  const navigatorWithBrave = navigator as Navigator & {
    brave?: { isBrave?: () => Promise<boolean> }
  }

  if (navigatorWithBrave.brave?.isBrave) {
    try {
      const isBrave = await navigatorWithBrave.brave.isBrave()

      if (isBrave) {
        return 'brave'
      }
    } catch {
      // Continue to user-agent checks.
    }
  }

  if (userAgent.includes('Chrome/')) {
    return 'chrome'
  }

  return 'other'
}

function pickInstallAsset(assets: GitHubReleaseAsset[]): GitHubReleaseAsset | undefined {
  const archiveAsset = assets.find((asset) => {
    const normalizedName = asset.name.toLowerCase()
    const normalizedContentType = asset.content_type?.toLowerCase() ?? ''

    return (
      normalizedName.endsWith('.zip') ||
      normalizedName.endsWith('.crx') ||
      normalizedContentType.includes('zip') ||
      normalizedContentType.includes('chrome')
    )
  })

  return archiveAsset ?? assets[0]
}

function resolveInstallState(release: GitHubRelease, fallbackUrl: string) {
  const asset = pickInstallAsset(release.assets)
  const resolvedTag = release.tag_name ? ` (${release.tag_name})` : ''

  if (asset) {
    return {
      url: asset.browser_download_url,
      note: `Latest package: ${asset.name}${resolvedTag}`,
    }
  }

  return {
    url: release.html_url || fallbackUrl,
    note: `No uploaded package found in the latest release${resolvedTag}. Opening release page instead.`,
  }
}

function readReleaseCache(cacheKey: string): GitHubRelease | null {
  try {
    const raw = sessionStorage.getItem(cacheKey)

    if (!raw) {
      return null
    }

    const cached = JSON.parse(raw) as CachedGitHubRelease

    if (!cached.ts || !cached.data || Date.now() - cached.ts > RELEASE_CACHE_TTL_MS) {
      sessionStorage.removeItem(cacheKey)
      return null
    }

    return cached.data
  } catch {
    return null
  }
}

function writeReleaseCache(cacheKey: string, data: GitHubRelease) {
  try {
    const payload: CachedGitHubRelease = {
      ts: Date.now(),
      data,
    }
    sessionStorage.setItem(cacheKey, JSON.stringify(payload))
  } catch {
    // Ignore storage errors and continue without cache.
  }
}

function App() {
  const githubOwner = 'malzafre'
  const githubRepo = 'ImongSpend'
  const githubUrl = `https://github.com/${githubOwner}/${githubRepo}`
  const latestReleasePageUrl = `${githubUrl}/releases/latest`
  const latestReleaseApiUrl = `https://api.github.com/repos/${githubOwner}/${githubRepo}/releases/latest`
  const releaseCacheKey = `${githubOwner.toLowerCase()}_${githubRepo.toLowerCase()}_latest_release`

  const [installUrl, setInstallUrl] = useState(latestReleasePageUrl)
  const [installNote, setInstallNote] = useState('Resolving the latest install package...')
  const [route, setRoute] = useState<AppRoute>(() => resolveRouteFromHash(window.location.hash))
  const [setupBrowser, setSetupBrowser] = useState<SetupBrowser>('chrome')

  useEffect(() => {
    const syncRoute = () => {
      setRoute(resolveRouteFromHash(window.location.hash))
    }

    window.addEventListener('hashchange', syncRoute)

    return () => {
      window.removeEventListener('hashchange', syncRoute)
    }
  }, [])

  useEffect(() => {
    let isActive = true

    const detectSetupBrowser = async () => {
      const browser = await resolveSetupBrowser()

      if (!isActive) {
        return
      }

      setSetupBrowser(browser)
    }

    void detectSetupBrowser()

    return () => {
      isActive = false
    }
  }, [])

  useEffect(() => {
    let isActive = true

    const resolveInstallUrl = async () => {
      const cachedRelease = readReleaseCache(releaseCacheKey)

      if (cachedRelease && isActive) {
        const cachedState = resolveInstallState(cachedRelease, latestReleasePageUrl)
        setInstallUrl(cachedState.url)
        setInstallNote(`${cachedState.note} (cached)`)
      }

      try {
        const response = await fetch(latestReleaseApiUrl, {
          headers: {
            Accept: 'application/vnd.github+json',
          },
        })

        if (!response.ok) {
          throw new Error(`GitHub release request failed: ${response.status}`)
        }

        const payload = (await response.json()) as GitHubRelease
        const release: GitHubRelease = {
          html_url: payload.html_url,
          tag_name: payload.tag_name,
          assets: Array.isArray(payload.assets) ? payload.assets : [],
        }

        if (!isActive) {
          return
        }

        writeReleaseCache(releaseCacheKey, release)

        const resolvedState = resolveInstallState(release, latestReleasePageUrl)
        setInstallUrl(resolvedState.url)
        setInstallNote(resolvedState.note)
      } catch {
        if (!isActive) {
          return
        }

        setInstallUrl(latestReleasePageUrl)
        setInstallNote(
          'GitHub API is unavailable right now. Opening latest release page instead.'
        )
      }
    }

    void resolveInstallUrl()

    return () => {
      isActive = false
    }
  }, [latestReleaseApiUrl, latestReleasePageUrl, releaseCacheKey])

  const flow = [
    {
      title: 'Install in your browser',
      detail:
        'Install right here from this page, then follow the Clear Setup guide for your browser.',
    },
    {
      title: 'Open your Shopee orders',
      detail:
        'Open your order history and let ImongSpend pull the spending entries already in your account.',
    },
    {
      title: 'Get your total in minutes',
      detail:
        'See the total fast, then export a CSV to witness exactly how much your checkout button has cost you.',
    },
  ]

  const faqs = [
    {
      question: 'Is this only for Shopee right now?',
      answer:
        'Yes for now. We are focused on making Shopee estimation reliable first, then we will expand to more platforms.',
    },
    {
      question: 'Which browsers are supported?',
      answer:
        'Best experience is on Chrome, Edge, Brave, and Opera. Firefox can load it temporarily through about:debugging, but it needs reloading after restart.',
    },
    {
      question: 'Do I need to create an account?',
      answer:
        'No account required. Install the extension, open Shopee, and run your estimate directly in your browser.',
    },
    {
      question: 'How do I install the latest version?',
      answer:
        'Click Install latest release on this page. The package downloads immediately, then Clear Setup walks you through loading it step by step.',
    },
    {
      question: 'How is my order data handled?',
      answer:
        'ImongSpend processes order data in your browser session to compute totals. It is designed to keep processing local while you are signed in to your marketplace account.',
    },
    {
      question: 'Do you upload my order history to ImongSpend servers?',
      answer:
        'No dedicated ImongSpend backend receives your full order history. The extension requests marketplace data from your browser session and stores summaries locally on your device.',
    },
    {
      question: 'Where can I read your data policy?',
      answer:
        'Open the Data Policy page linked in the footer for details on what is read, what is stored, and what is not collected.',
    },
    {
      question: 'Is the project public?',
      answer:
        'Yes. ImongSpend is open for public review on GitHub so you can follow updates and upcoming releases.',
    },
  ]

  const setupGuide = SETUP_GUIDES[setupBrowser]
  const browserLabel =
    BROWSER_OPTIONS.find((option) => option.id === setupBrowser)?.label ?? 'your browser'

  const openInstallAsset = () => {
    const installLink = document.createElement('a')
    installLink.href = installUrl
    installLink.target = '_blank'
    installLink.rel = 'noreferrer noopener'
    document.body.append(installLink)
    installLink.click()
    installLink.remove()
  }

  const handleInstallClick = () => {
    openInstallAsset()
    window.location.hash = CLEAR_SETUP_HASH
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (route === 'data-policy') {
    return (
      <main className="landing">
        <header className="topbar">
          <a className="brand" href="#home" aria-label="ImongSpend home">
            <img src={brandLogo} alt="ImongSpend logo" />
            <span>ImongSpend</span>
          </a>
          <a className="top-link" href={githubUrl} target="_blank" rel="noreferrer">
            View on GitHub
          </a>
        </header>

        <section className="policy-page" aria-label="Data policy">
          <div className="section-head">
            <p className="eyebrow">Data Policy</p>
            <h1>How ImongSpend handles your data</h1>
          </div>

          <p className="hero-copy">
            ImongSpend is built to estimate spending with minimal data exposure. This
            page explains what the extension reads, where data is stored, and what we do
            not collect.
          </p>

          <div className="policy-grid">
            <article className="policy-card">
              <h3>What we read</h3>
              <p>
                While you are signed in, the extension reads order information already
                available in supported marketplace pages to calculate your totals.
              </p>
            </article>

            <article className="policy-card">
              <h3>How processing works</h3>
              <p>
                Calculations run in your browser session. ImongSpend does not require an
                account and does not rely on a dedicated backend to process full order
                history.
              </p>
            </article>

            <article className="policy-card">
              <h3>What is stored</h3>
              <p>
                Saved summaries and setup preferences are stored locally on your device so
                you can reopen recent results faster.
              </p>
            </article>

            <article className="policy-card">
              <h3>What we do not collect</h3>
              <p>
                We do not ask for a separate ImongSpend login and we do not intentionally
                collect sensitive credentials like your marketplace password.
              </p>
            </article>
          </div>

          <p className="setup-support-note">
            This page is a product-level data policy summary and may be updated as
            features evolve.
          </p>

          <div className="setup-actions">
            <a className="btn btn-secondary" href="#home">
              Back to landing page
            </a>
            <a className="btn btn-secondary" href="#faq">
              Jump to FAQs
            </a>
          </div>
        </section>

        <footer className="footer">
          <p className="eyebrow">ImongSpend</p>
          <p>
            We are building a clean way to understand online spend without painful
            spreadsheets.
          </p>
          <div className="footer-links">
            <a href={githubUrl} target="_blank" rel="noreferrer">
              GitHub repository
            </a>
            <a href={DATA_POLICY_HASH}>Data policy</a>
          </div>
        </footer>

        <p className="page-credit">© 2026 ImongSpend.</p>
      </main>
    )
  }

  if (route === 'clear-setup') {
    return (
      <main className="landing">
        <header className="topbar">
          <a className="brand" href="#home" aria-label="ImongSpend home">
            <img src={brandLogo} alt="ImongSpend logo" />
            <span>ImongSpend</span>
          </a>
          <a className="top-link" href={githubUrl} target="_blank" rel="noreferrer">
            View on GitHub
          </a>
        </header>

        <section className="setup-page" aria-label="Clear setup page">
          <div className="section-head">
            <p className="eyebrow">Clear Setup</p>
            <h1>Finish {browserLabel} setup in four clear steps</h1>
          </div>

          <p className="hero-copy">{setupGuide.description}</p>

          <div className="browser-picker" role="group" aria-label="Select setup browser">
            {BROWSER_OPTIONS.map((option) => (
              <button
                key={option.id}
                className={`browser-chip ${setupBrowser === option.id ? 'is-active' : ''}`}
                type="button"
                onClick={() => setSetupBrowser(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>

          {setupGuide.supportNote ? <p className="setup-support-note">{setupGuide.supportNote}</p> : null}

          <ol className="install-steps">
            {setupGuide.steps.map((step, index) => (
              <li className="install-step" key={step.title}>
                <p className="step-number">0{index + 1}</p>
                <h3>{step.title}</h3>
                <p>{step.detail}</p>
              </li>
            ))}
          </ol>

          <div className="setup-download-row">
            <p className="hero-note setup-download-note">{installNote}</p>
            <button className="btn btn-primary" type="button" onClick={handleInstallClick}>
              Download latest release again
            </button>
          </div>

          <div className="setup-actions">
            <a className="btn btn-secondary" href="#home">
              Back to landing page
            </a>
            <a className="btn btn-secondary" href={latestReleasePageUrl} target="_blank" rel="noreferrer">
              View all releases
            </a>
          </div>
        </section>

        <footer className="footer">
          <p className="eyebrow">ImongSpend</p>
          <p>
            We are building a clean way to understand online spend without painful
            spreadsheets.
          </p>
          <div className="footer-links">
            <a href={githubUrl} target="_blank" rel="noreferrer">
              GitHub repository
            </a>
            <a href={DATA_POLICY_HASH}>Data policy</a>
          </div>
        </footer>

        <p className="page-credit">© 2026 ImongSpend.</p>
      </main>
    )
  }

  return (
    <main className="landing">
      <header className="topbar">
        <a className="brand" href="/" aria-label="ImongSpend home">
          <img src={brandLogo} alt="ImongSpend logo" />
          <span>ImongSpend</span>
        </a>
        <a className="top-link" href={githubUrl} target="_blank" rel="noreferrer">
          View on GitHub
        </a>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">Chrome Extension</p>
          <h1>Know your Shopee spending in minutes, not in spreadsheet marathons.</h1>
          <p className="hero-copy">
            ImongSpend keeps spending reviews simple. Open Shopee, run the extension,
            and get a clean total you can actually use for planning.
          </p>
          <div className="hero-actions">
            <button className="btn btn-primary" type="button" onClick={handleInstallClick}>
              Install latest release
            </button>
            <a className="btn btn-secondary" href="#how-it-works">
              How it works
            </a>
          </div>
          <p className="hero-note">
            Shopper-friendly and built to save you time.
          </p>
        </div>

        <aside className="hero-visual" aria-hidden="true">
          <img src={heroGraphic} alt="" />
          <p>Minimal workflow. Clear numbers. Less manual tracking.</p>
        </aside>
      </section>

      <section className="how" id="how-it-works" aria-label="How ImongSpend works">
        <div className="section-head">
          <p className="eyebrow">How it works</p>
          <h2>From install to spend summary in three quick steps</h2>
        </div>
        <ol className="step-grid">
          {flow.map((step, index) => (
            <li className="step-card" key={step.title}>
              <p className="step-number">0{index + 1}</p>
              <h3>{step.title}</h3>
              <p>{step.detail}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="faq" id="faq" aria-label="Frequently asked questions">
        <div className="section-head">
          <p className="eyebrow">FAQ</p>
          <h2>Quick answers before you install</h2>
        </div>
        <div className="faq-list">
          {faqs.map((item) => (
            <details className="faq-item" key={item.question}>
              <summary>{item.question}</summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <footer className="footer">
        <p className="eyebrow">ImongSpend</p>
        <p>
          We are building a clean way to understand online spend without painful
          spreadsheets.
        </p>
        <div className="footer-links">
          <a href={githubUrl} target="_blank" rel="noreferrer">
            GitHub repository
          </a>
          <a href={DATA_POLICY_HASH}>Data policy</a>
        </div>
      </footer>

      <p className="page-credit">© 2026 ImongSpend.</p>
    </main>
  )
}

export default App
