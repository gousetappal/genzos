import Link from "next/link"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { sb } from "@/lib/supabase/server"
const PAGE = 10
const back = (msg: string) => redirect("/clients?err=" + encodeURIComponent(msg))

async function add(f: FormData) {
  "use server"
  const s = await sb(); const { data: { user } } = await s.auth.getUser()
  const { data: c, error } = await s.from("clients").insert({ business_name: String(f.get("name") ?? "").trim(), category: f.get("category") || null, owner_name: f.get("owner") || null, phone: f.get("phone") || null, status: f.get("status"), monthly_deliverables: Math.max(0, Number(f.get("deliverables") || 0)), contract_months: Number(f.get("months")) > 0 ? Number(f.get("months")) : null, created_by: user!.id }).select("id").single()
  if (error || !c) return back(error?.message ?? "Could not add client (only admins can add clients)")
  const amt = Number(f.get("amount") || 0)
  if (amt > 0) await s.from("client_finance").insert({ client_id: c.id, monthly_package_amount: amt })
  // competitors: one per line (or comma separated)
  const names = [...new Set(String(f.get("competitors") ?? "").split(/[\n,]/).map(x => x.trim()).filter(Boolean))].slice(0, 20)
  if (names.length) await s.from("competitors").insert(names.map(name => ({ client_id: c.id, name, created_by: user!.id })))
  revalidatePath("/clients"); redirect("/clients/" + c.id)
}
async function del(f: FormData) {
  "use server"
  if (f.get("confirm") !== "on") return back("Tick the confirmation box to delete a client")
  const s = await sb(); const { data, error } = await s.from("clients").delete().eq("id", f.get("client_id")).select("id")
  if (error) return back(error.message)
  if (!data?.length) return back("Not allowed: only admins can delete clients")
  revalidatePath("/clients"); redirect("/clients")
}

export default async function C({ searchParams }: { searchParams: Promise<{ q?: string; page?: string; err?: string }> }) {
  const { q = "", page = "1", err } = await searchParams; const p = Math.max(1, Number(page) || 1); const s = await sb()
  let query = s.from("clients").select("id,business_name,category,owner_name,status,monthly_deliverables", { count: "exact" }).order("created_at", { ascending: false }).range((p - 1) * PAGE, p * PAGE - 1)
  if (q) query = query.ilike("business_name", `%${q.replace(/[%,]/g, "")}%`)
  const { data, count, error } = await query
  const ms = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 7) + "-01"
  const ids = data?.map(c => c.id) ?? []
  const [{ data: pub }, { data: comps }] = ids.length ? await Promise.all([
    s.from("videos").select("client_id").in("client_id", ids).eq("status", "published").gte("published_on", ms),
    s.from("competitors").select("client_id").in("client_id", ids)]) : [{ data: [] as { client_id: string }[] }, { data: [] as { client_id: string }[] }]
  const done = (id: string) => pub?.filter(v => v.client_id === id).length ?? 0
  const nComp = (id: string) => comps?.filter(v => v.client_id === id).length ?? 0
  const { data: { user } } = await s.auth.getUser()
  const { data: me } = await s.from("profiles").select("role").eq("id", user!.id).single()
  const admin = me?.role === "admin"
  return <div className="space-y-6"><h1 className="text-2xl font-bold">Clients</h1>
    {err && <p className="bg-red-950 border border-red-900 text-red-300 rounded-lg p-3 text-sm">{err}</p>}
    <form className="flex gap-2"><input name="q" defaultValue={q} placeholder="Search clients…" className="inp max-w-xs" /><button className="btn">Search</button></form>
    {admin && <form action={add} className="bg-card border border-line rounded-xl p-4 space-y-3"><h3 className="font-semibold">Add a client</h3>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <input name="name" required placeholder="Business name (e.g. Meda Jewellers)" className="inp lg:col-span-2" /><input name="category" placeholder="Category" className="inp" />
        <input name="owner" placeholder="Owner" className="inp" /><input name="phone" placeholder="Phone" className="inp" />
        <select name="status" defaultValue="active" className="inp">{["lead", "prospect", "onboarding", "active", "on_hold", "completed", "lost"].map(x => <option key={x}>{x}</option>)}</select>
        <input name="deliverables" type="number" min="0" placeholder="Videos wanted / month" className="inp" /><input name="months" type="number" min="1" placeholder="Contract (months)" className="inp" />
        <input name="amount" type="number" min="0" placeholder="Monthly package ₹ (admin only)" className="inp" /></div>
      <textarea name="competitors" rows={3} placeholder={"Competitors — one per line\nTanishq\nMalabar Gold"} className="inp" />
      <button className="btn">Add client</button></form>}
    {error && <p className="text-red-400">{error.message}</p>}
    <table className="w-full text-left"><thead className="text-slate-400 text-sm"><tr><th className="py-2">Business</th><th>Category</th><th>Owner</th><th>Status</th><th>Competitors</th><th>Published this month</th>{admin && <th></th>}</tr></thead>
      <tbody>{data?.map(c => <tr key={c.id} className="border-t border-line align-top"><td className="py-2"><Link href={`/clients/${c.id}`} className="underline">{c.business_name}</Link></td><td>{c.category}</td><td>{c.owner_name}</td><td>{c.status}</td><td>{nComp(c.id)}</td><td>{done(c.id)} / {c.monthly_deliverables}</td>
        {admin && <td className="py-2"><details><summary className="text-red-400 text-sm cursor-pointer">Delete</summary>
          <form action={del} className="mt-2 space-y-2 text-sm"><input type="hidden" name="client_id" value={c.id} />
            <label className="flex gap-2"><input type="checkbox" name="confirm" required /> Delete {c.business_name} and all its data</label>
            <button className="bg-red-600 rounded-lg px-3 py-1 font-semibold">Confirm delete</button></form></details></td>}</tr>)}
        {!data?.length && <tr><td colSpan={admin ? 7 : 6} className="py-8 text-center text-slate-400">No clients found.</td></tr>}</tbody></table>
    <div className="flex gap-3 text-sm items-center">{p > 1 && <a className="underline" href={`?q=${q}&page=${p - 1}`}>← Prev</a>}<span>Page {p} of {Math.max(1, Math.ceil((count ?? 0) / PAGE))}</span>{p * PAGE < (count ?? 0) && <a className="underline" href={`?q=${q}&page=${p + 1}`}>Next →</a>}</div></div>
}
