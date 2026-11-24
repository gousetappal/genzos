import { redirect } from "next/navigation"
import { sb } from "@/lib/supabase/server"
import { must, run } from "@/lib/flash"
import { dt, fmt, label, t, tone, today } from "@/lib/ui"
import Flash from "@/components/Flash"
async function signOut() { "use server"; const s = await sb(); await s.auth.signOut(); redirect("/login") }
// Approve / request changes goes only through the decide() database function, which checks role and state.
async function decide(f: FormData) {
  "use server"
  await run("/portal", String(f.get("decision")) === "approved" ? "Approved. Thank you!" : "Your feedback was sent to the team", async () => {
    const s = await sb()
    must(await s.rpc("decide", { p_type: String(f.get("type")), p_id: String(f.get("id")), p_decision: String(f.get("decision")), p_feedback: t(f, "feedback") }))
  })
}
async function comment(f: FormData) {
  "use server"
  await run("/portal", "Comment added", async () => {
    const s = await sb(); const { data: { user } } = await s.auth.getUser()
    const type = String(f.get("type")) === "script" ? "script" : "video"
    const body = t(f, "body"); if (!body) throw new Error("Write a comment first")
    const { data: me } = await s.from("profiles").select("client_id").eq("id", user!.id).single()
    must(await s.from("comments").insert({ entity_type: type, entity_id: String(f.get("id")), client_id: me?.client_id, author_id: user!.id, body, internal: false }))
  })
}
async function markRead() {
  "use server"
  await run("/portal", "Marked as read", async () => {
    const s = await sb(); const { data: { user } } = await s.auth.getUser()
    must(await s.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", user!.id).is("read_at", null))
  })
}
export default async function Portal() {
  const s = await sb(); const { data: { user } } = await s.auth.getUser(); if (!user) redirect("/login")
  const { data: c } = await s.from("portal_client").select("id,business_name,monthly_deliverables,contract_months,start_date").maybeSingle()
  if (!c) return <main className="min-h-screen grid place-items-center"><div className="bg-card border border-line rounded-2xl p-8 w-[28rem] space-y-3">
    <h1 className="text-xl font-bold">Client portal</h1><p className="text-sm text-slate-400">Your account isn't linked to a business yet. Please contact GENZ FILMS.</p>
    <form action={signOut}><button className="btn2">Sign out</button></form></div></main>
  const ms = today().slice(0, 7) + "-01"
  const [{ data: vids }, { data: scripts }, { data: cal }, { data: cm }, { data: ap }, { data: nt }, { count: pubMonth }] = await Promise.all([
    s.from("videos").select("id,code,title,stage,final_video_url,published_url,published_on,client_approved_at").order("updated_at", { ascending: false }).limit(100),
    s.from("scripts").select("id,title,status,platform,hook,intro,main_content,supporting,cta,caption,hashtags").order("updated_at", { ascending: false }).limit(50),
    s.from("content_calendar").select("id,title,platform,scheduled_at,status,published_url").neq("status", "cancelled").order("scheduled_at").limit(30),
    s.from("comments").select("id,entity_id,body,created_at,author_id").order("created_at").limit(300),
    s.from("approvals").select("id,entity_type,entity_id,decision,feedback,decided_by_role,created_at").order("created_at", { ascending: false }).limit(20),
    s.from("notifications").select("id,title,read_at,created_at").order("created_at", { ascending: false }).limit(10),
    s.from("videos").select("*", { count: "exact", head: true }).eq("status", "published").gte("published_on", ms)])
  const titleOf = new Map<string, string>([...(vids ?? []).map((v: any) => [v.id, v.title] as [string, string]), ...(scripts ?? []).map((x: any) => [x.id, x.title] as [string, string])])
  const waiting = [...(vids ?? []).filter((v: any) => v.stage === "client_review").map((v: any) => ({ ...v, type: "video" })),
    ...(scripts ?? []).filter((x: any) => x.status === "client_review").map((x: any) => ({ ...x, type: "script" }))]
  const published = (vids ?? []).filter((v: any) => v.stage === "published"), approved = (vids ?? []).filter((v: any) => ["approved", "scheduled_for_posting"].includes(v.stage))
  const unread = (nt ?? []).filter((n: any) => !n.read_at).length
  const card = "bg-card border border-line rounded-xl p-4 space-y-3"
  return <main className="min-h-screen p-4 sm:p-8 max-w-5xl mx-auto space-y-6">
    <div className="flex items-center justify-between gap-3"><div><h1 className="text-2xl font-bold">{c.business_name}</h1>
      <p className="text-sm text-slate-400">GENZ FILMS client portal</p></div>
      <form action={signOut}><button className="btn2 text-sm">Sign out</button></form></div>
    <Flash />
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      {([["Published this month", `${pubMonth ?? 0} / ${c.monthly_deliverables}`], ["Awaiting your approval", waiting.length], ["Approved, to be posted", approved.length], ["Published in total", published.length]] as [string, string | number][]).map(([l, v]) =>
        <div key={l} className="bg-card border border-line rounded-xl p-4"><div className="text-xs text-slate-400">{l}</div><div className="text-2xl font-bold mt-1">{v}</div></div>)}</div>

    <section className="space-y-3"><h2 className="text-lg font-semibold">Awaiting your approval</h2>
      {waiting.map((w: any) => <div key={w.type + w.id} className={card}>
        <div className="flex flex-wrap items-center gap-2"><span className="tag">{w.type}</span><b>{w.title}</b>{w.code && <span className="text-xs text-slate-500">{w.code}</span>}</div>
        {w.type === "video" && (w.final_video_url ? <a href={w.final_video_url} target="_blank" rel="noopener noreferrer" className="btn2 inline-block text-sm">▶ Watch the video</a> : <p className="text-sm text-slate-400">The video link will appear here shortly.</p>)}
        {w.type === "script" && <div className="text-sm space-y-2 whitespace-pre-wrap">
          {([["Hook", w.hook], ["Intro", w.intro], ["Main content", w.main_content], ["Supporting", w.supporting], ["Call to action", w.cta], ["Caption", w.caption], ["Hashtags", w.hashtags]] as [string, string | null][]).filter(([, v]) => v).map(([k, v]) =>
            <div key={k}><div className="text-xs text-slate-400">{k}</div>{v}</div>)}</div>}
        {(cm ?? []).filter((x: any) => x.entity_id === w.id).map((x: any) => <div key={x.id} className="text-sm border-t border-line pt-2"><span className="text-xs text-slate-500">{x.author_id === user.id ? "You" : "GENZ FILMS"} · {dt(x.created_at)}</span><br />{x.body}</div>)}
        <form action={comment} className="flex gap-2"><input type="hidden" name="type" value={w.type} /><input type="hidden" name="id" value={w.id} />
          <input name="body" placeholder="Add a comment" className="inp" /><button className="btn2 text-sm">Send</button></form>
        <form action={decide} className="space-y-2"><input type="hidden" name="type" value={w.type} /><input type="hidden" name="id" value={w.id} />
          <textarea name="feedback" rows={2} placeholder="What should we change? (required to request changes)" className="inp" />
          <div className="flex gap-2"><button name="decision" value="approved" className="btn">Approve</button>
            <button name="decision" value="changes_requested" className="btn2">Request changes</button></div></form></div>)}
      {!waiting.length && <p className="text-slate-400 text-sm">Nothing is waiting for you right now.</p>}</section>

    <section className="grid lg:grid-cols-2 gap-6">
      <div className="space-y-3"><h2 className="text-lg font-semibold">Upcoming posts</h2>
        {(cal ?? []).filter((x: any) => x.status === "scheduled").map((x: any) => <div key={x.id} className="bg-card border border-line rounded-xl p-3 text-sm flex justify-between gap-2">
          <span><b>{x.title}</b> <span className="tag">{x.platform}</span></span><span className="text-slate-400">{dt(x.scheduled_at)}</span></div>)}
        {!(cal ?? []).some((x: any) => x.status === "scheduled") && <p className="text-slate-400 text-sm">No posts scheduled yet.</p>}</div>
      <div className="space-y-3"><div className="flex justify-between"><h2 className="text-lg font-semibold">Updates {unread > 0 && <span className="tag">{unread} new</span>}</h2>
        {unread > 0 && <form action={markRead}><button className="text-xs underline">Mark all read</button></form>}</div>
        {(nt ?? []).map((n: any) => <div key={n.id} className={`bg-card border border-line rounded-xl p-3 text-sm ${n.read_at ? "opacity-60" : ""}`}>{n.title}<div className="text-xs text-slate-500">{dt(n.created_at)}</div></div>)}
        {!nt?.length && <p className="text-slate-400 text-sm">No updates yet.</p>}</div></section>

    <section className="space-y-3"><h2 className="text-lg font-semibold">Your published videos</h2>
      <div className="bg-card border border-line rounded-xl divide-y divide-line">{published.map((v: any) => <div key={v.id} className="p-3 flex justify-between gap-3 text-sm">
        <span>{v.title}</span><span className="text-slate-400 flex gap-3">{fmt(v.published_on)}{(v.published_url ?? v.final_video_url) && <a className="underline" target="_blank" rel="noopener noreferrer" href={v.published_url ?? v.final_video_url}>View</a>}</span></div>)}
        {!published.length && <p className="p-3 text-slate-400 text-sm">Nothing published yet.</p>}</div></section>

    <section className="space-y-3"><h2 className="text-lg font-semibold">Approval history</h2>
      <div className="bg-card border border-line rounded-xl divide-y divide-line">{(ap ?? []).map((a: any) => <div key={a.id} className="p-3 text-sm">
        <span className={`tag ${tone(a.decision)}`}>{label(a.decision)}</span> {titleOf.get(a.entity_id) ?? a.entity_type} <span className="text-xs text-slate-500">· {dt(a.created_at)}</span>
        {a.feedback && <p className="text-slate-400">{a.feedback}</p>}</div>)}
        {!ap?.length && <p className="p-3 text-slate-400 text-sm">No decisions yet.</p>}</div></section>
  </main>
}
