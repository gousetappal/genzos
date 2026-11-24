import Link from "next/link"
import { sb } from "@/lib/supabase/server"
import { must, run } from "@/lib/flash"
import { dt, fromLocalInput, isManagerRole, label, t, toLocalInput, tone, url } from "@/lib/ui"

const ST = ["not_started", "in_progress", "first_cut_submitted", "review", "revision_required", "final_approved", "delivered"]
const here = (f: FormData) => String(f.get("back") || "/editing")
const link = (f: FormData, k: string) => { const v = t(f, k); if (!v) return null; const u = url(v); if (!u) throw new Error("Links must start with http:// or https://"); return u }

async function assign(f: FormData) {
  "use server"
  await run(here(f), "Editing assigned", async () => {
    const s = await sb(); const { data: { user } } = await s.auth.getUser()
    const v = must(await s.from("videos").select("client_id").eq("id", f.get("video_id")).maybeSingle()) as any; if (!v) throw new Error("Pick a video")
    must(await s.from("editing_assignments").insert({ video_id: f.get("video_id"), client_id: v.client_id, editor_id: f.get("editor_id") || null, deadline: fromLocalInput(f.get("deadline")), raw_footage_url: link(f, "raw"), references_url: link(f, "refs"), instructions: t(f, "instructions"), created_by: user!.id }))
  })
}
// Editors update progress/status/links on their own rows. Approving, returning and delivering are checked by the database (managers only).
async function save(f: FormData) {
  "use server"
  await run(here(f), "Saved", async () => {
    const s = await sb(); const mgr = f.get("mgr") === "1"; const p = Number(f.get("progress"))
    const body: Record<string, any> = { status: f.get("status"), progress: Number.isFinite(p) ? Math.min(100, Math.max(0, Math.round(p))) : 0, raw_footage_url: link(f, "raw"), final_url: link(f, "final") }
    if (mgr) Object.assign(body, { editor_id: f.get("editor_id") || null, deadline: fromLocalInput(f.get("deadline")), references_url: link(f, "refs"), instructions: t(f, "instructions"), reviewer_feedback: t(f, "feedback") })
    if (body.status === "revision_required" && !t(f, "feedback")) throw new Error("Write what needs to change before returning the edit")
    const r = must(await s.from("editing_assignments").update(body).eq("id", f.get("id")).select("id")) as any[]
    if (!r.length) throw new Error("Not allowed: only the assigned editor or a manager can update this")
  })
}
async function remove(f: FormData) {
  "use server"
  await run(here(f), "Assignment removed", async () => { const s = await sb(); const r = must(await s.from("editing_assignments").delete().eq("id", f.get("id")).select("id")) as any[]; if (!r.length) throw new Error("Not allowed") })
}

type SP = { client?: string; mine?: string; edit?: string }
export default async function Editing({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams; const s = await sb(); const { data: { user } } = await s.auth.getUser()
  const qs = (o: Partial<SP>) => { const n = new URLSearchParams(Object.entries({ ...sp, ...o }).filter(([, v]) => v) as [string, string][]); return "/editing" + (n.size ? "?" + n : "") }
  let q = s.from("editing_assignments").select("id,video_id,client_id,editor_id,status,progress,deadline,raw_footage_url,references_url,final_url,instructions,reviewer_feedback,videos(code,title),clients(business_name),ed:profiles!editing_assignments_editor_id_fkey(full_name)").order("deadline", { nullsFirst: false }).limit(300)
  if (sp.client) q = q.eq("client_id", sp.client); if (sp.mine) q = q.eq("editor_id", user!.id)
  const [{ data: rows }, { data: clients }, { data: people }, { data: me }, { data: free }] = await Promise.all([q, s.from("clients").select("id,business_name").order("business_name"),
    s.from("profiles").select("id,full_name").eq("is_active", true).neq("role", "client").order("full_name"), s.from("profiles").select("role").eq("id", user!.id).single(),
    s.from("videos").select("id,code,title,clients(business_name),editing_assignments(id)").in("stage", ["shoot_completed", "footage_uploaded", "editing", "revision_required", "shoot_scheduled", "script_approved"]).order("code").limit(300)])
  const mgr = isManagerRole(me?.role); const now = Date.now()
  const late = (r: any) => r.deadline && +new Date(r.deadline) < now && !["final_approved", "delivered"].includes(r.status)
  const d: any = sp.edit ? ((rows as any[]) ?? []).find(r => r.id === sp.edit) : null; const canEdit = !!d && (mgr || d.editor_id === user!.id)
  // video_id is unique on editing_assignments, so PostgREST returns the embed as an object (or null), not an array
  const unassigned = ((free as any[]) ?? []).filter(v => Array.isArray(v.editing_assignments) ? !v.editing_assignments.length : !v.editing_assignments)
  const Pick = (v: any) => <select name="editor_id" defaultValue={v ?? ""} className="inp"><option value="">— unassigned —</option>{people?.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select>
  const L = (k: string, ph: string, v: any) => <input name={k} type="url" defaultValue={v ?? ""} placeholder={ph} className="inp" />
  return <div className="space-y-6">
    <div className="flex justify-between flex-wrap gap-3"><h1 className="text-2xl font-bold">Editing</h1><Link href={qs({ mine: sp.mine ? undefined : "1" })} className={`btn2 text-sm ${sp.mine ? "!bg-line" : ""}`}>My edits only</Link></div>
    <div className="flex gap-3 flex-wrap items-start">
      <form className="flex gap-2"><select name="client" defaultValue={sp.client ?? ""} className="inp !w-56"><option value="">All clients</option>{clients?.map(c => <option key={c.id} value={c.id}>{c.business_name}</option>)}</select>{sp.mine && <input type="hidden" name="mine" value="1" />}<button className="btn2">Filter</button></form>
      {mgr && <details className="bg-card border border-line rounded-xl p-3"><summary className="cursor-pointer text-sm font-semibold">+ Assign editing</summary>
        <form action={assign} className="grid grid-cols-2 gap-3 pt-3 w-[34rem] max-w-full"><input type="hidden" name="back" value={qs({})} />
          <select name="video_id" required className="inp col-span-2"><option value="">Video…</option>{unassigned.map(v => <option key={v.id} value={v.id}>{v.code} · {v.title} ({v.clients?.business_name})</option>)}</select>
          <label className="text-xs text-slate-400">Editor{Pick(null)}</label><label className="text-xs text-slate-400">Deadline (IST)<input type="datetime-local" name="deadline" className="inp" /></label>
          <label className="text-xs text-slate-400">Raw footage link{L("raw", "https://…", null)}</label><label className="text-xs text-slate-400">References link{L("refs", "https://…", null)}</label>
          <textarea name="instructions" rows={2} placeholder="Editing instructions" className="inp col-span-2" /><button className="btn w-fit">Assign</button></form></details>}</div>

    {d && <div className="bg-card border border-line rounded-xl p-5 space-y-3"><div className="flex justify-between"><div><span className="text-xs text-slate-400">{d.videos?.code} · {d.clients?.business_name}</span><h2 className="text-lg font-bold">{d.videos?.title}</h2></div>
      <div className="text-right"><span className={`tag ${tone(d.status)}`}>{label(d.status)}</span><div><Link href={qs({ edit: undefined })} className="text-xs underline text-slate-400">close</Link></div></div></div>
      {canEdit ? <form action={save} className="grid lg:grid-cols-3 gap-3"><input type="hidden" name="id" value={d.id} /><input type="hidden" name="back" value={qs({})} /><input type="hidden" name="mgr" value={mgr ? "1" : "0"} />
        <label className="text-xs text-slate-400">Status<select name="status" defaultValue={d.status} className="inp">{ST.filter(x => mgr || !["final_approved", "delivered", "revision_required"].includes(x) || x === d.status).map(x => <option key={x} value={x}>{label(x)}</option>)}</select></label>
        <label className="text-xs text-slate-400">Progress %<input name="progress" type="number" min="0" max="100" defaultValue={d.progress} className="inp" /></label>
        {mgr ? <label className="text-xs text-slate-400">Editor{Pick(d.editor_id)}</label> : <div className="text-sm self-end">Editor: {d.ed?.full_name}</div>}
        <label className="text-xs text-slate-400">Raw footage{L("raw", "https://…", d.raw_footage_url)}</label><label className="text-xs text-slate-400">Final / draft export{L("final", "https://…", d.final_url)}</label>
        {mgr ? <label className="text-xs text-slate-400">Deadline (IST)<input type="datetime-local" name="deadline" defaultValue={toLocalInput(d.deadline)} className="inp" /></label> : <div className="text-sm self-end">Deadline: {dt(d.deadline)}</div>}
        {mgr && <label className="text-xs text-slate-400">References{L("refs", "https://…", d.references_url)}</label>}
        {mgr && <label className="text-xs text-slate-400 lg:col-span-2">Instructions<textarea name="instructions" rows={2} defaultValue={d.instructions ?? ""} className="inp" /></label>}
        {mgr ? <label className="text-xs text-slate-400 lg:col-span-3">Reviewer feedback (required to return an edit)<textarea name="feedback" rows={2} defaultValue={d.reviewer_feedback ?? ""} className="inp" /></label>
          : d.reviewer_feedback && <p className="lg:col-span-3 text-sm"><span className="text-slate-400">Reviewer feedback: </span>{d.reviewer_feedback}</p>}
        <div className="flex gap-3 lg:col-span-3"><button className="btn">Save</button></div></form>
        : <dl className="text-sm space-y-1"><div>Editor: {d.ed?.full_name ?? "—"}</div><div>Deadline: {dt(d.deadline)}</div>{d.instructions && <div className="whitespace-pre-wrap">{d.instructions}</div>}</dl>}
      {mgr && <form action={remove}><input type="hidden" name="id" value={d.id} /><input type="hidden" name="back" value={qs({ edit: undefined })} /><button className="text-red-400 text-sm underline">Remove assignment</button></form>}
      {(d.raw_footage_url || d.final_url) && <p className="text-sm flex gap-4">{d.raw_footage_url && <a href={d.raw_footage_url} target="_blank" rel="noopener noreferrer" className="underline text-blue-400">Raw footage</a>}{d.final_url && <a href={d.final_url} target="_blank" rel="noopener noreferrer" className="underline text-blue-400">Latest export</a>}</p>}</div>}

    <div className="flex gap-3 overflow-x-auto pb-4">{ST.map(st => { const items = ((rows as any[]) ?? []).filter(r => r.status === st)
      return <div key={st} className="w-64 shrink-0 bg-card border border-line rounded-xl p-3 space-y-2"><div className="flex justify-between text-sm font-semibold"><span>{label(st)}</span><span className="text-slate-400">{items.length}</span></div>
        {items.map(r => <Link key={r.id} href={qs({ edit: r.id })} className={`block bg-navy border rounded-lg p-3 space-y-1 text-sm ${late(r) ? "border-red-700" : "border-line"} ${sp.edit === r.id ? "ring-2 ring-blue-500" : ""}`}>
          <div className="flex justify-between text-xs text-slate-400"><span>{r.videos?.code}</span>{late(r) && <span className="text-red-400">overdue</span>}</div><div className="font-medium">{r.videos?.title}</div>
          <div className="text-xs text-slate-400">{r.clients?.business_name} · ✂ {r.ed?.full_name ?? "unassigned"}</div><div className="text-xs text-slate-400">Due {dt(r.deadline)}</div>
          <div className="h-1.5 bg-line rounded-full overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${r.progress}%` }} /></div></Link>)}</div> })}</div></div>
}
