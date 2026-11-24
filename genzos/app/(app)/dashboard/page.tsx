import { sb } from "@/lib/supabase/server"
export default async function D() {
  const s = await sb(); const now = new Date().toISOString()
  const { data: { user } } = await s.auth.getUser()
  const { data: me } = await s.from("profiles").select("role").eq("id", user!.id).single()
  const cnt = async (q: any) => (await q).count ?? 0
  const openSt = ["todo", "in_progress", "review"]
  const [active, leads, open, overdue] = await Promise.all([
    cnt(s.from("clients").select("*", { count: "exact", head: true }).eq("status", "active")),
    cnt(s.from("clients").select("*", { count: "exact", head: true }).eq("status", "lead")),
    cnt(s.from("tasks").select("*", { count: "exact", head: true }).in("status", openSt)),
    cnt(s.from("tasks").select("*", { count: "exact", head: true }).in("status", openSt).lt("due_date", now))])
  const ms = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 7) + "-01"
  const [{ count: pubCount }, { data: act }] = await Promise.all([
    s.from("videos").select("*", { count: "exact", head: true }).eq("status", "published").gte("published_on", ms),
    s.from("clients").select("monthly_deliverables").eq("status", "active")])
  const target = (act ?? []).reduce((a: number, r: any) => a + Number(r.monthly_deliverables), 0)
  const cards: [string, string | number][] = [["Active clients", active], ["Videos published this month", `${pubCount ?? 0} / ${target}`], ["New leads", leads], ["Open tasks", open], ["Overdue tasks", overdue]]
  if (me?.role === "admin") {
    const { data } = await s.from("client_finance").select("monthly_package_amount, clients!inner(status)").eq("clients.status", "active")
    const mrr = (data ?? []).reduce((a: number, r: any) => a + Number(r.monthly_package_amount), 0)
    cards.unshift(["Monthly recurring revenue", "₹" + mrr.toLocaleString("en-IN")])
  }
  return <div><h1 className="text-2xl font-bold mb-6">Dashboard</h1><div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
    {cards.map(([l, v]) => <div key={l} className="bg-card border border-line rounded-xl p-5"><div className="text-sm text-slate-400">{l}</div><div className="text-3xl font-bold mt-1">{v}</div></div>)}</div></div>
}
