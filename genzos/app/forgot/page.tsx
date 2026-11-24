"use client"
import { createBrowserClient } from "@supabase/ssr"
import Link from "next/link"
import { useState } from "react"
export default function Forgot() {
  const [email, setE] = useState(""), [done, setD] = useState(false), [err, setErr] = useState(""), [busy, setB] = useState(false)
  async function go(e: React.FormEvent) {
    e.preventDefault(); setB(true); setErr("")
    const s = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
    const { error } = await s.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/auth/callback?next=/reset` })
    setB(false); if (error) setErr(error.message); else setD(true)
  }
  return <main className="min-h-screen grid place-items-center"><form onSubmit={go} className="bg-card border border-line rounded-2xl p-8 w-96 space-y-4">
    <h1 className="text-xl font-bold">Reset password</h1>
    {done ? <p className="text-sm text-emerald-400">If that email has an account, a reset link is on its way.</p> : <>
      <input className="inp" type="email" placeholder="Your email" value={email} onChange={e => setE(e.target.value)} required />
      {err && <p className="text-red-400 text-sm">{err}</p>}
      <button className="btn w-full" disabled={busy}>{busy ? "Sending…" : "Send reset link"}</button></>}
    <Link href="/login" className="block text-sm text-slate-400 underline">Back to sign in</Link></form></main>
}
