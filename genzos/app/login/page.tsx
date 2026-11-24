"use client"

import { useEffect, useState } from "react"
import { sbBrowser } from "@/lib/supabase/client"

export default function Login() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [errorMessage, setErrorMessage] = useState("")
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const errorCode = new URLSearchParams(window.location.search).get("err")
    if (errorCode === "config") {
      setErrorMessage("The website's Supabase environment variables are missing. Check the Vercel project settings.")
    } else if (errorCode) {
      setErrorMessage(errorCode)
    }
  }, [])

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setErrorMessage("")

    try {
      const supabase = sbBrowser()
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })

      if (error) throw error
      // Confirm the browser client can read the newly stored session before navigating.
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
      if (sessionError) throw sessionError
      if (!sessionData.session) {
        throw new Error("Login succeeded, but the browser session was not saved. Check browser cookie settings and the Supabase site URL configuration.")
      }

      window.location.replace("/dashboard")
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to sign in. Please try again.")
      setBusy(false)
    }
  }

  return (
    <main className="min-h-screen grid place-items-center">
      <form onSubmit={handleLogin} className="bg-card border border-line rounded-2xl p-8 w-96 space-y-4">
        <h1 className="text-xl font-bold">GENZ FILMS OS</h1>
        <p className="text-sm text-slate-400">Creative Storytelling. Strategic Content. Business Growth.</p>
        <input className="inp" type="email" placeholder="Email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" />
        <input className="inp" type="password" placeholder="Password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="current-password" />
        {errorMessage && <p role="alert" className="text-red-400 text-sm">{errorMessage}</p>}
        <button className="btn w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        <a href="/forgot" className="block text-sm text-slate-400 underline">Forgot password?</a>
      </form>
    </main>
  )
}
