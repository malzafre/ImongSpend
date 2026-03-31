import './App.css'
import heroGraphic from './assets/landing-hero.webp'
import brandLogo from './assets/extension-logo.webp'

function App() {
  const installUrl = 'https://github.com/malzafre/ImongSpend'
  const githubUrl = 'https://github.com/malzafre/ImongSpend'

  const flow = [
    {
      title: 'Install in Chrome',
      detail:
        'Install the extension from our public GitHub repo today while the Chrome Web Store listing is in progress.',
    },
    {
      title: 'Open your Shopee history',
      detail:
        'Choose your range and let ImongSpend pull the spending entries you already have in your orders.',
    },
    {
      title: 'Get your total in minutes',
      detail:
        'See your total spend fast, then export when you need a quick report for budgeting and planning.',
    },
  ]

  const faqs = [
    {
      question: 'Is this only for Shopee right now?',
      answer:
        'Yes. We are focused on making Shopee estimation reliable first, then we will expand to more platforms.',
    },
    {
      question: 'Do I need to create an account?',
      answer:
        'No account required. Install the extension, open Shopee, and run your estimate directly from Chrome.',
    },
    {
      question: 'Will this work for old orders?',
      answer:
        'Yes, as long as the orders are visible in your account history and inside your selected date range.',
    },
    {
      question: 'Is the project public?',
      answer:
        'Yes. ImongSpend is open for public review on GitHub so you can follow updates and upcoming releases.',
    },
  ]

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
            <a className="btn btn-primary" href={installUrl} target="_blank" rel="noreferrer">
              Install via GitHub
            </a>
            <a className="btn btn-secondary" href="#how-it-works">
              How it works
            </a>
          </div>
          <p className="hero-note">Friendly, Shopee-first, and built to save you time.</p>
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
        <a href={githubUrl} target="_blank" rel="noreferrer">
          GitHub repository
        </a>
      </footer>

      <p className="page-credit">© 2026 ImongSend.</p>
    </main>
  )
}

export default App
