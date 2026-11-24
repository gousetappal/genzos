"use client"
import { createBrowserClient } from "@supabase/ssr"
import { useState } from "react"
export default function Reset() {
  const [pw, setP] = useState(""), [pw2, setP2] = useState(""), [err, setErr] = useState(""), [busy, setB] = useState(false)
  async function go(e: React.FormEvent) {
    e.preventDefault(); setErr("")
    if (pw.length < 8) return setErr("Use at least 8 characters")
    if (pw !== pw2) return setErr("Passwords do not match")
    setB(true)
    const s = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
    const { error } = await s.auth.updateUser({ password: pw })
    if (error) { setErr(error.message); setB(false) } else location.href = "/dashboard"
  }
  return <main className="min-h-screen grid place-items-center"><form onSubmit={go} className="bg-card border border-line rounded-2xl p-8 w-96 space-y-4">
    <h1 className="text-xl font-bold">Choose a new password</h1>
    <input className="inp" type="password" placeholder="New password" value={pw} onChange={e => setP(e.target.value)} required />
    <input className="inp" type="password" placeholder="Repeat password" value={pw2} onChange={e => setP2(e.target.value)} required />
    {err && <p className="text-red-400 text-sm">{err}</p>}
    <button className="btn w-full" disabled={busy}>{busy ? "Saving…" : "Save password"}</button></form></main>
}
