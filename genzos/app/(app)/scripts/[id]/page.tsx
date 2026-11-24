import Link from "next/link"
import { notFound } from "next/navigation"
import { sb } from "@/lib/supabase/server"
import { must, run } from "@/lib/flash"
import { LANGS, PLATFORMS, TONES, isManagerRole, label, t, tone } from "@/lib/ui"

const BODY = ["title", "hook", "intro", "main_content", "supporting", "cta", "caption", "hashtags", "language", "tone"] as const
const P = (id: string) => `/scripts/${id}`

async function save(f: FormData) {
  "use server"
  const id = String(f.get("id"))
  await run(P(id), "Saved", async () => {
    const s = await sb(); const upd: Record<string, any> = {}
    for (const k of BODY) upd[k] = t(f, k)
    if (!upd.title) throw new Error("Title is required")
    upd.language ??= "english"; upd.tone ??= "conversational"
    Object.assign(upd, { category: t(f, "category"), objective: t(f, "objective"), target_audience: t(f, "target_audience"), platform: f.get("platform"), scriptwriter_id: f.get("scriptwriter_id") || null })
    const r = must(await s.from("scripts").update(upd).eq("id", id).select("id")) as any[]
    if (!r.length) throw new Error("Not allowed to edit this script")
  })
}
async function submit(f: FormData) {
  "use server"
  const id = String(f.get("id"))
  await run(P(id), "Submitted for approval", async () => {
    const s = await sb(); const sc = must(await s.from("scripts").select("status,video_id").eq("id", id).single()) as any
    if (!["draft", "changes_requested"].includes(sc.status)) throw new Error("Only drafts can be submitted")
    must(await s.from("scripts").update({ status: "in_review" }).eq("id", id))
    if (sc.video_id) must(await s.from("videos").update({ stage: "script_review" }).eq("id", sc.video_id).in("stage", ["idea_created", "research_completed", "script_writing"]))
  })
}
// the ONLY approve/reject path is the decide() database function; role and state are checked there
async function decide(f: FormData) {
  "use server"
  const id = String(f.get("id")), d = String(f.get("decision"))
  await run(P(id), d === "approved" ? "Script approved" : d === "send_to_client" ? "Sent to client" : "Changes requested", async () => {
    const s = await sb()
    if (d === "changes_requested" && !t(f, "feedback")) throw new Error("Write what needs to change")
    must(await s.rpc("decide", { p_type: "script", p_id: id, p_decision: d, p_feedback: t(f, "feedback") }))
    const sc = must(await s.from("scripts").select("video_id").eq("id", id).single()) as any
    if (sc.video_id && d === "approved") await s.from("videos").update({ stage: "script_approved" }).eq("id", sc.video_id).in("stage", ["idea_created", "research_completed", "script_writing", "script_review"])
    if (sc.video_id && d === "changes_requested") await s.from("videos").update({ stage: "script_writing" }).eq("id", sc.video_id).eq("stage", "script_review")
  })
}
async function restore(f: FormData) {
  "use server"
  const id = String(f.get("id"))
  await run(P(id), "Version restored (saved as a new version)", async () => {
    const s = await sb(); const v = must(await s.from("script_versions").select("snapshot").eq("id", f.get("version_id")).eq("script_id", id).single()) as any
    must(await s.from("scripts").update(v.snapshot).eq("id", id))
  })
}
async function comment(f: FormData) {
  "use server"
  const id = String(f.get("id"))
  await run(P(id), "Comment added", async () => {
    const s = await sb(); const { data: { user } } = await s.auth.getUser(); const body = t(f, "body"); if (!body) throw new Error("Write a comment first")
    const sc = must(await s.from("scripts").select("client_id").eq("id", id).single()) as any
    must(await s.from("comments").insert({ entity_type: "script", entity_id: id, client_id: sc.client_id, author_id: user!.id, body, internal: true }))
  })
}

export default async function ScriptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const s = await sb(); const { data: { user } } = await s.auth.getUser()
  const { data: sc } = await s.from("scripts").select("*,clients(business_name)").eq("id", id).maybeSingle(); if (!sc) notFound()
  const [{ data: me }, { data: people }, { data: versions }, { data: approvals }, { data: comments }] = await Promise.all([
    s.from("profiles").select("role").eq("id", user!.id).single(),
    s.from("profiles").select("id,full_name").eq("is_active", true).neq("role", "client"),
    s.from("script_versions").select("id,version,created_at").eq("script_id", id).order("version", { ascending: false }),
    s.from("approvals").select("id,decision,feedback,created_at,decided_by_role,who:profiles!approvals_decided_by_fkey(full_name)").eq("entity_type", "script").eq("entity_id", id).order("created_at", { ascending: false }),
    s.from("comments").select("id,body,created_at,who:profiles!comments_author_id_fkey(full_name)").eq("entity_type", "script").eq("entity_id", id).order("created_at")])
  const mgr = isManagerRole(me?.role); const locked = ["client_review", "client_approved"].includes(sc.status)
  const F = ({ k, rows = 3, ph }: { k: string; rows?: number; ph?: string }) => <label className="block"><span className="text-xs text-slate-400">{label(k)}</span>
    <textarea name={k} defaultValue={sc[k] ?? ""} rows={rows} placeholder={ph} className="inp" /></label>
  return <div className="grid xl:grid-cols-[1fr_22rem] gap-6">
    <form action={save} className="space-y-4"><input type="hidden" name="id" value={id} />
      <Link href="/scripts" className="text-sm text-slate-400 underline">← Scripts</Link>
      <div className="flex items-center gap-3 flex-wrap"><h1 className="text-2xl font-bold">{sc.title}</h1><span className={`tag ${tone(sc.status)}`}>{label(sc.status)}</span><span className="tag">v{sc.version}</span></div>
      <p className="text-sm text-slate-400">{(sc as any).clients?.business_name}</p>
      {["approved", "client_review", "client_approved"].includes(sc.status) && <p className="text-sm text-amber-400 border border-amber-800 rounded-lg p-2">Editing the text of an approved script resets it to draft and it must be approved again.</p>}
      <div className="grid grid-cols-2 gap-3 bg-card border border-line rounded-xl p-4">
        <label className="col-span-2"><span className="text-xs text-slate-400">Title</span><input name="title" defaultValue={sc.title} required className="inp" /></label>
        <label><span className="text-xs text-slate-400">Category</span><input name="category" defaultValue={sc.category ?? ""} className="inp" /></label>
        <label><span className="text-xs text-slate-400">Objective</span><input name="objective" defaultValue={sc.objective ?? ""} className="inp" /></label>
        <label><span className="text-xs text-slate-400">Target audience</span><input name="target_audience" defaultValue={sc.target_audience ?? ""} className="inp" /></label>
        <label><span className="text-xs text-slate-400">Platform</span><select name="platform" defaultValue={sc.platform} className="inp">{PLATFORMS.map(x => <option key={x}>{x}</option>)}</select></label>
        <label><span className="text-xs text-slate-400">Language</span><select name="language" defaultValue={sc.language} className="inp">{LANGS.map(x => <option key={x}>{x}</option>)}</select></label>
        <label><span className="text-xs text-slate-400">Tone</span><select name="tone" defaultValue={sc.tone} className="inp">{TONES.map(x => <option key={x}>{x}</option>)}</select></label>
        <label className="col-span-2"><span className="text-xs text-slate-400">Scriptwriter</span><select name="scriptwriter_id" defaultValue={sc.scriptwriter_id ?? ""} className="inp"><option value="">Unassigned</option>{people?.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></label></div>
      <div className="space-y-3 bg-card border border-line rounded-xl p-4">
        <F k="hook" rows={2} ph="First 3 seconds" /><F k="intro" /><F k="main_content" rows={8} ph="Scene by scene: visual + voice-over" /><F k="supporting" ph="B-roll, text overlays, music" />
        <F k="cta" rows={2} /><F k="caption" rows={3} /><F k="hashtags" rows={2} /></div>
      <button className="btn" disabled={locked && !mgr}>Save script</button>{locked && <span className="ml-3 text-sm text-slate-400">With the client — saving will pull it back to draft.</span>}</form>
    <aside className="space-y-4">
      <div className="bg-card border border-line rounded-xl p-4 space-y-3"><b>Workflow</b>
        {["draft", "changes_requested"].includes(sc.status) && <form action={submit}><input type="hidden" name="id" value={id} /><button className="btn w-full">Submit for approval</button></form>}
        {mgr ? <form action={decide} className="space-y-2"><input type="hidden" name="id" value={id} />
          <textarea name="feedback" placeholder="Feedback (required for changes)" rows={2} className="inp" />
          <div className="flex gap-2 flex-wrap">
            <button name="decision" value="approved" className="btn !bg-emerald-600" disabled={["approved", "client_review", "client_approved"].includes(sc.status)}>Approve</button>
            <button name="decision" value="changes_requested" className="btn !bg-red-600" disabled={sc.status === "client_approved"}>Request changes</button>
            <button name="decision" value="send_to_client" className="btn2" disabled={!["approved"].includes(sc.status)}>Send to client</button></div></form>
          : <p className="text-xs text-slate-400">Approval is done by admins or project managers, and by the client.</p>}</div>
      <div className="bg-card border border-line rounded-xl p-4 space-y-2"><b>Approval history</b>
        {approvals?.map((a: any) => <div key={a.id} className="text-sm border-t border-line pt-2"><span className={`tag ${tone(a.decision)}`}>{label(a.decision)}</span> {a.who?.full_name} ({a.decided_by_role})
          {a.feedback && <p className="text-slate-400">{a.feedback}</p>}</div>)}{!approvals?.length && <p className="text-sm text-slate-400">None yet.</p>}</div>
      <div className="bg-card border border-line rounded-xl p-4 space-y-2"><b>Versions</b>
        <div className="text-sm">Current: v{sc.version}</div>
        {versions?.map(v => <form key={v.id} action={restore} className="flex justify-between text-sm border-t border-line pt-2"><input type="hidden" name="id" value={id} /><input type="hidden" name="version_id" value={v.id} />
          <span>v{v.version} · {new Date(v.created_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}</span><button className="underline">Restore</button></form>)}</div>
      <div className="bg-card border border-line rounded-xl p-4 space-y-2"><b>Internal comments</b>
        {comments?.map((c: any) => <div key={c.id} className="text-sm border-t border-line pt-2"><span className="text-slate-400">{c.who?.full_name}:</span> {c.body}</div>)}
        <form action={comment} className="space-y-2"><input type="hidden" name="id" value={id} /><textarea name="body" rows={2} className="inp" /><button className="btn2 text-sm">Comment</button></form></div></aside></div>
}
