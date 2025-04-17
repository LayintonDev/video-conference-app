import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  // Get the pathname
  const path = request.nextUrl.pathname;

  // Define public paths that don't require authentication
  const isPublicPath = path === "/" || path === "/login" || path === "/signup";

  // Get the token from cookies
  const token = request.cookies.get("firebase-token")?.value || "";

  // Add a special cookie to detect redirect loops
  const redirectCount = Number.parseInt(
    request.cookies.get("redirect-count")?.value || "0"
  );

  // If we've redirected too many times, stop the loop
  if (redirectCount > 3) {
    // Clear the redirect count
    const response = NextResponse.next();
    response.cookies.set("redirect-count", "0", {
      maxAge: 0,
      path: "/",
    });
    return response;
  }

  // Redirect logic
  if (isPublicPath && token) {
    // If user is on a public path but has a token, redirect to dashboard
    const response = NextResponse.redirect(new URL("/dashboard", request.url));
    response.cookies.set("redirect-count", (redirectCount + 1).toString(), {
      maxAge: 60, // 1 minute
      path: "/",
    });
    return response;
  }

  if (!isPublicPath && !token) {
    // If user is on a protected path but doesn't have a token, redirect to login
    const response = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.set("redirect-count", (redirectCount + 1).toString(), {
      maxAge: 60, // 1 minute
      path: "/",
    });
    return response;
  }

  // Continue with the request
  return NextResponse.next();
}

// Configure the paths that should trigger this middleware
export const config = {
  matcher: ["/", "/login", "/signup", "/dashboard", "/room/:path*"],
};
