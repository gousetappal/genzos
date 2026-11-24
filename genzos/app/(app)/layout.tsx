import { redirect } from "next/navigation"
import { sb } from "@/lib/supabase/server"
import Sidebar, { type NavItem } from "@/components/Sidebar"
import Flash from "@/components/Flash"
async function signOut() { "use server"; const s = await sb(); await s.auth.signOut(); redirect("/login") }
// Menu visibility is only convenience: every page and action is still protected by RLS and triggers in the database.
const NAV = (): Omit<NavItem, "badge">[] => [
  { name: "Dashboard", href: "/dashboard", icon: "▦" }, { name: "Clients", href: "/clients", icon: "☰" },
  { name: "Content Studio", href: "/studio", icon: "✎" }, { name: "Scripts", href: "/scripts", icon: "✍" },
  { name: "Projects", href: "/projects", icon: "❖" }, { name: "Production", href: "/production", icon: "▶" },
  { name: "Shoots", href: "/shoots", icon: "◉" }, { name: "Editing", href: "/editing", icon: "✂" }, { name: "Publishing", href: "/publishing", icon: "▤" },
  { name: "Tasks", href: "/tasks", icon: "✔" },
  { name: "Notifications", href: "/notifications", icon: "🔔" }]
export default async function L({ children }: { children: React.ReactNode }) {
  const s = await sb(); const { data: { user } } = await s.auth.getUser()
  if (!user) redirect("/login")
  const { data: me } = await s.from("profiles").select("full_name,role").eq("id", user.id).single()
  if (!me) redirect("/login")
  if (me.role === "client") redirect("/portal")
  const { count } = await s.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", user.id).is("read_at", null)
  const nav = NAV(); if (me.role === "admin") nav.splice(nav.findIndex(i => i.href === "/tasks") + 1, 0, { name: "Finance", href: "/finance", icon: "₹" })
  const items = nav.map(i => i.href === "/notifications" ? { ...i, badge: count ?? 0 } : i)
  return <div className="flex min-h-screen"><Sidebar items={items} who={`${me.full_name} · ${me.role}`} signOut={signOut} />
    <main className="flex-1 min-w-0 p-8"><Flash />{children}</main></div>
}
