export { auth as middleware } from './auth';

export const config = {
  matcher: ['/workspace/:path*', '/api/chat/:path*', '/api/research/:path*', '/api/review/:path*'],
};
