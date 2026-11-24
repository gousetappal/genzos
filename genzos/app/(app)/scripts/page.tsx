import Link from "next/link"
import { sb } from "@/lib/supabase/server"
import { back, must, run } from "@/lib/flash"
import { SCRIPT_STATUSES, fmt, label, t, tone } from "@/lib/ui"

async function newScript(f: FormData) {
  "use server"
  await run("/scripts", "", async () => {
    const s = await sb(); const { data: { user } } = await s.auth.getUser(); const title = t(f, "title")
    if (!title || !f.get("client_id")) throw new Error("Pick a client and enter a title")
    const r = must(await s.from("scripts").insert({ client_id: f.get("client_id"), title, scriptwriter_id: user!.id, created_by: user!.id }).select("id").single()) as any
    back(`/scripts/${r.id}`, "ok", "Script created")
  })
}
export default async function Scripts({ searchParams }: { searchParams: Promise<{ client?: string; status?: string }> }) {
  const { client, status } = await searchParams; const s = await sb()
  let q = s.from("scripts").select("id,title,status,version,platform,updated_at,clients(business_name),writer:profiles!scripts_scriptwriter_id_fkey(full_name)").order("updated_at", { ascending: false }).limit(200)
  if (client) q = q.eq("client_id", client); if (status) q = q.eq("status", status)
  const [{ data: rows }, { data: clients }] = await Promise.all([q, s.from("clients").select("id,business_name").order("business_name")])
  return <div className="space-y-6"><h1 className="text-2xl font-bold">Scripts</h1>
    <form action={newScript} className="bg-card border border-line rounded-xl p-4 flex gap-3 flex-wrap">
      <select name="client_id" required className="inp !w-56"><option value="">Client…</option>{clients?.map(c => <option key={c.id} value={c.id}>{c.business_name}</option>)}</select>
      <input name="title" required placeholder="Script title" className="inp !w-72" /><button className="btn">New script</button></form>
    <form className="flex gap-3"><select name="client" defaultValue={client ?? ""} className="inp !w-56"><option value="">All clients</option>{clients?.map(c => <option key={c.id} value={c.id}>{c.business_name}</option>)}</select>
      <select name="status" defaultValue={status ?? ""} className="inp !w-48"><option value="">Any status</option>{SCRIPT_STATUSES.map(x => <option key={x} value={x}>{label(x)}</option>)}</select><button className="btn2">Filter</button></form>
    <table className="w-full text-left"><thead className="text-slate-400 text-sm"><tr><th className="py-2">Title</th><th>Client</th><th>Writer</th><th>Status</th><th>Ver.</th><th>Updated</th></tr></thead>
      <tbody>{rows?.map((r: any) => <tr key={r.id} className="border-t border-line"><td className="py-2"><Link href={`/scripts/${r.id}`} className="hover:underline font-medium">{r.title}</Link></td>
        <td>{r.clients?.business_name}</td><td>{r.writer?.full_name ?? "—"}</td><td><span className={`tag ${tone(r.status)}`}>{label(r.status)}</span></td><td>v{r.version}</td><td>{fmt(r.updated_at)}</td></tr>)}
        {!rows?.length && <tr><td colSpan={6} className="py-8 text-center text-slate-400">No scripts yet.</td></tr>}</tbody></table></div>
}
