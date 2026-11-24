import Link from "next/link"
import { redirect } from "next/navigation"
import { sb } from "@/lib/supabase/server"
import { must, run } from "@/lib/flash"
import { day, fmt, today } from "@/lib/ui"
// Admin only. The page redirects non-admins, every action re-checks the role, and RLS on client_finance / salaries blocks everyone else anyway.
async function admin() {
  const s = await sb(); const { data: { user } } = await s.auth.getUser()
  const { data: me } = await s.from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle()
  if (me?.role !== "admin") throw new Error("Admins only")
  return s
}
const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 })
const money = (f: FormData, k: string) => Math.max(0, Number(f.get(k) || 0))
const monthOf = (f: FormData) => { const m = String(f.get("month") ?? ""); return /^\d{4}-\d{2}$/.test(m) ? m + "-01" : null }
async function saveSalary(f: FormData) {
  "use server"
  const m = monthOf(f)
  await run(`/finance?m=${(m ?? today()).slice(0, 7)}`, "Salary saved", async () => {
    const s = await admin(); if (!m) throw new Error("Pick a month"); const base = money(f, "base"), adv = money(f, "advance"), ded = money(f, "deductions")
    if (adv + ded > base) throw new Error("Advance + deductions cannot exceed the base salary")
    must(await s.from("salaries").upsert({ employee_id: String(f.get("employee")), month: m, base_salary: base, advance: adv, deductions: ded }, { onConflict: "employee_id,month" }))
  })
}
async function setPaid(f: FormData) {
  "use server"
  const m = String(f.get("m") ?? today().slice(0, 7))
  await run(`/finance?m=${m}`, f.get("unpay") ? "Marked unpaid" : "Marked paid", async () => {
    const s = await admin()
    must(await s.from("salaries").update({ paid_on: f.get("unpay") ? null : (day(f, "paid_on") ?? today()) }).eq("id", String(f.get("id"))))
  })
}
export default async function Finance({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const s = await sb(); const { data: { user } } = await s.auth.getUser()
  const { data: me } = await s.from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle()
  if (me?.role !== "admin") redirect("/dashboard")
  const sp = await searchParams; const m = /^\d{4}-\d{2}$/.test(sp.m ?? "") ? sp.m! : today().slice(0, 7)
  const [{ data: fin }, { data: sal }, { data: staff }] = await Promise.all([
    s.from("client_finance").select("client_id,monthly_package_amount,clients!inner(id,business_name,status)").eq("clients.status", "active").order("monthly_package_amount", { ascending: false }),
    s.from("salaries").select("id,employee_id,base_salary,advance,deductions,amount_payable,paid_on,who:profiles!salaries_employee_id_fkey(full_name)").eq("month", m + "-01"),
    s.from("profiles").select("id,full_name,role").eq("is_active", true).neq("role", "client").order("full_name")])
  const revenue = (fin ?? []).reduce((a: number, r: any) => a + Number(r.monthly_package_amount), 0)
  const payable = (sal ?? []).reduce((a: number, r: any) => a + Number(r.amount_payable), 0)
  const unpaid = (sal ?? []).filter((r: any) => !r.paid_on).reduce((a: number, r: any) => a + Number(r.amount_payable), 0)
  const cards: [string, string][] = [["Monthly recurring revenue", inr(revenue)], [`Payroll payable (${m})`, inr(payable)], ["Payroll still unpaid", inr(unpaid)], ["Revenue minus payroll", inr(revenue - payable)]]
  const y = Number(m.slice(0, 4)), mo = Number(m.slice(5)), prev = new Date(Date.UTC(y, mo - 2, 1)).toISOString().slice(0, 7), next = new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 7)
  const missing = (staff ?? []).filter((p: any) => !(sal ?? []).some((r: any) => r.employee_id === p.id))
  return <div className="space-y-6"><h1 className="text-2xl font-bold">Finance <span className="tag align-middle">admin only</span></h1>
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">{cards.map(([l, v]) => <div key={l} className="bg-card border border-line rounded-xl p-5"><div className="text-sm text-slate-400">{l}</div><div className="text-2xl font-bold mt-1">{v}</div></div>)}</div>
    <section className="space-y-2"><h2 className="text-lg font-semibold">Client packages (active clients)</h2>
      <table className="w-full text-left"><thead className="text-slate-400 text-sm"><tr><th className="py-2">Client</th><th className="text-right">Monthly package</th></tr></thead>
        <tbody>{fin?.map((r: any) => <tr key={r.client_id} className="border-t border-line"><td className="py-2"><Link className="hover:underline" href={`/clients/${r.client_id}`}>{r.clients.business_name}</Link></td><td className="text-right">{inr(Number(r.monthly_package_amount))}</td></tr>)}
          {!fin?.length && <tr><td colSpan={2} className="py-6 text-center text-slate-400">No active client has a package amount yet. Set it on the client page.</td></tr>}</tbody></table></section>
    <section className="space-y-3"><div className="flex items-center gap-3"><h2 className="text-lg font-semibold">Salaries</h2>
      <Link href={`/finance?m=${prev}`} className="btn2 !py-0.5">‹</Link><span className="font-medium">{m}</span><Link href={`/finance?m=${next}`} className="btn2 !py-0.5">›</Link></div>
      <form action={saveSalary} className="bg-card border border-line rounded-xl p-4 grid grid-cols-2 lg:grid-cols-6 gap-3 items-end">
        <input type="hidden" name="month" value={m} />
        <label className="text-xs text-slate-400 lg:col-span-2">Employee<select name="employee" required className="inp mt-1">{staff?.map((p: any) => <option key={p.id} value={p.id}>{p.full_name}{(sal ?? []).some((r: any) => r.employee_id === p.id) ? " (update)" : ""}</option>)}</select></label>
        <label className="text-xs text-slate-400">Base<input name="base" type="number" min="0" step="0.01" required className="inp mt-1" /></label>
        <label className="text-xs text-slate-400">Advance<input name="advance" type="number" min="0" step="0.01" defaultValue="0" className="inp mt-1" /></label>
        <label className="text-xs text-slate-400">Deductions<input name="deductions" type="number" min="0" step="0.01" defaultValue="0" className="inp mt-1" /></label>
        <button className="btn">Save</button></form>
      <table className="w-full text-left"><thead className="text-slate-400 text-sm"><tr><th className="py-2">Employee</th><th className="text-right">Base</th><th className="text-right">Advance</th><th className="text-right">Deductions</th><th className="text-right">Payable</th><th className="pl-4">Paid</th></tr></thead>
        <tbody>{sal?.map((r: any) => <tr key={r.id} className="border-t border-line"><td className="py-2">{r.who?.full_name}</td>
          <td className="text-right">{inr(Number(r.base_salary))}</td><td className="text-right">{inr(Number(r.advance))}</td><td className="text-right">{inr(Number(r.deductions))}</td><td className="text-right font-semibold">{inr(Number(r.amount_payable))}</td>
          <td className="pl-4"><form action={setPaid} className="flex items-center gap-2"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="m" value={m} />
            {r.paid_on ? <><span className="text-emerald-400 text-sm">{fmt(r.paid_on)}</span><button name="unpay" value="1" className="text-xs underline">Undo</button></> : <button className="text-xs underline">Mark paid today</button>}</form></td></tr>)}
          {!sal?.length && <tr><td colSpan={6} className="py-6 text-center text-slate-400">No salary entries for {m}.</td></tr>}</tbody></table>
      {!!missing.length && !!sal?.length && <p className="text-xs text-slate-500">No entry yet: {missing.map((p: any) => p.full_name).join(", ")}</p>}</section></div>
}
