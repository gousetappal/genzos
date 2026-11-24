import { NextResponse, type NextRequest } from "next/server"
import { sb } from "@/lib/supabase/server"
// Password-reset emails land here with ?code=...; we trade it for a session, then send the user to /reset.
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code"); const next = req.nextUrl.searchParams.get("next")
  const dest = next === "/reset" ? "/reset" : "/dashboard"
  if (code) { const s = await sb(); const { error } = await s.auth.exchangeCodeForSession(code)
    if (!error) return NextResponse.redirect(new URL(dest, req.url)) }
  return NextResponse.redirect(new URL("/login?err=" + encodeURIComponent("That link has expired. Request a new one."), req.url))
}
