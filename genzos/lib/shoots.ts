import { sb } from "@/lib/supabase/server"
import { dt, hm } from "@/lib/ui"
type S = Awaited<ReturnType<typeof sb>>
export type Clash = { rid: string; who: string; kind: string; shootId: string; title: string | null; start: string | null; end: string | null }

// Looks up everything already booked for these people/equipment in [a,b). Used for friendly pre-checks and to explain a
// no_double_booking violation. The database constraint remains the real guard; this only produces readable messages.
export async function findClashes(s: S, ids: (string | null | undefined)[], a: string, b: string, selfId?: string | null): Promise<Clash[]> {
  const rid = [...new Set(ids.filter(Boolean) as string[])]; if (!rid.length) return []
  const sel = "resource_id,kind,shoot_id,shoots(title,starts_at,ends_at,clients(business_name))"
  let r = await s.from("shoot_resources").select(sel).in("resource_id", rid).overlaps("during", `[${a},${b})`)
  if (r.error) r = await s.from("shoot_resources").select(sel).in("resource_id", rid)      // range filter unavailable: filter below instead
  const [{ data: ppl }, { data: eq }] = await Promise.all([s.from("profiles").select("id,full_name").in("id", rid), s.from("equipment").select("id,name").in("id", rid)])
  const name = new Map<string, string>(); (ppl ?? []).forEach((p: any) => name.set(p.id, p.full_name)); (eq ?? []).forEach((e: any) => name.set(e.id, e.name))
  const A = +new Date(a), B = +new Date(b)
  return ((r.data ?? []) as any[]).filter(x => x.shoot_id !== selfId && (!x.shoots || (+new Date(x.shoots.starts_at) < B && +new Date(x.shoots.ends_at) > A)))
    .map(x => ({ rid: x.resource_id, who: name.get(x.resource_id) ?? "Someone", kind: x.kind, shootId: x.shoot_id, title: x.shoots ? `${x.shoots.title}${x.shoots.clients?.business_name ? ` (${x.shoots.clients.business_name})` : ""}` : null,
      start: x.shoots?.starts_at ?? null, end: x.shoots?.ends_at ?? null }))
}
export const describe = (c: Clash[]) => "Double booking: " + c.map(x => `${x.who} is already ${x.kind === "equipment" ? "reserved" : "booked"} on ${x.title ? `“${x.title}”` : "another shoot you cannot see"}${x.start ? ` (${dt(x.start)}–${hm(x.end!)})` : ""}`).join("; ") + ". Pick another time or another person/item."
export const isClash = (e: { message?: string; code?: string } | null | undefined) => !!e && (e.code === "23P01" || /no_double_booking/.test(e.message ?? ""))
/** Turns a database error into a readable Error. A no_double_booking violation is explained with the actual clash. */
export async function explain(s: S, e: { message: string; code?: string }, ids: (string | null | undefined)[], a: string, b: string, selfId?: string | null): Promise<Error> {
  if (!isClash(e)) return new Error(e.message)
  const c = await findClashes(s, ids, a, b, selfId)
  return new Error(c.length ? describe(c) : "Double booking: someone or something on this shoot is already booked at that time. Pick another time or another person/item.")
}
