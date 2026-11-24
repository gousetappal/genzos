
import { createServerClient, type CookieOptions } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

type CookieToSet = {
  name: string
  value: string
  options: CookieOptions
}

const PUBLIC_PATHS = ["/login", "/forgot", "/auth/callback"]

function redirectWithCookies(url: URL, response: NextResponse) {
  const redirectResponse = NextResponse.redirect(url)

  response.cookies.getAll().forEach((cookie) => {
    redirectResponse.cookies.set(cookie)
  })

  return redirectResponse
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // Avoid redirect loops when configuration is missing.
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error("Missing Supabase environment variables")

    return NextResponse.json(
      { error: "Supabase configuration is missing." },
      { status: 500 }
    )
  }

  const supabase = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },

        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value)
          })

          response = NextResponse.next({ request })

          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname

  const isPublic = PUBLIC_PATHS.some(
    (path) =>
      pathname === path || pathname.startsWith(`${path}/`)
  )

  // Redirect unauthenticated users to login.
  if (error || !user) {
    if (isPublic) return response

    const loginUrl = new URL("/login", request.url)
    loginUrl.searchParams.set("next", pathname)

    return redirectWithCookies(loginUrl, response)
  }

  // Redirect authenticated users away from login.
  if (pathname === "/login") {
    return redirectWithCookies(
      new URL("/dashboard", request.url),
      response
    )
  }

  // Check client portal access.
  if (
    !pathname.startsWith("/portal") &&
    !pathname.startsWith("/auth/") &&
    pathname !== "/reset"
  ) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle()

    if (profile?.role === "client") {
      return redirectWithCookies(
        new URL("/portal", request.url),
        response
      )
    }
  }

  return response
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
