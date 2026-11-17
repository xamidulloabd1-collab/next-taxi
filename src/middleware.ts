import { NextResponse, type NextRequest } from "next/server";

/**
 * Cheap edge redirect for signed-out users (cookie presence only). Real authentication and
 * authorisation happen server-side in layouts and every API route.
 */
const APPS = [
  { prefix: "/passenger", cookie: "nt_p" },
  { prefix: "/driver", cookie: "nt_d" },
  { prefix: "/admin", cookie: "nt_a" },
];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const app = APPS.find((a) => pathname === a.prefix || pathname.startsWith(`${a.prefix}/`));
  if (!app || pathname.startsWith(`${app.prefix}/login`)) return NextResponse.next();
  if (!req.cookies.get(app.cookie)) {
    const url = req.nextUrl.clone();
    url.pathname = `${app.prefix}/login`;
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/passenger/:path*", "/driver/:path*", "/admin/:path*"] };
