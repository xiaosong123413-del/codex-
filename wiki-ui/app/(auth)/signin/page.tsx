export default function SignInPage() {
  return (
    <main style={{ padding: 32 }}>
      <h1>Sign in</h1>
      <p>This workspace is protected by Google sign-in and an email allowlist.</p>
      <a
        href="/api/auth/signin/google?callbackUrl=%2Fworkspace"
        style={{
          display: 'inline-block',
          marginTop: 16,
          padding: '10px 14px',
          border: '1px solid #3366cc',
          color: '#3366cc',
          textDecoration: 'none',
        }}
      >
        Continue with Google
      </a>
    </main>
  );
}
