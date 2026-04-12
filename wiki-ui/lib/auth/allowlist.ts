function getAllowedEmails() {
  return (process.env.ALLOWED_GOOGLE_EMAILS ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function isAllowedEmail(email?: string | null) {
  return Boolean(email && getAllowedEmails().includes(email));
}
