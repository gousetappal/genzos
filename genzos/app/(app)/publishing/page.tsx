import Link from "next/link"
import { sb } from "@/lib/supabase/server"
import { must, run } from "@/lib/flash"
import { PLATFORMS, dt, fromLocalInput, hm, label, t, toLocalInput, today, tone, url } from "@/lib/ui"

const here = (f: FormData) => String(f.get("back") || "/publishing")
const link = (f: FormData, k: string) => { const v = t(f, k); if (!v) return null; const u = url(v); if (!u) throw new Error("Links must start with http:// or https://"); return u }
const fields = (f: FormData) => {
  const when = fromLocalInput(f.get("when")); if (!when) throw new Error("Pick a date and time")
  const title = t(f, "title"); if (!title) throw new Error("Enter a title")
  const platform = String(f.get("platform")); if (!(PLATFORMS as readonly string[]).includes(platform)) throw new Error("Pick a platform")
  return { title, platform, scheduled_at: when, caption: t(f, "caption"), hashtags: t(f, "hashtags"), preview_url: link(f, "preview"), video_id: f.get("video_id") || null }
}
// Scheduling here only records WHEN a post is due. Nothing is posted to any platform.
async function create(f: FormData) {
  "use server"
  await run(here(f), "Added to the publishing calendar", async () => {
    const s = await sb(); const { data: { user } } = await s.auth.getUser(); if (!f.get("client_id")) throw new Error("Pick a client")
    const x = fields(f)
    must(await s.from("content_calendar").insert({ client_id: f.get("client_id"), ...x, created_by: user!.id }))
    if (x.video_id) await s.from("videos").update({ stage: "scheduled_for_posting", posting_date: x.scheduled_at }).eq("id", x.video_id).eq("stage", "approved")
  })
}
async function update(f: FormData) {
  "use server"
  await run(here(f), "Saved", async () => {
    const s = await sb(); const x = fields(f)
    const r = must(await s.from("content_calendar").update(x).eq("id", f.get("id")).eq("status", "scheduled").select("id")) as any[]
    if (!r.length) throw new Error("Only scheduled entries can be edited")
    if (x.video_id) await s.from("videos").update({ posting_date: x.scheduled_at }).eq("id", x.video_id)
  })
}
// A post is only "published" once someone pastes the live link. The linked video is moved to Published first, so the
// database rule (client approval required) is enforced before the calendar entry changes.
async function publish(f: FormData) {
  "use server"
  await run(here(f), "Marked as published", async () => {
    const s = await sb(); const live = url(f.get("url")); if (!live) throw new Error("Paste the live http(s) link of the post to mark it published")
    const e = must(await s.from("content_calendar").select("id,client_id,video_id,status").eq("id", f.get("id")).single()) as any
    if (e.status !== "scheduled") throw new Error("This entry is not scheduled")
    if (e.video_id) { const v = await s.from("videos").update({ stage: "published", published_url: live }).eq("id", e.video_id).select("id")
      if (v.error) throw new Error(v.error.code === "23505" ? "That link is already counted for this client" : v.error.message)
      if (!v.data?.length) throw new Error("Not allowed to publish the linked video") }
    must(await s.from("content_calendar").update({ status: "published", published_url: live, published_at: new Date().toISOString() }).eq("id", e.id))
  })
}
async function cancel(f: FormData) {
  "use server"
  await run(here(f), "Cancelled", async () => { const s = await sb(); must(await s.from("content_calendar").update({ status: "cancelled" }).eq("id", f.get("id")).eq("status", "scheduled")) })
}

type SP = { view?: string; month?: string; client?: string; entry?: string; platform?: string }
export default async function Publishing({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams; const view = sp.view === "list" ? "list" : "cal"; const s = await sb()
  const ym = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : today().slice(0, 7); const [y, m] = ym.split("-").map(Number)
  const qs = (o: Partial<SP>) => { const n = new URLSearchParams(Object.entries({ ...sp, ...o }).filter(([, v]) => v) as [string, string][]); return "/publishing" + (n.size ? "?" + n : "") }
  const shift = (d: number) => new Date(Date.UTC(y, m - 1 + d, 1)).toISOString().slice(0, 7)
  const cols = "id,title,platform,scheduled_at,status,caption,hashtags,preview_url,published_url,published_at,client_id,video_id,clients(business_name),videos(code,title)"
  let q = s.from("content_calendar").select(cols).order("scheduled_at")
  q = view === "cal" ? q.gte("scheduled_at", `${ym}-01T00:00:00+05:30`).lt("scheduled_at", `${shift(1)}-01T00:00:00+05:30`) : q.eq("status", "scheduled").limit(200)
  if (sp.client) q = q.eq("client_id", sp.client); if (sp.platform) q = q.eq("platform", sp.platform)
  const [{ data: rows }, { data: clients }, { data: vids }, { data: overdue }] = await Promise.all([q, s.from("clients").select("id,business_name").order("business_name"),
    s.from("videos").select("id,code,title,client_id").in("stage", ["approved", "scheduled_for_posting"]).order("code").limit(300),
    s.from("content_calendar").select("id,title,scheduled_at,clients(business_name)").eq("status", "scheduled").lt("scheduled_at", new Date().toISOString()).order("scheduled_at").limit(20)])
  const d: any = sp.entry ? ((rows as any[]) ?? []).find(r => r.id === sp.entry) ?? (await s.from("content_calendar").select(cols).eq("id", sp.entry).maybeSingle()).data : null
  const Vid = (v: any, cid?: string) => <select name="video_id" defaultValue={v ?? ""} className="inp"><option value="">No linked video</option>{vids?.filter((x: any) => !cid || x.client_id === cid || x.id === v).map((x: any) => <option key={x.id} value={x.id}>{x.code} · {x.title}</option>)}</select>
  const Plat = (v: string) => <select name="platform" defaultValue={v} className="inp">{PLATFORMS.map(p => <option key={p} value={p}>{label(p)}</option>)}</select>
  const first = new Date(Date.UTC(y, m - 1, 1)), lead = (first.getUTCDay() + 6) % 7, days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const byDay = new Map<string, any[]>(); ((rows as any[]) ?? []).forEach(r => { const k = toLocalInput(r.scheduled_at).slice(0, 10); byDay.set(k, [...(byDay.get(k) ?? []), r]) })
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)]; while (cells.length % 7) cells.push(null)
  const chip = (x: any) => <Link key={x.id} href={qs({ entry: x.id })} className={`block rounded px-1.5 py-0.5 text-[11px] leading-tight border bg-navy ${tone(x.status)} ${x.status === "cancelled" ? "line-through opacity-60" : ""} ${sp.entry === x.id ? "ring-2 ring-blue-500" : ""}`}>{hm(x.scheduled_at)} {x.title}<span className="block text-slate-400 truncate">{label(x.platform)} · {x.clients?.business_name}</span></Link>
  return <div className="space-y-6">
    <div className="flex justify-between flex-wrap gap-3"><h1 className="text-2xl font-bold">Publishing calendar</h1>
      <div className="flex gap-2"><Link href={qs({ view: "cal" })} className={`btn2 text-sm ${view === "cal" ? "!bg-line" : ""}`}>Calendar</Link><Link href={qs({ view: "list" })} className={`btn2 text-sm ${view === "list" ? "!bg-line" : ""}`}>Scheduled list</Link></div></div>
    <p className="text-xs text-slate-500">This calendar is a reminder system. Nothing is posted to Instagram, YouTube, Facebook or LinkedIn from here: post by hand, then paste the live link to mark it published.</p>
    {!!overdue?.length && <div className="bg-amber-950/40 border border-amber-800 rounded-xl p-3 text-sm"><b className="text-amber-300">Past due, not yet marked published ({overdue.length})</b>{(overdue as any[]).map(o => <div key={o.id}><Link href={qs({ entry: o.id })} className="underline">{o.title}</Link> <span className="text-slate-400">· {o.clients?.business_name} · {dt(o.scheduled_at)}</span></div>)}</div>}
    <div className="flex gap-3 flex-wrap items-start">
      <form className="flex gap-2"><input type="hidden" name="view" value={view} /><input type="hidden" name="month" value={ym} /><select name="client" defaultValue={sp.client ?? ""} className="inp !w-52"><option value="">All clients</option>{clients?.map(c => <option key={c.id} value={c.id}>{c.business_name}</option>)}</select>
        <select name="platform" defaultValue={sp.platform ?? ""} className="inp !w-40"><option value="">All platforms</option>{PLATFORMS.map(p => <option key={p} value={p}>{label(p)}</option>)}</select><button className="btn2">Filter</button></form>
      <details className="bg-card border border-line rounded-xl p-3"><summary className="cursor-pointer text-sm font-semibold">+ Schedule a post</summary>
        <form action={create} className="grid grid-cols-2 gap-3 pt-3 w-[34rem] max-w-full"><input type="hidden" name="back" value={qs({})} />
          <select name="client_id" required className="inp"><option value="">Client…</option>{clients?.map(c => <option key={c.id} value={c.id}>{c.business_name}</option>)}</select><input name="title" required placeholder="Post title" className="inp" />
          <label className="text-xs text-slate-400">Platform{Plat("instagram")}</label><label className="text-xs text-slate-400">Post at (IST)<input type="datetime-local" name="when" required className="inp" /></label>
          <label className="text-xs text-slate-400 col-span-2">Linked video (approved ones){Vid(null)}</label>
          <textarea name="caption" rows={2} placeholder="Caption" className="inp col-span-2" /><input name="hashtags" placeholder="#hashtags" className="inp" /><input name="preview" type="url" placeholder="Preview link (optional)" className="inp" /><button className="btn col-span-2 w-fit">Add</button></form></details></div>

    {d && <div className="bg-card border border-line rounded-xl p-5 space-y-3"><div className="flex justify-between"><div><span className="text-xs text-slate-400">{d.clients?.business_name} · {label(d.platform)}</span><h2 className="text-lg font-bold">{d.title}</h2><p className="text-sm text-slate-400">{dt(d.scheduled_at)} IST</p></div>
      <div className="text-right"><span className={`tag ${tone(d.status)}`}>{label(d.status)}</span><div><Link href={qs({ entry: undefined })} className="text-xs underline text-slate-400">close</Link></div></div></div>
      {d.status === "scheduled" ? <>
        <form action={update} className="grid grid-cols-2 gap-3"><input type="hidden" name="id" value={d.id} /><input type="hidden" name="back" value={qs({})} />
          <input name="title" required defaultValue={d.title} className="inp" /><div className="grid grid-cols-2 gap-3">{Plat(d.platform)}<input type="datetime-local" name="when" required defaultValue={toLocalInput(d.scheduled_at)} className="inp" /></div>
          <label className="text-xs text-slate-400 col-span-2">Linked video{Vid(d.video_id, d.client_id)}</label>
          <textarea name="caption" rows={3} defaultValue={d.caption ?? ""} placeholder="Caption" className="inp col-span-2" /><input name="hashtags" defaultValue={d.hashtags ?? ""} placeholder="#hashtags" className="inp" /><input name="preview" type="url" defaultValue={d.preview_url ?? ""} placeholder="Preview link" className="inp" /><button className="btn w-fit">Save</button></form>
        <div className="flex gap-3 flex-wrap border-t border-line pt-3"><form action={publish} className="flex gap-2 flex-1 min-w-72"><input type="hidden" name="id" value={d.id} /><input type="hidden" name="back" value={qs({})} /><input name="url" type="url" required placeholder="Live post link (required)" className="inp" /><button className="btn !bg-emerald-600 whitespace-nowrap">Mark published</button></form>
          <form action={cancel}><input type="hidden" name="id" value={d.id} /><input type="hidden" name="back" value={qs({})} /><button className="btn2 text-red-400">Cancel post</button></form></div></>
        : <div className="text-sm space-y-1">{d.caption && <p className="whitespace-pre-wrap">{d.caption}</p>}{d.published_url && <p>Live: <a href={d.published_url} target="_blank" rel="noopener noreferrer" className="underline text-blue-400 break-all">{d.published_url}</a></p>}</div>}
      {d.preview_url && <p className="text-sm">Preview: <a href={d.preview_url} target="_blank" rel="noopener noreferrer" className="underline text-blue-400">{d.preview_url}</a></p>}</div>}

    {view === "cal" ? <div className="space-y-3"><div className="flex items-center gap-3"><Link href={qs({ month: shift(-1) })} className="underline text-sm">← Prev</Link><b>{first.toLocaleString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })}</b><Link href={qs({ month: shift(1) })} className="underline text-sm">Next →</Link></div>
      <div className="grid grid-cols-7 gap-px bg-line border border-line rounded-xl overflow-hidden text-xs">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(x => <div key={x} className="bg-card p-2 text-slate-400">{x}</div>)}
        {cells.map((c, i) => { const k = c ? `${ym}-${String(c).padStart(2, "0")}` : ""; return <div key={i} className={`bg-navy min-h-24 p-1 space-y-1 ${k === today() ? "ring-1 ring-inset ring-blue-500" : ""}`}>{c && <div className="text-slate-400">{c}</div>}{(byDay.get(k) ?? []).map(chip)}</div> })}</div></div>
    : <table className="w-full text-left text-sm"><thead className="text-slate-400"><tr><th className="py-2">When (IST)</th><th>Post</th><th>Client</th><th>Platform</th><th>Video</th></tr></thead>
      <tbody>{(rows as any[] | null)?.map(r => <tr key={r.id} className="border-t border-line"><td className="py-2">{dt(r.scheduled_at)}</td><td><Link href={qs({ entry: r.id })} className="hover:underline">{r.title}</Link></td><td>{r.clients?.business_name}</td><td>{label(r.platform)}</td><td>{r.videos?.code ?? "—"}</td></tr>)}
        {!rows?.length && <tr><td colSpan={5} className="py-8 text-center text-slate-400">Nothing scheduled.</td></tr>}</tbody></table>}</div>
}
