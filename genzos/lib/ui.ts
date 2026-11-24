export const STAGES = ["idea_created", "research_completed", "script_writing", "script_review", "script_approved", "shoot_scheduled", "shoot_completed", "footage_uploaded", "editing", "internal_review", "client_review", "revision_required", "approved", "scheduled_for_posting", "published"] as const
export const label = (s: string | null | undefined) => (s ?? "").replace(/_/g, " ").replace(/^./, c => c.toUpperCase())
export const SCRIPT_STATUSES = ["draft", "in_review", "changes_requested", "approved", "client_review", "client_approved"] as const
export const PLATFORMS = ["instagram", "youtube", "facebook", "linkedin"] as const
export const LANGS = ["english", "hindi", "hinglish", "marathi", "gujarati", "tamil", "telugu", "other"] as const
export const TONES = ["conversational", "professional", "funny", "emotional", "inspirational", "urgent"] as const
export const fmt = (d: string | null | undefined) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" }) : "—"
export const t = (f: FormData, k: string) => String(f.get(k) ?? "").trim() || null
export const isManagerRole = (r?: string | null) => r === "admin" || r === "project_manager"
export const tone = (s: string) =>
  /approved|published|completed/.test(s) ? "text-emerald-400 border-emerald-800"
  : /revision|changes|rejected/.test(s) ? "text-red-400 border-red-900"
  : /review|scheduled/.test(s) ? "text-amber-400 border-amber-800" : "text-slate-400"
// ---- India time. The server runs in UTC, so every date the user types or reads is converted explicitly. ----
const IST_MS = 5.5 * 3600e3
export const today = () => new Date(Date.now() + IST_MS).toISOString().slice(0, 10)
/** timestamptz -> value for <input type="datetime-local"> in IST */
export const toLocalInput = (ts?: string | null) => ts ? new Date(new Date(ts).getTime() + IST_MS).toISOString().slice(0, 16) : ""
/** <input type="datetime-local"> (typed in IST) -> ISO string, or null if empty/invalid */
export const fromLocalInput = (v: FormDataEntryValue | null): string | null => { const x = String(v ?? ""); return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(x) ? new Date(x + ":00+05:30").toISOString() : null }
export const dt = (ts: string | null | undefined) => ts ? new Date(ts).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }) : "—"
export const hm = (ts: string) => new Date(ts).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" })
export const day = (f: FormData, k: string) => { const v = String(f.get(k) ?? ""); return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null }
export const url = (v: FormDataEntryValue | null) => { try { const u = new URL(String(v)); return /^https?:$/.test(u.protocol) ? u.toString() : null } catch { return null } }
