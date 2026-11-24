import { redirect } from "next/navigation"
// Flash messages travel in the URL (?ok= / ?err=) so they survive redirects and need no cookies.
export function back(path: string, kind: "ok" | "err", msg: string): never {
  const u = new URL(path, "http://x"); u.searchParams.delete("ok"); u.searchParams.delete("err"); u.searchParams.set(kind, msg.slice(0, 300))
  redirect(u.pathname + u.search)
}
export function must<T>(r: { data: T; error: { message: string } | null }): T { if (r.error) throw new Error(r.error.message); return r.data }
// Runs a server-action body; any error (including database rule violations) becomes a red banner instead of a crash page.
export async function run(path: string, okMsg: string, fn: () => Promise<void>): Promise<never> {
  try { await fn() } catch (e: any) {
    if (typeof e?.digest === "string" && e.digest.startsWith("NEXT_REDIRECT")) throw e
    back(path, "err", String(e?.message ?? "Something went wrong").replace(/^Error:\s*/, ""))
  }
  back(path, "ok", okMsg)
}
