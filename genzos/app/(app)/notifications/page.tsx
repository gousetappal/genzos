import Link from "next/link"
import { sb } from "@/lib/supabase/server"
import { must, run } from "@/lib/flash"
async function markRead(f: FormData) {
  "use server"
  await run("/notifications", "Marked as read", async () => {
    const s = await sb(); const { data: { user } } = await s.auth.getUser(); const id = f.get("id")
    let q = s.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", user!.id).is("read_at", null)
    if (id) q = q.eq("id", id)
    must(await q)
  })
}
export default async function N() {
  const s = await sb(); const { data } = await s.from("notifications").select("id,title,body,link,read_at,created_at").order("created_at", { ascending: false }).limit(100)
  return <div className="space-y-4 max-w-3xl"><div className="flex justify-between"><h1 className="text-2xl font-bold">Notifications</h1>
    <form action={markRead}><button className="btn2 text-sm">Mark all read</button></form></div>
    {data?.map(n => <div key={n.id} className={`bg-card border border-line rounded-xl p-3 flex justify-between gap-3 ${n.read_at ? "opacity-60" : ""}`}>
      <div>{n.link ? <Link href={n.link} className="font-semibold hover:underline">{n.title}</Link> : <b>{n.title}</b>}
        {n.body && <p className="text-sm text-slate-400">{n.body}</p>}<p className="text-xs text-slate-500">{new Date(n.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</p></div>
      {!n.read_at && <form action={markRead}><input type="hidden" name="id" value={n.id} /><button className="text-xs underline">Read</button></form>}</div>)}
    {!data?.length && <p className="text-slate-400">Nothing yet.</p>}</div>
}
