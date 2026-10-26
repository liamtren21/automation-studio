import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

export function proxy(request: NextRequest) {
 const nonce = randomBytes(32).toString('base64');
 const dev = process.env.NODE_ENV === 'development';
 const policy = [
  "default-src 'self'",
  `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
  // Radix and the workspace use style attributes. Script execution stays nonce-only.
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  `connect-src 'self'${dev ? ' ws: wss:' : ''}`,
  "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
  ...(dev ? [] : ['upgrade-insecure-requests']),
 ].join('; ');
 const requestHeaders = new Headers(request.headers);
 // Overwrite caller supplied headers so a request cannot choose its own nonce.
 requestHeaders.set('x-nonce', nonce);
 requestHeaders.set('Content-Security-Policy', policy);
 const response = NextResponse.next({ request: { headers: requestHeaders } });
 response.headers.set('Content-Security-Policy', policy);
 response.headers.set('X-Content-Type-Options', 'nosniff');
 response.headers.set('X-Frame-Options', 'DENY');
 response.headers.set('Referrer-Policy', request.nextUrl.pathname.startsWith('/automation/share/')?'no-referrer':'strict-origin-when-cross-origin');
 if(request.nextUrl.pathname.startsWith('/automation/share/')){response.headers.set('Cache-Control','private, no-store');response.headers.set('X-Robots-Tag','noindex, nofollow');}
 response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
 return response;
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)'] };
