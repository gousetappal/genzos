import Link from "next/link"
import { sb } from "@/lib/supabase/server"
import { back, must, run } from "@/lib/flash"
import { dt, fromLocalInput, hm, isManagerRole, label, t, toLocalInput, today, tone } from "@/lib/ui"
import { explain, findClashes, describe } from "@/lib/shoots"

const here = (f: FormData) => String(f.get("back") || "/shoots")
const STATUS = ["planned", "confirmed", "completed", "cancelled"]
const window = (f: FormData) => {
  const a = fromLocalInput(f.get("starts")), b = fromLocalInput(f.get("ends"))
  if (!a || !b) throw new Error("Enter a start and an end time")
  if (+new Date(b) <= +new Date(a)) throw new Error("The end time must be after the start time")
  return [a, b] as const
}
const crew = (f: FormData) => {
  const cam = String(f.get("camera") || "") || null, asst = String(f.get("assistant") || "") || null
  if (cam && cam === asst) throw new Error("The camera operator and the assistant must be different people")
  return [cam, asst] as const
}

// Create: check for clashes first (no half-created shoot, no stray notifications). The database constraint is still the final guard.
async function create(f: FormData) {
  "use server"
  await run(here(f), "Shoot scheduled", async () => {
    const s = await sb(); const { data: { user } } = await s.auth.getUser()
    const title = t(f, "title"); if (!title || !f.get("client_id")) throw new Error("Pick a client and enter a title")
    const [a, b] = window(f), [cam, asst] = crew(f), eq = f.getAll("equipment").map(String)
    const hits = await findClashes(s, [cam, asst, ...eq], a, b); if (hits.length) throw new Error(describe(hits))
    const r = await s.from("shoots").insert({ client_id: f.get("client_id"), video_id: f.get("video_id") || null, title, location: t(f, "location"), starts_at: a, ends_at: b, camera_operator_id: cam, assistant_id: asst,
      shot_list: t(f, "shot_list"), references_text: t(f, "references_text"), instructions: t(f, "instructions"), created_by: user!.id }).select("id").single()
    if (r.error) throw await explain(s, r.error, [cam, asst, ...eq], a, b)
    for (const e of eq) {
      const x = await s.from("shoot_equipment").insert({ shoot_id: r.data.id, equipment_id: e })
      if (x.error) { await s.from("shoots").delete().eq("id", r.data.id); throw await explain(s, x.error, [cam, asst, ...eq], a, b) }   // race lost: undo the half-made shoot
    }
  })
}
// Update: attempt first; if the constraint fires, explain who clashes.
async function update(f: FormData) {
  "use server"
  await run(here(f), "Shoot updated", async () => {
    const s = await sb(); const id = String(f.get("id")), title = t(f, "title"); if (!title) throw new Error("Title is required")
    const [a, b] = window(f), [cam, asst] = crew(f)
    const eq = ((await s.from("shoot_equipment").select("equipment_id").eq("shoot_id", id)).data ?? []).map((x: any) => x.equipment_id)
    const r = await s.from("shoots").update({ title, location: t(f, "location"), video_id: f.get("video_id") || null, starts_at: a, ends_at: b, camera_operator_id: cam, assistant_id: asst,
      shot_list: t(f, "shot_list"), references_text: t(f, "references_text"), instructions: t(f, "instructions") }).eq("id", id).select("id")
    if (r.error) throw await explain(s, r.error, [cam, asst, ...eq], a, b, id)
    if (!r.data?.length) throw new Error("Not allowed: only managers or the camera operator can edit a shoot")
  })
}
async function setStatus(f: FormData) {
  "use server"
  const st = String(f.get("status")); if (!STATUS.includes(st)) back(here(f), "err", "Unknown status")
  await run(here(f), `Shoot ${st}`, async () => {
    const s = await sb(); const id = String(f.get("id"))
    const r = await s.from("shoots").update({ status: st }).eq("id", id).select("id,starts_at,ends_at,camera_operator_id,assistant_id")
    if (r.error) {            // re-opening a cancelled shoot can clash with something booked meanwhile
      const x = (await s.from("shoots").select("starts_at,ends_at,camera_operator_id,assistant_id").eq("id", id).single()).data
      const eq = ((await s.from("shoot_equipment").select("equipment_id").eq("shoot_id", id)).data ?? []).map((q: any) => q.equipment_id)
      throw x ? await explain(s, r.error, [x.camera_operator_id, x.assistant_id, ...eq], x.starts_at, x.ends_at, id) : new Error(r.error.message)
    }
    if (!r.data?.length) throw new Error("Not allowed")
  })
}
// Equipment: insert the new items first; if one clashes, remove what this call added so nothing is half-applied.
async function saveEquipment(f: FormData) {
  "use server"
  await run(here(f), "Equipment updated", async () => {
    const s = await sb(); const id = String(f.get("id")), want = f.getAll("equipment").map(String)
    const sh = must(await s.from("shoots").select("starts_at,ends_at,status").eq("id", id).single()) as any
    const have = ((must(await s.from("shoot_equipment").select("equipment_id").eq("shoot_id", id)) as any[]) ?? []).map(x => x.equipment_id)
    const add = want.filter(x => !have.includes(x)), del = have.filter((x: string) => !want.includes(x)), done: string[] = []
    if (add.length && ["planned", "confirmed"].includes(sh.status)) { const hits = await findClashes(s, add, sh.starts_at, sh.ends_at, id); if (hits.length) throw new Error(describe(hits)) }
    for (const e of add) {
      const x = await s.from("shoot_equipment").insert({ shoot_id: id, equipment_id: e })
      if (x.error) { if (done.length) await s.from("shoot_equipment").delete().eq("shoot_id", id).in("equipment_id", done); throw await explain(s, x.error, add, sh.starts_at, sh.ends_at, id) }
      done.push(e)
    }
    if (del.length) must(await s.from("shoot_equipment").delete().eq("shoot_id", id).in("equipment_id", del))
  })
}
async function respond(f: FormData) {
  "use server"
  await run(here(f), "Response saved", async () => {
    const s = await sb(); const { data: { user } } = await s.auth.getUser(); const v = String(f.get("response"))
    if (!["available", "unavailable"].includes(v)) throw new Error("Unknown response")
    must(await s.from("shoot_availability").upsert({ shoot_id: f.get("id"), user_id: user!.id, response: v, note: t(f, "note"), updated_at: new Date().toISOString() }, { onConflict: "shoot_id,user_id" }))
  })
}
async function addEquipment(f: FormData) {
  "use server"
  await run(here(f), "Equipment added", async () => { const s = await sb(); const n = t(f, "name"); if (!n) throw new Error("Enter a name"); must(await s.from("equipment").insert({ name: n, category: t(f, "category") })) })
}
async function toggleEquipment(f: FormData) {
  "use server"
  await run(here(f), "Equipment updated", async () => { const s = await sb(); must(await s.from("equipment").update({ is_active: f.get("active") === "1" }).eq("id", f.get("id"))) })
}
async function comment(f: FormData) {
  "use server"
  await run(here(f), "Comment added", async () => {
    const s = await sb(); const { data: { user } } = await s.auth.getUser(); const body = t(f, "body"); if (!body) throw new Error("Write a comment first")
    must(await s.from("comments").insert({ entity_type: "shoot", entity_id: f.get("id"), client_id: f.get("client_id"), author_id: user!.id, body, internal: true }))
  })
}

type SP = { view?: string; month?: string; client?: string; shoot?: string; fs?: string; fe?: string }
export default async function Shoots({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams; const view = sp.view === "list" ? "list" : "cal"; const s = await sb(); const { data: { user } } = await s.auth.getUser()
  const ym = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : today().slice(0, 7); const [y, m] = ym.split("-").map(Number)
  const qs = (o: Partial<SP>) => { const n = new URLSearchParams(Object.entries({ ...sp, ...o }).filter(([, v]) => v) as [string, string][]); return "/shoots" + (n.size ? "?" + n : "") }
  const shift = (d: number) => new Date(Date.UTC(y, m - 1 + d, 1)).toISOString().slice(0, 7)
  const from = `${ym}-01T00:00:00+05:30`, to = `${shift(1)}-01T00:00:00+05:30`
  const cols = "id,title,location,starts_at,ends_at,status,client_id,video_id,camera_operator_id,assistant_id,shot_list,references_text,instructions,reschedule_count,clients(business_name),cam:profiles!shoots_camera_operator_id_fkey(full_name),asst:profiles!shoots_assistant_id_fkey(full_name)"
  let q = s.from("shoots").select(cols).order("starts_at")
  q = view === "cal" ? q.gte("starts_at", from).lt("starts_at", to) : q.gte("starts_at", new Date(Date.now() - 86400e3).toISOString()).limit(200)
  if (sp.client) q = q.eq("client_id", sp.client)
  const [{ data: rows }, { data: clients }, { data: people }, { data: equip }, { data: me }, { data: vids }] = await Promise.all([q, s.from("clients").select("id,business_name").order("business_name"),
    s.from("profiles").select("id,full_name").eq("is_active", true).neq("role", "client").order("full_name"), s.from("equipment").select("id,name,category,is_active").order("name"),
    s.from("profiles").select("role").eq("id", user!.id).single(), s.from("videos").select("id,code,title,client_id").in("stage", ["idea_created", "research_completed", "script_writing", "script_review", "script_approved", "shoot_scheduled"]).order("code").limit(300)])
  const mgr = isManagerRole(me?.role); const sel = sp.shoot ? ((rows as any[]) ?? []).find(x => x.id === sp.shoot) ?? (await s.from("shoots").select(cols).eq("id", sp.shoot).maybeSingle()).data : null
  const [{ data: seq }, { data: av }, { data: cm }] = sel ? await Promise.all([s.from("shoot_equipment").select("equipment_id").eq("shoot_id", sel.id),
    s.from("shoot_availability").select("user_id,response,note,who:profiles!shoot_availability_user_id_fkey(full_name)").eq("shoot_id", sel.id),
    s.from("comments").select("id,body,who:profiles!comments_author_id_fkey(full_name)").eq("entity_type", "shoot").eq("entity_id", sel.id).order("created_at")]) : [{ data: null }, { data: null }, { data: null }]
  const canEdit = !!sel && (mgr || sel.camera_operator_id === user!.id); const mine = !!sel && (sel.camera_operator_id === user!.id || sel.assistant_id === user!.id)
  const mineResp = (av as any[] | null)?.find(a => a.user_id === user!.id)
  const Pick = (k: string, v: any) => <select name={k} defaultValue={v ?? ""} className="inp"><option value="">—</option>{people?.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select>
  const Vid = (v: any, cid?: string) => <select name="video_id" defaultValue={v ?? ""} className="inp"><option value="">No linked video</option>{vids?.filter((x: any) => !cid || x.client_id === cid || x.id === v).map((x: any) => <option key={x.id} value={x.id}>{x.code} · {x.title}</option>)}</select>
  const Eq = (have: string[]) => <div className="flex flex-wrap gap-3 text-sm">{equip?.filter(e => e.is_active || have.includes(e.id)).map(e => <label key={e.id} className="flex gap-1"><input type="checkbox" name="equipment" value={e.id} defaultChecked={have.includes(e.id)} />{e.name}</label>)}{!equip?.length && <span className="text-slate-400">No equipment yet — add some below.</span>}</div>
  const Time = (k: string, v: any) => <input type="datetime-local" name={k} required defaultValue={toLocalInput(v)} className="inp" />
  const chip = (x: any) => <Link key={x.id} href={qs({ shoot: x.id })} className={`block rounded px-1.5 py-0.5 text-[11px] leading-tight border bg-navy ${tone(x.status)} ${x.status === "cancelled" ? "line-through opacity-60" : ""} ${sp.shoot === x.id ? "ring-2 ring-blue-500" : ""}`}>{hm(x.starts_at)} {x.title}<span className="block text-slate-400 truncate">{x.clients?.business_name}</span></Link>

  // free / busy for a window
  let free: any = null
  if (sp.fs && sp.fe) { const a = fromLocalInput(sp.fs), b = fromLocalInput(sp.fe)
    if (a && b && +new Date(b) > +new Date(a)) { const ids = [...(people ?? []).map(p => p.id), ...(equip ?? []).filter(e => e.is_active).map(e => e.id)]; free = { hits: await findClashes(s, ids, a, b), a, b } } }

  // calendar grid (Monday first, IST)
  const first = new Date(Date.UTC(y, m - 1, 1)), lead = (first.getUTCDay() + 6) % 7, days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const byDay = new Map<string, any[]>(); ((rows as any[]) ?? []).forEach(r => { const k = toLocalInput(r.starts_at).slice(0, 10); byDay.set(k, [...(byDay.get(k) ?? []), r]) })
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)]; while (cells.length % 7) cells.push(null)
  const monthLabel = first.toLocaleString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })

  return <div className="space-y-6">
    <div className="flex justify-between flex-wrap gap-3"><h1 className="text-2xl font-bold">Shoots</h1>
      <div className="flex gap-2"><Link href={qs({ view: "cal" })} className={`btn2 text-sm ${view === "cal" ? "!bg-line" : ""}`}>Calendar</Link><Link href={qs({ view: "list" })} className={`btn2 text-sm ${view === "list" ? "!bg-line" : ""}`}>Upcoming list</Link></div></div>
    <div className="flex gap-3 flex-wrap items-start">
      <form className="flex gap-2"><input type="hidden" name="view" value={view} /><input type="hidden" name="month" value={ym} /><select name="client" defaultValue={sp.client ?? ""} className="inp !w-56"><option value="">All clients</option>{clients?.map(c => <option key={c.id} value={c.id}>{c.business_name}</option>)}</select><button className="btn2">Filter</button></form>
      <details className="bg-card border border-line rounded-xl p-3"><summary className="cursor-pointer text-sm font-semibold">Check who is free</summary>
        <form className="flex gap-2 pt-3 flex-wrap items-end"><input type="hidden" name="view" value={view} /><input type="hidden" name="month" value={ym} />
          <label className="text-xs text-slate-400">From<input type="datetime-local" name="fs" required defaultValue={sp.fs ?? ""} className="inp" /></label><label className="text-xs text-slate-400">To<input type="datetime-local" name="fe" required defaultValue={sp.fe ?? ""} className="inp" /></label><button className="btn2">Check</button></form></details>
      {mgr && <details className="bg-card border border-line rounded-xl p-3"><summary className="cursor-pointer text-sm font-semibold">+ Schedule shoot</summary>
        <form action={create} className="grid grid-cols-2 gap-3 pt-3 w-[34rem] max-w-full"><input type="hidden" name="back" value={qs({})} />
          <select name="client_id" required className="inp"><option value="">Client…</option>{clients?.map(c => <option key={c.id} value={c.id}>{c.business_name}</option>)}</select><input name="title" required placeholder="Shoot title" className="inp" />
          <label className="text-xs text-slate-400">Starts (IST){Time("starts", null)}</label><label className="text-xs text-slate-400">Ends (IST){Time("ends", null)}</label>
          <input name="location" placeholder="Location" className="inp" /><label className="text-xs text-slate-400 -mt-4 col-span-1">Linked video{Vid(null)}</label>
          <label className="text-xs text-slate-400">Camera operator{Pick("camera", null)}</label><label className="text-xs text-slate-400">Assistant{Pick("assistant", null)}</label>
          <div className="col-span-2"><div className="text-xs text-slate-400 mb-1">Equipment</div>{Eq([])}</div>
          <textarea name="shot_list" rows={2} placeholder="Shot list" className="inp col-span-2" /><textarea name="references_text" rows={2} placeholder="References" className="inp col-span-2" /><textarea name="instructions" rows={2} placeholder="Instructions" className="inp col-span-2" />
          <button className="btn col-span-2 w-fit">Schedule</button></form></details>}</div>

    {free && <div className="bg-card border border-line rounded-xl p-4 text-sm space-y-2"><b>Availability {dt(free.a)} – {dt(free.b)}</b>
      <div className="grid lg:grid-cols-2 gap-4"><div><div className="text-emerald-400 mb-1">Free</div>{[...(people ?? []).map(p => ({ id: p.id, n: p.full_name })), ...(equip ?? []).filter(e => e.is_active).map(e => ({ id: e.id, n: e.name + " (equipment)" }))].filter(x => !free.hits.some((h: any) => h.rid === x.id)).map(x => <div key={x.id}>{x.n}</div>)}</div>
        <div><div className="text-red-400 mb-1">Busy</div>{free.hits.map((h: any, i: number) => <div key={i}>{h.who} — {h.title ?? "another shoot"}{h.start && ` (${dt(h.start)}–${hm(h.end)})`}</div>)}{!free.hits.length && <div className="text-slate-400">Nobody is booked in this window.</div>}</div></div></div>}

    {sel && <div className="bg-card border border-line rounded-xl p-5 grid lg:grid-cols-[1fr_20rem] gap-6">
      <div className="space-y-3"><div className="flex justify-between"><div><span className="text-xs text-slate-400">{sel.clients?.business_name} · rescheduled {sel.reschedule_count}×</span><h2 className="text-lg font-bold">{sel.title}</h2><p className="text-sm text-slate-400">{dt(sel.starts_at)} – {hm(sel.ends_at)} IST{sel.location && ` · ${sel.location}`}</p></div>
        <div className="text-right space-y-1"><span className={`tag ${tone(sel.status)}`}>{label(sel.status)}</span><div><Link href={qs({ shoot: undefined })} className="text-xs underline text-slate-400">close</Link></div></div></div>
        {canEdit && <form action={setStatus} className="flex gap-2 flex-wrap"><input type="hidden" name="id" value={sel.id} /><input type="hidden" name="back" value={qs({})} />{STATUS.filter(x => x !== sel.status).map(x => <button key={x} name="status" value={x} className="btn2 text-xs">Mark {x}</button>)}</form>}
        {canEdit ? <form action={update} className="grid grid-cols-2 gap-3"><input type="hidden" name="id" value={sel.id} /><input type="hidden" name="back" value={qs({})} />
          <input name="title" required defaultValue={sel.title} className="inp" /><input name="location" defaultValue={sel.location ?? ""} placeholder="Location" className="inp" />
          <label className="text-xs text-slate-400">Starts (IST){Time("starts", sel.starts_at)}</label><label className="text-xs text-slate-400">Ends (IST){Time("ends", sel.ends_at)}</label>
          <label className="text-xs text-slate-400">Camera operator{Pick("camera", sel.camera_operator_id)}</label><label className="text-xs text-slate-400">Assistant{Pick("assistant", sel.assistant_id)}</label>
          <label className="text-xs text-slate-400 col-span-2">Linked video{Vid(sel.video_id, sel.client_id)}</label>
          <textarea name="shot_list" rows={3} defaultValue={sel.shot_list ?? ""} placeholder="Shot list" className="inp col-span-2" /><textarea name="references_text" rows={2} defaultValue={sel.references_text ?? ""} placeholder="References" className="inp col-span-2" /><textarea name="instructions" rows={2} defaultValue={sel.instructions ?? ""} placeholder="Instructions" className="inp col-span-2" />
          <button className="btn col-span-2 w-fit">Save shoot</button></form>
        : <dl className="text-sm space-y-2"><div><dt className="text-slate-400">Crew</dt><dd>{sel.cam?.full_name ?? "—"}{sel.asst?.full_name && ` + ${sel.asst.full_name}`}</dd></div>{([["Shot list", sel.shot_list], ["References", sel.references_text], ["Instructions", sel.instructions]] as [string, string][]).map(([l, v]) => v && <div key={l}><dt className="text-slate-400">{l}</dt><dd className="whitespace-pre-wrap">{v}</dd></div>)}</dl>}
        {mgr ? <form action={saveEquipment} className="border-t border-line pt-3 space-y-2"><b className="text-sm">Equipment</b><input type="hidden" name="id" value={sel.id} /><input type="hidden" name="back" value={qs({})} />{Eq((seq as any[] | null)?.map(x => x.equipment_id) ?? [])}<button className="btn2 text-sm">Save equipment</button></form>
          : <p className="text-sm border-t border-line pt-3"><span className="text-slate-400">Equipment: </span>{equip?.filter(e => (seq as any[] | null)?.some(x => x.equipment_id === e.id)).map(e => e.name).join(", ") || "—"}</p>}</div>
      <div className="space-y-4 text-sm"><div className="space-y-2"><b>Crew availability</b>
          {([[sel.camera_operator_id, sel.cam?.full_name, "Camera"], [sel.assistant_id, sel.asst?.full_name, "Assistant"]] as [string | null, string, string][]).filter(c => c[0]).map(([id, n, r]) => { const a = (av as any[] | null)?.find(x => x.user_id === id)
            return <div key={id!} className="border-t border-line pt-1">{n} <span className="text-slate-400">({r})</span>: {a ? <span className={`tag ${a.response === "available" ? tone("approved") : tone("rejected")}`}>{a.response}</span> : <span className="text-slate-400">no response</span>}{a?.note && <p className="text-slate-400">{a.note}</p>}</div> })}
          {mine && <form action={respond} className="space-y-2"><input type="hidden" name="id" value={sel.id} /><input type="hidden" name="back" value={qs({})} /><input name="note" defaultValue={mineResp?.note ?? ""} placeholder="Note (optional)" className="inp" />
            <div className="flex gap-2"><button name="response" value="available" className="btn !bg-emerald-600 !py-1 text-sm">I am available</button><button name="response" value="unavailable" className="btn !bg-red-600 !py-1 text-sm">I am not</button></div></form>}</div>
        <div className="space-y-2"><b>Internal comments</b>{(cm as any[] | null)?.map(c => <div key={c.id} className="border-t border-line pt-1"><span className="text-slate-400">{c.who?.full_name}:</span> {c.body}</div>)}
          <form action={comment} className="space-y-2"><input type="hidden" name="id" value={sel.id} /><input type="hidden" name="client_id" value={sel.client_id} /><input type="hidden" name="back" value={qs({})} /><textarea name="body" rows={2} className="inp" /><button className="btn2 text-sm">Comment</button></form></div></div></div>}

    {view === "cal" ? <div className="space-y-3"><div className="flex items-center gap-3"><Link href={qs({ month: shift(-1) })} className="underline text-sm">← Prev</Link><b>{monthLabel}</b><Link href={qs({ month: shift(1) })} className="underline text-sm">Next →</Link></div>
      <div className="grid grid-cols-7 gap-px bg-line border border-line rounded-xl overflow-hidden text-xs">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(d => <div key={d} className="bg-card p-2 text-slate-400">{d}</div>)}
        {cells.map((d, i) => { const k = d ? `${ym}-${String(d).padStart(2, "0")}` : ""; return <div key={i} className={`bg-navy min-h-24 p-1 space-y-1 ${k === today() ? "ring-1 ring-inset ring-blue-500" : ""}`}>{d && <div className="text-slate-400">{d}</div>}{(byDay.get(k) ?? []).map(chip)}</div> })}</div></div>
    : <table className="w-full text-left text-sm"><thead className="text-slate-400"><tr><th className="py-2">When (IST)</th><th>Shoot</th><th>Client</th><th>Crew</th><th>Status</th></tr></thead>
      <tbody>{(rows as any[] | null)?.map(r => <tr key={r.id} className="border-t border-line"><td className="py-2">{dt(r.starts_at)} – {hm(r.ends_at)}</td><td><Link href={qs({ shoot: r.id })} className="hover:underline">{r.title}</Link></td><td>{r.clients?.business_name}</td><td>{r.cam?.full_name ?? "—"}{r.asst?.full_name && ` + ${r.asst.full_name}`}</td><td><span className={`tag ${tone(r.status)}`}>{label(r.status)}</span></td></tr>)}
        {!rows?.length && <tr><td colSpan={5} className="py-8 text-center text-slate-400">No upcoming shoots.</td></tr>}</tbody></table>}

    {mgr && <details className="bg-card border border-line rounded-xl p-4"><summary className="cursor-pointer font-semibold text-sm">Equipment ({equip?.length ?? 0})</summary>
      <div className="pt-3 space-y-3"><form action={addEquipment} className="flex gap-2"><input type="hidden" name="back" value={qs({})} /><input name="name" required placeholder="Name (e.g. Sony FX3)" className="inp !w-64" /><input name="category" placeholder="Category" className="inp !w-40" /><button className="btn">Add</button></form>
        {equip?.map(e => <form key={e.id} action={toggleEquipment} className="flex gap-3 text-sm"><input type="hidden" name="id" value={e.id} /><input type="hidden" name="back" value={qs({})} /><span className={e.is_active ? "" : "line-through text-slate-500"}>{e.name}{e.category && ` · ${e.category}`}</span>
          <button name="active" value={e.is_active ? "0" : "1"} className="underline text-slate-400">{e.is_active ? "Retire" : "Restore"}</button></form>)}</div></details>}</div>
}
