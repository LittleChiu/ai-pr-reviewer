import { NextRequest, NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  const backendUrl = process.env.BACKEND_URL || "http://localhost:8000";
  const url = new URL(req.nextUrl.pathname + req.nextUrl.search, backendUrl);

  return NextResponse.rewrite(url, { request: req });
}

export const config = {
  matcher: "/api/:path*",
};
