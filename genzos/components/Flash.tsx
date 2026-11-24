"use client"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { Suspense, useEffect } from "react"
function Inner() {
  const sp = useSearchParams(), path = usePathname(), r = useRouter()
  const ok = sp.get("ok"), err = sp.get("err")
  useEffect(() => {
    if (!ok && !err) return
    const id = setTimeout(() => { const n = new URLSearchParams(sp.toString()); n.delete("ok"); n.delete("err"); r.replace(path + (n.size ? "?" + n : "")) }, err ? 9000 : 4000)
    return () => clearTimeout(id)
  }, [ok, err, sp, path, r])
  if (!ok && !err) return null
  return <div role="status" className={`mb-4 rounded-lg p-3 text-sm border ${err ? "bg-red-950/60 border-red-900 text-red-300" : "bg-emerald-950/60 border-emerald-900 text-emerald-300"}`}>{err ?? ok}</div>
}
export default function Flash() { return <Suspense><Inner /></Suspense> }
