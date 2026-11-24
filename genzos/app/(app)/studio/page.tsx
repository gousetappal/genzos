import { sb } from "@/lib/supabase/server"
import { back, must, run } from "@/lib/flash"
import { PLATFORMS, label, t, tone } from "@/lib/ui"
import { revalidatePath } from "next/cache"

async function addIdea(f: FormData) {
  "use server"
  await run("/studio", "Idea added", async () => {
    const s = await sb(); const { data: { user } } = await s.auth.getUser()
    const title = t(f, "title"); if (!title || !f.get("client_id")) throw new Error("Pick a client and enter a title")
    must(await s.from("content_ideas").insert({ client_id: f.get("client_id"), title, category: t(f, "category"), objective: t(f, "objective"), platform: f.get("platform"), notes: t(f, "notes"), created_by: user!.id }))
  })
}
async function setIdea(f: FormData) {
  "use server"
  await run("/studio", "Idea updated", async () => {
    const s = await sb(); must(await s.from("content_ideas").update({ status: f.get("status") }).eq("id", f.get("id")))
  })
}
// idea -> video (pipeline stage "script writing") + draft script, in one step
async function startProduction(f: FormData) {
  "use server"
  await run("/studio", "", async () => {
    const s = await sb(); const { data: { user } } = await s.auth.getUser()
    const idea = must(await s.from("content_ideas").select("*").eq("id", f.get("id")).single()) as any
    if (idea.status !== "idea") throw new Error("This idea has already been used")
    const v = must(await s.from("videos").insert({ client_id: idea.client_id, title: idea.title, content_category: idea.category, status: "planned", stage: "script_writing", scriptwriter_id: user!.id, created_by: user!.id }).select("id").single()) as any
    const sc = must(await s.from("scripts").insert({ client_id: idea.client_id, video_id: v.id, idea_id: idea.id, title: idea.title, category: idea.category, objective: idea.objective, platform: idea.platform, scriptwriter_id: user!.id, created_by: user!.id }).select("id").single()) as any
    must(await s.from("content_ideas").update({ status: "scripted" }).eq("id", idea.id))
    revalidatePath("/production"); back(`/scripts/${sc.id}`, "ok", "Script created and video added to the pipeline")
  })
}

export default async function Studio({ searchParams }: { searchParams: Promise<{ client?: string; status?: string }> }) {
  const { client, status = "idea" } = await searchParams; const s = await sb()
  let q = s.from("content_ideas").select("id,title,category,objective,platform,notes,status,created_at,clients(business_name)").eq("status", status).order("created_at", { ascending: false }).limit(200)
  if (client) q = q.eq("client_id", client)
  const [{ data: ideas }, { data: clients }] = await Promise.all([q, s.from("clients").select("id,business_name").order("business_name")])
  return <div className="space-y-6"><h1 className="text-2xl font-bold">Content Studio</h1>
    <p className="text-sm text-slate-400">Collect ideas per client. Starting production creates a draft script and a video in the pipeline.</p>
    <form action={addIdea} className="bg-card border border-line rounded-xl p-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
      <select name="client_id" required className="inp"><option value="">Client…</option>{clients?.map(c => <option key={c.id} value={c.id}>{c.business_name}</option>)}</select>
      <input name="title" required placeholder="Idea / video title" className="inp lg:col-span-2" />
      <input name="category" placeholder="Category (e.g. Product story)" className="inp" />
      <input name="objective" placeholder="Objective (e.g. more enquiries)" className="inp lg:col-span-2" />
      <select name="platform" className="inp">{PLATFORMS.map(p => <option key={p}>{p}</option>)}</select>
      <button className="btn">Add idea</button>
      <textarea name="notes" placeholder="Notes, references, hook thoughts" className="inp col-span-2 lg:col-span-4" rows={2} /></form>
    <form className="flex gap-3"><select name="client" defaultValue={client ?? ""} className="inp !w-56"><option value="">All clients</option>{clients?.map(c => <option key={c.id} value={c.id}>{c.business_name}</option>)}</select>
      <select name="status" defaultValue={status} className="inp !w-40">{["idea", "scripted", "rejected"].map(x => <option key={x} value={x}>{label(x)}</option>)}</select><button className="btn2">Filter</button></form>
    <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">{ideas?.map((i: any) => <div key={i.id} className="bg-card border border-line rounded-xl p-4 space-y-2">
      <div className="flex justify-between gap-2"><b>{i.title}</b><span className={`tag ${tone(i.status)}`}>{i.platform}</span></div>
      <div className="text-xs text-slate-400">{i.clients?.business_name}{i.category ? ` · ${i.category}` : ""}</div>
      {i.objective && <p className="text-sm">Objective: {i.objective}</p>}{i.notes && <p className="text-sm text-slate-400 whitespace-pre-wrap">{i.notes}</p>}
      {i.status === "idea" && <div className="flex gap-2 pt-1">
        <form action={startProduction}><input type="hidden" name="id" value={i.id} /><button className="btn !py-1 text-sm">Start production</button></form>
        <form action={setIdea}><input type="hidden" name="id" value={i.id} /><input type="hidden" name="status" value="rejected" /><button className="btn2 text-sm">Reject</button></form></div>}
      {i.status === "rejected" && <form action={setIdea}><input type="hidden" name="id" value={i.id} /><input type="hidden" name="status" value="idea" /><button className="btn2 text-sm">Restore</button></form>}</div>)}
      {!ideas?.length && <p className="text-slate-400">No {status} ideas{client ? " for this client" : ""}.</p>}</div></div>
}
