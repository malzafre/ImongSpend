export function OptionsApp() {
  return (
    <main className="panel panel-wide">
      <p className="kicker">Options</p>
      <h1>ImongSpend Settings</h1>
      <p className="subtle">
        MVP starts with Shopee. Future versions will include Foodpanda and Grab once
        the Shopee pipeline is stable.
      </p>
      <ul className="options-list">
        <li>Default date range: Last 30 days</li>
        <li>Currency display: PHP</li>
        <li>Provider status: Shopee only (active)</li>
      </ul>
    </main>
  )
}