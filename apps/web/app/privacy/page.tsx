export default function PrivacyPage() {
  return (
    <main className="access-page">
      <section className="access-card">
        <div className="access-brand">
          <span className="sisyphus-logo access-logo" aria-hidden="true" />
          <span>Sisyphus</span>
        </div>
        <h1>Privacy</h1>
        <div className="access-copy">
          <p>
            This prototype uses Supabase for account authentication and Resend
            for verification, welcome, and password-reset delivery.
          </p>
          <p>
            Authentication emails do not include agent prompts, source code,
            transcripts, or tool output.
          </p>
        </div>
      </section>
    </main>
  );
}
