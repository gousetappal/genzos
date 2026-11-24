import { createBrowserClient } from "@supabase/ssr"

// Reuse one browser client so the auth session and cookie storage remain consistent.
let browserClient: ReturnType<typeof createBrowserClient> | undefined

export function sbBrowser() {
  if (!browserClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (!url || !anonKey) {
      throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY")
    }

    browserClient = createBrowserClient(url, anonKey)
  }

  return browserClient
}
