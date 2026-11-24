import Link from "next/link"
import { sb } from "@/lib/supabase/server"
import { must, run } from "@/lib/flash"
import { day, fmt, isManagerRole, label, t, tone } from "@/lib/ui"

const STATUS = ["planned", "active", "on_hold", "completed"]
const here = (f: FormData) => String(f.get("back") || "/projects")
async function create(f: FormData) {
  "use server"
  await run(here(f), "Project created", async () => {
    const s = await sb(); const { data: { user } } = await s.auth.getUser(); const name = t(f, "name"); if (!name || !f.get("client_id")) throw new Error("Pick a client and enter a project name")
    must(await s.from("projects").insert({ client_id: f.get("client_id"), name, description: t(f, "description"), status: f.get("status") || "active", start_date: day(f, "start"), end_date: day(f, "end"), manager_id: f.get("manager_id") || null, created_by: user!.id }))
  })
}
async function update(f: FormData) {
  "use server"
  await run(here(f), "Project saved", async () => {
    const s = await sb(); const name = t(f, "name"); if (!name) throw new Error("Project name is required")
    const r = must(await s.from("projects").update({ name, description: t(f, "description"), status: f.get("status"), start_date: day(f, "start"), end_date: day(f, "end"), manager_id: f.get("manager_id") || null }).eq("id", f.get("id")).select("id")) as any[]
    if (!r.length) throw new Error("Not allowed: only admins or project managers can edit projects")
  })
}
async function remove(f: FormData) {
  "use server"
  await run(here(f), "Project deleted (its videos are kept)", async () => { const s = await sb(); const r = must(await s.from("projects").delete().eq("id", f.get("id")).select("id")) as any[]; if (!r.length) throw new Error("Not allowed") })
}
async function attach(f: FormData) {
  "use server"
  await run(here(f), "Videos updated", async () => {
    const s = await sb(); const ids = f.getAll("video").map(String); if (!ids.length) throw new Error("Tick at least one video")
    must(await s.from("videos").update({ project_id: f.get("detach") ? null : f.get("id") }).in("id", ids))
  })
}

type SP = { status?: string; client?: string; project?: string }
export default async function Projects({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams; const s = await sb(); const { data: { user } } = await s.auth.getUser()
  const qs = (o: Partial<SP>) => { const n = new URLSearchParams(Object.entries({ ...sp, ...o }).filter(([, v]) => v) as [string, string][]); return "/projects" + (n.size ? "?" + n : "") }
  let q = s.from("projects").select("id,name,description,status,start_date,end_date,client_id,manager_id,clients(business_name),mgr:profiles!projects_manager_id_fkey(full_name)").order("created_at", { ascending: false }).limit(200)
  if (sp.status) q = q.eq("status", sp.status); if (sp.client) q = q.eq("client_id", sp.client)
  const [{ data: rows }, { data: clients }, { data: people }, { data: me }, { data: vcount }] = await Promise.all([q, s.from("clients").select("id,business_name").order("business_name"),
    s.from("profiles").select("id,full_name").eq("is_active", true).in("role", ["admin", "project_manager"]).order("full_name"), s.from("profiles").select("role").eq("id", user!.id).single(),
    s.from("videos").select("project_id,stage").not("project_id", "is", null).limit(5000)])
  const mgr = isManagerRole(me?.role), P = (rows as any[]) ?? []
  const stats = (id: string) => { const v = ((vcount as any[]) ?? []).filter(x => x.project_id === id); return { n: v.length, done: v.filter(x => x.stage === "published").length } }
  const d: any = sp.project ? P.find(x => x.id === sp.project) : null
  const dv = d ? ((await s.from("videos").select("id,code,title,stage,project_id").eq("client_id", d.client_id).order("code").limit(300)).data as any[] | null) : null
  const Mgr = (v: any) => <select name="manager_id" defaultValue={v ?? ""} className="inp"><option value="">No manager</option>{people?.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select>
  const St = (v: string) => <select name="status" defaultValue={v} className="inp">{STATUS.map(x => <option key={x} value={x}>{label(x)}</option>)}</select>
  return <div className="space-y-6">
    <h1 className="text-2xl font-bold">Projects</h1>
    <div className="flex gap-3 flex-wrap items-start">
      <form className="flex gap-2"><select name="client" defaultValue={sp.client ?? ""} className="inp !w-52"><option value="">All clients</option>{clients?.map(c => <option key={c.id} value={c.id}>{c.business_name}</option>)}</select>
        <select name="status" defaultValue={sp.status ?? ""} className="inp !w-40"><option value="">Any status</option>{STATUS.map(x => <option key={x} value={x}>{label(x)}</option>)}</select><button className="btn2">Filter</button></form>
      {mgr && <details className="bg-card border border-line rounded-xl p-3"><summary className="cursor-pointer text-sm font-semibold">+ New project</summary>
        <form action={create} className="grid grid-cols-2 gap-3 pt-3 w-[32rem] max-w-full"><input type="hidden" name="back" value={qs({})} />
          <select name="client_id" required className="inp"><option value="">Client…</option>{clients?.map(c => <option key={c.id} value={c.id}>{c.business_name}</option>)}</select><input name="name" required placeholder="Project name" className="inp" />
          <label className="text-xs text-slate-400">Start<input type="date" name="start" className="inp" /></label><label className="text-xs text-slate-400">End<input type="date" name="end" className="inp" /></label>
          <label className="text-xs text-slate-400">Status{St("active")}</label><label className="text-xs text-slate-400">Manager{Mgr(null)}</label>
          <textarea name="description" rows={2} placeholder="Description" className="inp col-span-2" /><button className="btn w-fit">Create</button></form></details>}</div>
    {d && <div className="bg-card border border-line rounded-xl p-5 space-y-4"><div className="flex justify-between"><h2 className="text-lg font-bold">{d.name}</h2><Link href={qs({ project: undefined })} className="text-xs underline text-slate-400">close</Link></div>
      {mgr ? <form action={update} className="grid grid-cols-2 gap-3"><input type="hidden" name="id" value={d.id} /><input type="hidden" name="back" value={qs({})} /><input name="name" required defaultValue={d.name} className="inp" /><div className="grid grid-cols-2 gap-3">{St(d.status)}{Mgr(d.manager_id)}</div>
        <label className="text-xs text-slate-400">Start<input type="date" name="start" defaultValue={d.start_date ?? ""} className="inp" /></label><label className="text-xs text-slate-400">End<input type="date" name="end" defaultValue={d.end_date ?? ""} className="inp" /></label>
        <textarea name="description" rows={2} defaultValue={d.description ?? ""} className="inp col-span-2" /><button className="btn w-fit">Save</button></form> : <p className="text-sm text-slate-400 whitespace-pre-wrap">{d.description ?? "No description."}</p>}
      <form action={attach} className="space-y-2 border-t border-line pt-3"><b className="text-sm">Videos of {d.clients?.business_name}</b><input type="hidden" name="id" value={d.id} /><input type="hidden" name="back" value={qs({})} />
        <div className="grid lg:grid-cols-2 gap-1 text-sm">{dv?.map(v => <label key={v.id} className="flex gap-2"><input type="checkbox" name="video" value={v.id} /><span>{v.code} · {v.title}</span><span className={`tag ${tone(v.stage)}`}>{label(v.stage)}</span>{v.project_id === d.id && <span className="text-emerald-400">in project</span>}</label>)}{!dv?.length && <span className="text-slate-400">This client has no videos yet.</span>}</div>
        <div className="flex gap-2"><button className="btn2 text-sm">Add ticked to project</button><button name="detach" value="1" className="btn2 text-sm">Remove ticked from project</button></div></form>
      {mgr && <form action={remove}><input type="hidden" name="id" value={d.id} /><input type="hidden" name="back" value={qs({ project: undefined })} /><button className="text-red-400 text-sm underline">Delete project</button></form>}</div>}
    <table className="w-full text-left"><thead className="text-slate-400 text-sm"><tr><th className="py-2">Project</th><th>Client</th><th>Manager</th><th>Status</th><th>Dates</th><th>Videos</th></tr></thead>
      <tbody>{P.map(p => { const st = stats(p.id); return <tr key={p.id} className="border-t border-line"><td className="py-2"><Link href={qs({ project: p.id })} className="hover:underline font-medium">{p.name}</Link></td><td>{p.clients?.business_name}</td><td>{p.mgr?.full_name ?? "—"}</td>
        <td><span className={`tag ${tone(p.status)}`}>{label(p.status)}</span></td><td>{fmt(p.start_date)} – {fmt(p.end_date)}</td><td>{st.done} / {st.n} published</td></tr> })}
        {!P.length && <tr><td colSpan={6} className="py-8 text-center text-slate-400">No projects yet.</td></tr>}</tbody></table></div>
}
