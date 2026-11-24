import { revalidatePath } from "next/cache"
import { sb } from "@/lib/supabase/server"
async function add(f: FormData) {
  "use server"
  const s = await sb(); const { data: { user } } = await s.auth.getUser()
  const { error } = await s.from("tasks").insert({ title: f.get("title"), priority: f.get("priority"), due_date: f.get("due") || null, assignee_id: f.get("assignee") || user!.id, created_by: user!.id })
  if (error) throw new Error(error.message); revalidatePath("/tasks")
}
async function setStatus(f: FormData) {
  "use server"
  const s = await sb(); const st = String(f.get("status"))
  const { error } = await s.from("tasks").update({ status: st, completed_at: st === "done" ? new Date().toISOString() : null }).eq("id", f.get("id"))
  if (error) throw new Error(error.message); revalidatePath("/tasks")
}
export default async function T() {
  const s = await sb()
  const [{ data: tasks }, { data: people }] = await Promise.all([
    s.from("tasks").select("id,title,priority,status,due_date,assignee:profiles!tasks_assignee_id_fkey(full_name)").order("due_date", { nullsFirst: false }).limit(100),
    s.from("profiles").select("id,full_name").eq("is_active", true)])
  const late = (t: any) => t.due_date && new Date(t.due_date) < new Date() && !["done", "approved"].includes(t.status)
  return <div className="space-y-6"><h1 className="text-2xl font-bold">Tasks</h1>
    <form action={add} className="bg-card border border-line rounded-xl p-4 grid grid-cols-2 lg:grid-cols-5 gap-3">
      <input name="title" required placeholder="Task title" className="inp lg:col-span-2" />
      <select name="priority" defaultValue="medium" className="inp">{["low", "medium", "high", "urgent"].map(x => <option key={x}>{x}</option>)}</select>
      <input name="due" type="datetime-local" className="inp" />
      <select name="assignee" className="inp"><option value="">Me</option>{people?.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select>
      <button className="btn">Create task</button></form>
    <table className="w-full text-left"><thead className="text-slate-400 text-sm"><tr><th className="py-2">Task</th><th>Assignee</th><th>Priority</th><th>Due</th><th>Status</th></tr></thead>
      <tbody>{tasks?.map((t: any) => <tr key={t.id} className="border-t border-line"><td className="py-2">{t.title}</td><td>{t.assignee?.full_name}</td><td>{t.priority}</td>
        <td className={late(t) ? "text-red-400" : ""}>{t.due_date ? new Date(t.due_date).toLocaleString("en-IN") : "—"}{late(t) && " (overdue)"}</td>
        <td><form action={setStatus} className="flex gap-1"><input type="hidden" name="id" value={t.id} />
          <select name="status" defaultValue={t.status} className="inp !w-auto">{["todo", "in_progress", "review", "done", "approved"].map(x => <option key={x}>{x}</option>)}</select><button className="text-xs underline">Save</button></form></td></tr>)}
        {!tasks?.length && <tr><td colSpan={5} className="py-8 text-center text-slate-400">No tasks yet.</td></tr>}</tbody></table></div>
}
