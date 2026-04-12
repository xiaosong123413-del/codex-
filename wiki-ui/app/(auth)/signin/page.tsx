export default function SignInPage() {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: 48 }}>
      <p className="workspace-kicker">Second Brain Workspace</p>
      <h1 className="workspace-title">Sign in</h1>
      <p>This workspace is protected by Google sign-in and an email allowlist.</p>
      <div className="workspace-section" style={{ marginTop: 24 }}>
        <h2 style={{ marginTop: 0 }}>Access model</h2>
        <ul className="workspace-list">
          <li>Public URL, but login required for every page.</li>
          <li>Only allowlisted Google accounts can enter the workspace.</li>
          <li>All wiki, chat, review, and research routes are protected by middleware.</li>
        </ul>
      </div>
      <a
        href="/api/auth/signin/google?callbackUrl=%2Fworkspace"
        className="workspace-button"
        style={{ display: 'inline-block', marginTop: 16 }}
      >
        Continue with Google
      </a>
    </main>
  );
}
