export default function UnsubscribePage() {
  return (
    <main className="access-page">
      <section className="access-card">
        <div className="access-brand">
          <span className="sisyphus-logo access-logo" aria-hidden="true" />
          <span>Sisyphus</span>
        </div>
        <h1>Email preferences</h1>
        <div className="access-copy">
          <p>
            Sisyphus currently sends account emails only. There is no marketing
            mailing list attached to this address.
          </p>
          <p>
            Verification and password-reset messages are sent only when an
            account action requests them.
          </p>
        </div>
      </section>
    </main>
  );
}
