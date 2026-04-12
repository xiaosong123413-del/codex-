import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';

import { isAllowedEmail } from './lib/auth/allowlist';

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: {
    strategy: 'jwt',
  },
  providers: [Google],
  callbacks: {
    async signIn({ profile }) {
      return isAllowedEmail(profile?.email);
    },
  },
});
