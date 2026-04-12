import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';

import { isAllowedEmail } from './lib/auth/allowlist';

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: {
    strategy: 'jwt',
  },
  pages: {
    signIn: '/signin',
  },
  providers: [Google],
  callbacks: {
    async signIn({ profile }) {
      return isAllowedEmail(profile?.email);
    },
    authorized({ auth, request: { nextUrl } }) {
      const pathname = nextUrl.pathname;
      const isPublicPath =
        pathname === '/signin' ||
        pathname.startsWith('/api/auth') ||
        pathname === '/_next' ||
        pathname.startsWith('/_next/');

      if (isPublicPath) {
        return true;
      }

      return Boolean(auth?.user);
    },
  },
});
