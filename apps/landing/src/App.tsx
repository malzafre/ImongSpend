import './App.css'

function App() {
  const platformCards = [
    {
      title: 'Shopee Orders',
      detail: 'Scan and summarize order history into one spending number.',
      status: 'MVP target',
    },
    {
      title: 'Foodpanda',
      detail: 'Planned after Shopee validation and data pipeline hardening.',
      status: 'Backlog',
    },
    {
      title: 'Grab',
      detail: 'Planned after Shopee with transport and food category mapping.',
      status: 'Backlog',
    },
  ]

  const flow = [
    'Install the extension in Chrome.',
    'Pick a date range and source platform.',
    'Review the generated total spend summary.',
  ]

  return (
    <main className="landing">
      <header className="hero">
        <p className="eyebrow">ImongSpend</p>
        <h1>Know your Shopee spending in minutes, not in spreadsheet marathons.</h1>
        <p className="hero-copy">
          ImongSpend is a Chrome extension MVP that helps you estimate total spend
          quickly. We start with Shopee so users can get instant value, then expand
          to Foodpanda and Grab after the first release.
        </p>
        <div className="hero-actions">
          <a className="btn btn-primary" href="#waitlist">
            Join MVP Waitlist
          </a>
          <a className="btn btn-secondary" href="#roadmap">
            View Roadmap
          </a>
        </div>
      </header>

      <section className="cards" id="roadmap" aria-label="Platform roadmap">
        {platformCards.map((platform) => (
          <article className="card" key={platform.title}>
            <p className="tag">{platform.status}</p>
            <h2>{platform.title}</h2>
            <p>{platform.detail}</p>
          </article>
        ))}
      </section>

      <section className="how" aria-label="How ImongSpend works">
        <h2>How the MVP works</h2>
        <ol>
          {flow.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>

      <section className="waitlist" id="waitlist">
        <h2>Be first to try the extension</h2>
        <p>
          We are collecting early users while we validate Shopee data source options.
          Leave your email to get MVP access.
        </p>
        <form className="waitlist-form" onSubmit={(event) => event.preventDefault()}>
          <label htmlFor="email" className="sr-only">
            Email address
          </label>
          <input
            id="email"
            type="email"
            placeholder="name@example.com"
            autoComplete="email"
            required
          />
          <button type="submit">Notify Me</button>
        </form>
      </section>

      <footer className="footer">
        <p>
          MVP scope: Landing page + Shopee-first extension scaffold. Foodpanda and
          Grab integrations follow after MVP validation.
        </p>
      </footer>
    </main>
  )
}

export default App
