import Link from "next/link"
import { sb } from "@/lib/supabase/server"
import { back, must, run } from "@/lib/flash"
import { STAGES, fmt, isManagerRole, label, t, tone } from "@/lib/ui"

const url = (v: FormDataEntryValue | null) => { try { const u = new URL(String(v)); return /^https?:$/.test(u.protocol) ? u.toString() : null } catch { return null } }
const day = (k: string, f: FormData) => { const v = String(f.get(k) ?? ""); return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null }
const here = (f: FormData) => String(f.get("back") ?? "/production")

async function create(f: FormData) {
  "use server"
  await run(here(f), "Video added to the pipeline", async () => {
    const s = await sb(); const { data: { user } } = await s.auth.getUser(); const title = t(f, "title")
    if (!title || !f.get("client_id")) throw new Error("Pick a client and enter a title")
    must(await s.from("videos").insert({ client_id: f.get("client_id"), title, content_category: t(f, "category"), status: "planned", stage: "idea_created", created_by: user!.id }))
  })
}
// Moving a card. Approval-type stages go through decide() so they are recorded and role-checked in the database.
async function move(f: FormData) {
  "use server"
  const id = String(f.get("id")), to = String(f.get("stage")), b = here(f)
  if (to === "published") back(b, "err", "To publish, open the video and enter the live link")
  if (to === "revision_required") back(b, "err", "To request a revision, open the video and write the feedback")
  await run(b, `Moved to ${label(to)}`, async () => {
    const s = await sb()
    if (to === "client_review") must(await s.rpc("decide", { p_type: "video", p_id: id, p_decision: "send_to_client", p_feedback: null }))
    else if (to === "approved") must(await s.rpc("decide", { p_type: "video", p_id: id, p_decision: "approved", p_feedback: null }))
    else { const r = must(await s.from("videos").update({ stage: to }).eq("id", id).select("id")) as any[]; if (!r.length) throw new Error("Not allowed") }
  })
}
async function decide(f: FormData) {
  "use server"
  const d = String(f.get("decision")), b = here(f)
  await run(b, d === "approved" ? "Approved" : d === "send_to_client" ? "Sent to client" : "Revision requested", async () => {
    if (d === "changes_requested" && !t(f, "feedback")) throw new Error("Write what needs to change")
    const s = await sb(); must(await s.rpc("decide", { p_type: "video", p_id: f.get("id"), p_decision: d, p_feedback: t(f, "feedback") }))
  })
}
async function details(f: FormData) {
  "use server"
  await run(here(f), "Saved", async () => {
    const s = await sb(); const title = t(f, "title"); if (!title) throw new Error("Title is required")
    const r = must(await s.from("videos").update({ title, content_category: t(f, "category"), scriptwriter_id: f.get("scriptwriter_id") || null, videographer_id: f.get("videographer_id") || null, editor_id: f.get("editor_id") || null,
      shoot_date: day("shoot_date", f), shoot_location: t(f, "shoot_location"), editing_deadline: day("editing_deadline", f), internal_review_deadline: day("review_deadline", f), final_video_url: url(f.get("final_video_url")) }).eq("id", f.get("id")).select("id")) as any[]
    if (!r.length) throw new Error("Not allowed")
  })
}
async function publish(f: FormData) {
  "use server"
  await run(here(f), "Marked as published", async () => {
    const s = await sb(); const link = url(f.get("url")); if (!link) throw new Error("Enter the live http(s) link of the published video")
    const r = await s.from("videos").update({ stage: "published", published_url: link }).eq("id", f.get("id")).select("id")
    if (r.error) throw new Error(r.error.code === "23505" ? "That link is already counted for this client" : r.error.message)
    if (!r.data?.length) throw new Error("Not allowed")
  })
}
async function comment(f: FormData) {
  "use server"
  await run(here(f), "Comment added", async () => {
    const s = await sb(); const { data: { user } } = await s.auth.getUser(); const body = t(f, "body"); if (!body) throw new Error("Write a comment first")
    must(await s.from("comments").insert({ entity_type: "video", entity_id: f.get("id"), client_id: f.get("client_id"), author_id: user!.id, body, internal: true }))
  })
}

type SP = { view?: string; client?: string; video?: string }
export default async function Production({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams; const view = sp.view === "table" ? "table" : "board"; const s = await sb(); const { data: { user } } = await s.auth.getUser()
  const qs = (o: Partial<SP>) => { const n = new URLSearchParams(Object.entries({ ...sp, ...o }).filter(([, v]) => v) as [string, string][]); return "/production" + (n.size ? "?" + n : "") }
  const cols = "id,code,title,stage,client_id,shoot_date,editing_deadline,posting_date,content_category,updated_at,clients(business_name),editor:profiles!videos_editor_id_fkey(full_name)"
  let q = s.from("videos").select(cols).neq("status", "cancelled").order("updated_at", { ascending: false }).limit(400)
  if (sp.client) q = q.eq("client_id", sp.client)
  const [{ data: vids }, { data: clients }, { data: people }, { data: me }] = await Promise.all([q, s.from("clients").select("id,business_name").order("business_name"),
    s.from("profiles").select("id,full_name").eq("is_active", true).neq("role", "client"), s.from("profiles").select("role").eq("id", user!.id).single()])
  const mgr = isManagerRole(me?.role); const today = new Date().toISOString().slice(0, 10)
  // only the latest published videos are shown on the board; the table shows everything loaded
  const shown = (vids ?? []).filter((v: any) => view === "table" || v.stage !== "published" || (vids as any[]).filter(x => x.stage === "published").indexOf(v) < 15)
  const late = (v: any) => v.editing_deadline && v.editing_deadline < today && ["editing", "footage_uploaded", "revision_required"].includes(v.stage)
  const sel: any = sp.video ? await s.from("videos").select("*,clients(business_name)").eq("id", sp.video).maybeSingle() : null; const d = sel?.data
  const [{ data: appr }, { data: cmts }] = d ? await Promise.all([
    s.from("approvals").select("id,decision,feedback,created_at,decided_by_role,who:profiles!approvals_decided_by_fkey(full_name)").eq("entity_type", "video").eq("entity_id", d.id).order("created_at", { ascending: false }),
    s.from("comments").select("id,body,who:profiles!comments_author_id_fkey(full_name)").eq("entity_type", "video").eq("entity_id", d.id).order("created_at")]) : [{ data: null }, { data: null }]
  const P = (k: string, v: any, ph?: string) => <input name={k} defaultValue={v ?? ""} placeholder={ph} className="inp" />
  const Pick = (k: string, v: any) => <select name={k} defaultValue={v ?? ""} className="inp"><option value="">—</option>{people?.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select>
  const Card = (v: any) => <div key={v.id} className={`bg-navy border rounded-lg p-3 space-y-1 text-sm ${late(v) ? "border-red-700" : "border-line"} ${sp.video === v.id ? "ring-2 ring-blue-500" : ""}`}>
    <div className="flex justify-between text-xs text-slate-400"><span>{v.code}</span>{late(v) && <span className="text-red-400">overdue</span>}</div>
    <Link href={qs({ video: v.id })} className="font-medium hover:underline block">{v.title}</Link>
    <div className="text-xs text-slate-400">{v.clients?.business_name}{v.editor?.full_name ? ` · ✂ ${v.editor.full_name}` : ""}</div>
    {(v.shoot_date || v.editing_deadline) && <div className="text-xs text-slate-400">{v.shoot_date && `Shoot ${fmt(v.shoot_date)}`}{v.shoot_date && v.editing_deadline && " · "}{v.editing_deadline && `Edit by ${fmt(v.editing_deadline)}`}</div>}
    <form action={move} className="flex gap-1 pt-1"><input type="hidden" name="id" value={v.id} /><input type="hidden" name="back" value={qs({})} />
      <select name="stage" defaultValue={v.stage} className="inp !py-1 !px-1 text-xs">{STAGES.map(x => <option key={x} value={x}>{label(x)}</option>)}</select><button className="btn2 !px-2 !py-1 text-xs">Move</button></form></div>
  return <div className="space-y-6">
    <div className="flex justify-between flex-wrap gap-3"><h1 className="text-2xl font-bold">Production</h1>
      <div className="flex gap-2"><Link href={qs({ view: "board" })} className={`btn2 text-sm ${view === "board" ? "!bg-line" : ""}`}>Board</Link><Link href={qs({ view: "table" })} className={`btn2 text-sm ${view === "table" ? "!bg-line" : ""}`}>Table</Link></div></div>
    <div className="flex gap-3 flex-wrap items-start">
      <form className="flex gap-2"><input type="hidden" name="view" value={view} /><select name="client" defaultValue={sp.client ?? ""} className="inp !w-56"><option value="">All clients</option>{clients?.map(c => <option key={c.id} value={c.id}>{c.business_name}</option>)}</select><button className="btn2">Filter</button></form>
      <details className="bg-card border border-line rounded-xl p-3"><summary className="cursor-pointer text-sm font-semibold">+ New video</summary>
        <form action={create} className="flex gap-2 pt-3 flex-wrap"><input type="hidden" name="back" value={qs({})} />
          <select name="client_id" required className="inp !w-48"><option value="">Client…</option>{clients?.map(c => <option key={c.id} value={c.id}>{c.business_name}</option>)}</select>
          <input name="title" required placeholder="Title" className="inp !w-56" /><input name="category" placeholder="Category" className="inp !w-40" /><button className="btn">Add</button></form></details></div>

    {d && <div className="bg-card border border-line rounded-xl p-5 grid lg:grid-cols-[1fr_20rem] gap-6">
      <div className="space-y-3"><div className="flex justify-between"><div><span className="text-xs text-slate-400">{d.code} · {d.clients?.business_name}</span><h2 className="text-lg font-bold">{d.title}</h2></div>
        <div className="text-right space-y-1"><span className={`tag ${tone(d.stage)}`}>{label(d.stage)}</span><div><Link href={qs({ video: undefined })} className="text-xs underline text-slate-400">close</Link></div></div></div>
        <form action={details} className="grid grid-cols-2 gap-3"><input type="hidden" name="id" value={d.id} /><input type="hidden" name="back" value={qs({})} />
          <label className="col-span-2"><span className="text-xs text-slate-400">Title</span>{P("title", d.title)}</label>
          <label><span className="text-xs text-slate-400">Category</span>{P("category", d.content_category)}</label>
          <label><span className="text-xs text-slate-400">Shoot location</span>{P("shoot_location", d.shoot_location)}</label>
          <label><span className="text-xs text-slate-400">Scriptwriter</span>{Pick("scriptwriter_id", d.scriptwriter_id)}</label>
          <label><span className="text-xs text-slate-400">Videographer</span>{Pick("videographer_id", d.videographer_id)}</label>
          <label><span className="text-xs text-slate-400">Editor</span>{Pick("editor_id", d.editor_id)}</label>
          <label><span className="text-xs text-slate-400">Shoot date</span><input type="date" name="shoot_date" defaultValue={d.shoot_date ?? ""} className="inp" /></label>
          <label><span className="text-xs text-slate-400">Editing deadline</span><input type="date" name="editing_deadline" defaultValue={d.editing_deadline ?? ""} className="inp" /></label>
          <label><span className="text-xs text-slate-400">Internal review deadline</span><input type="date" name="review_deadline" defaultValue={d.internal_review_deadline ?? ""} className="inp" /></label>
          <label className="col-span-2"><span className="text-xs text-slate-400">Final video link (draft/export)</span>{P("final_video_url", d.final_video_url, "https://…")}</label>
          <button className="btn col-span-2">Save details</button></form>
        {d.stage !== "published" && <form action={publish} className="flex gap-2 border-t border-line pt-3"><input type="hidden" name="id" value={d.id} /><input type="hidden" name="back" value={qs({})} />
          <input name="url" defaultValue={d.final_video_url ?? ""} placeholder="Live post link (required)" className="inp" /><button className="btn2 whitespace-nowrap">Mark published</button></form>}
        {d.stage === "published" && d.published_url && <p className="text-sm">Published: <a href={d.published_url} className="underline" target="_blank" rel="noopener noreferrer">{d.published_url}</a></p>}
        <p className="text-xs text-slate-500">Publishing is recorded by hand. Nothing is posted to any platform from here.</p></div>
      <div className="space-y-4">
        {mgr && <form action={decide} className="space-y-2 border border-line rounded-lg p-3"><b className="text-sm">Review</b><input type="hidden" name="id" value={d.id} /><input type="hidden" name="back" value={qs({})} />
          <textarea name="feedback" rows={2} placeholder="Feedback (required for revision)" className="inp" />
          <div className="flex gap-2 flex-wrap"><button name="decision" value="send_to_client" className="btn2 text-sm">Send to client</button><button name="decision" value="approved" className="btn !bg-emerald-600 !py-1 text-sm">Approve</button><button name="decision" value="changes_requested" className="btn !bg-red-600 !py-1 text-sm">Revision</button></div></form>}
        <div className="space-y-2 text-sm"><b>Approvals</b>{appr?.map((a: any) => <div key={a.id} className="border-t border-line pt-1"><span className={`tag ${tone(a.decision)}`}>{label(a.decision)}</span> {a.who?.full_name} ({a.decided_by_role}){a.feedback && <p className="text-slate-400">{a.feedback}</p>}</div>)}{!appr?.length && <p className="text-slate-400">None yet.</p>}</div>
        <div className="space-y-2 text-sm"><b>Internal comments</b>{cmts?.map((c: any) => <div key={c.id} className="border-t border-line pt-1"><span className="text-slate-400">{c.who?.full_name}:</span> {c.body}</div>)}
          <form action={comment} className="space-y-2"><input type="hidden" name="id" value={d.id} /><input type="hidden" name="client_id" value={d.client_id} /><input type="hidden" name="back" value={qs({})} /><textarea name="body" rows={2} className="inp" /><button className="btn2 text-sm">Comment</button></form></div></div></div>}

    {view === "board" ? <div className="flex gap-3 overflow-x-auto pb-4">{STAGES.map(st => { const items = shown.filter((v: any) => v.stage === st)
      return <div key={st} className="w-64 shrink-0 bg-card border border-line rounded-xl p-3 space-y-2"><div className="flex justify-between text-sm font-semibold"><span>{label(st)}</span><span className="text-slate-400">{items.length}</span></div>{items.map(Card)}</div> })}</div>
    : <table className="w-full text-left text-sm"><thead className="text-slate-400"><tr><th className="py-2">Code</th><th>Title</th><th>Client</th><th>Stage</th><th>Editor</th><th>Shoot</th><th>Edit deadline</th></tr></thead>
      <tbody>{shown.map((v: any) => <tr key={v.id} className="border-t border-line"><td className="py-2 text-slate-400">{v.code}</td><td><Link href={qs({ video: v.id })} className="hover:underline">{v.title}</Link></td><td>{v.clients?.business_name}</td>
        <td><span className={`tag ${tone(v.stage)}`}>{label(v.stage)}</span></td><td>{v.editor?.full_name ?? "—"}</td><td>{fmt(v.shoot_date)}</td><td className={late(v) ? "text-red-400" : ""}>{fmt(v.editing_deadline)}</td></tr>)}
        {!shown.length && <tr><td colSpan={7} className="py-8 text-center text-slate-400">No videos yet.</td></tr>}</tbody></table>}</div>
}
