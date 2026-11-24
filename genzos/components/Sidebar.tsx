"use client"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"
export type NavItem = { name: string; href: string; icon: string; badge?: number }
export default function Sidebar({ items, who, signOut }: { items: NavItem[]; who: string; signOut: () => Promise<void> }) {
  const path = usePathname()
  const [mini, setMini] = useState(false), [light, setLight] = useState(false)
  useEffect(() => { try { setMini(localStorage.getItem("nav") === "mini"); setLight(localStorage.getItem("theme") === "light") } catch {} }, [])
  const toggleNav = () => { const n = !mini; setMini(n); try { localStorage.setItem("nav", n ? "mini" : "full") } catch {} }
  const toggleTheme = () => {
    const n = !light; setLight(n); document.documentElement.classList.toggle("dark", !n)
    try { localStorage.setItem("theme", n ? "light" : "dark") } catch {}
  }
  return <aside className={`${mini ? "w-16" : "w-56"} shrink-0 bg-card border-r border-line p-3 flex flex-col gap-1 transition-all sticky top-0 h-screen overflow-y-auto`}>
    <div className="flex items-center justify-between mb-3 px-1">
      {!mini && <span className="font-bold text-sm">GENZ FILMS OS</span>}
      <button onClick={toggleNav} aria-label="Collapse sidebar" className="btn2 !px-2 !py-1">{mini ? "»" : "«"}</button></div>
    {items.map(i => { const on = path === i.href || path.startsWith(i.href + "/")
      return <Link key={i.href} href={i.href} title={i.name} className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm hover:bg-line ${on ? "bg-line font-semibold" : ""}`}>
        <span className="w-5 text-center">{i.icon}</span>{!mini && <span className="flex-1">{i.name}</span>}
        {!!i.badge && <span className="bg-blue-500 text-white text-[10px] rounded-full px-1.5">{i.badge}</span>}</Link> })}
    <div className="mt-auto pt-4 space-y-2">
      <button onClick={toggleTheme} className="btn2 w-full text-xs">{mini ? (light ? "☾" : "☀") : light ? "Dark mode" : "Light mode"}</button>
      {!mini && <div className="text-xs text-slate-400 px-1 truncate">{who}</div>}
      <form action={signOut}><button className="btn2 w-full text-xs">{mini ? "⎋" : "Sign out"}</button></form></div></aside>
}
