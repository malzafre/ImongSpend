export function OptionsApp() {
  return (
    <main className="panel panel-wide options-shell">
      <section className="hero hero-wide">
        <p className="kicker">Settings</p>
        <h1>ImongSpend Configuration</h1>
        <p className="hero-copy">
          Current build is optimized for Shopee quick-calculation mode with local-session processing.
        </p>
      </section>

      <section className="glass-card options-grid" aria-label="Settings overview">
        <article className="option-card">
          <p className="subhead">Provider</p>
          <h2>Shopee (active)</h2>
          <p>Foodpanda and Grab are planned after the Shopee pipeline is finalized.</p>
        </article>

        <article className="option-card">
          <p className="subhead">Defaults</p>
          <h2>Last 30 days</h2>
          <p>Currency is set to PHP. Summary and CSV output use two-decimal formatting.</p>
        </article>

        <article className="option-card">
          <p className="subhead">Data Handling</p>
          <h2>Session-only</h2>
          <p>Runs in local browser context with research-mode labeling and explicit user consent.</p>
        </article>
      </section>
    </main>
  )
}
