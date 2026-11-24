
import { redirect } from "next/navigation"
import { sb } from "@/lib/supabase/server"
import Sidebar, { type NavItem } from "@/components/Sidebar"
import Flash from "@/components/Flash"

async function signOut() {
  "use server"
  const s = await sb()
  await s.auth.signOut()
  redirect("/login")
}

const NAV = (): Omit<NavItem, "badge">[] => [
  { name: "Dashboard", href: "/dashboard", icon: "▦" },
  { name: "Clients", href: "/clients", icon: "☰" },
  { name: "Content Studio", href: "/studio", icon: "✎" },
  { name: "Scripts", href: "/scripts", icon: "✍" },
  { name: "Projects", href: "/projects", icon: "❖" },
  { name: "Production", href: "/production", icon: "▶" },
  { name: "Shoots", href: "/shoots", icon: "◉" },
  { name: "Editing", href: "/editing", icon: "✂" },
  { name: "Publishing", href: "/publishing", icon: "▤" },
  { name: "Tasks", href: "/tasks", icon: "✔" },
  { name: "Notifications", href: "/notifications", icon: "🔔" },
]

export default async function L({
  children,
}: {
  children: React.ReactNode
}) {
  const s = await sb()

  // STEP 1: Check whether the server can read the logged-in user.
  const {
    data: { user },
    error: authError,
  } = await s.auth.getUser()

  if (!user) {
    return (
      <main className="min-h-screen p-8 space-y-4">
        <h1 className="text-2xl font-bold text-red-500">
          Authentication Diagnostic
        </h1>
        <p>The server cannot read your login session.</p>
        <pre className="whitespace-pre-wrap rounded-lg border p-4">
          {JSON.stringify(
            {
              authError: authError?.message ?? "No user returned",
              status: authError?.status ?? null,
            },
            null,
            2
          )}
        </pre>
        <a href="/login" className="underline">
          Back to login
        </a>
      </main>
    )
  }

  // STEP 2: Check whether the user's profile can be read.
  const {
    data: me,
    error: profileError,
  } = await s
    .from("profiles")
    .select("full_name, role")
    .eq("id", user.id)
    .single()

  if (profileError || !me) {
    return (
      <main className="min-h-screen p-8 space-y-4">
        <h1 className="text-2xl font-bold text-red-500">
          Profile Diagnostic
        </h1>
        <p>Your login session exists, but the profile could not be loaded.</p>
        <pre className="whitespace-pre-wrap rounded-lg border p-4">
          {JSON.stringify(
            {
              userId: user.id,
              email: user.email,
              profileError: profileError?.message ?? "No profile returned",
              profileErrorCode: profileError?.code ?? null,
            },
            null,
            2
          )}
        </pre>
      </main>
    )
  }

  // STEP 3: Continue with the normal dashboard layout.
  if (me.role === "client") {
    redirect("/portal")
  }

  const {
    count,
    error: notificationError,
  } = await s
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .is("read_at", null)

  const nav = NAV()

  if (me.role === "admin") {
    const taskIndex = nav.findIndex((item) => item.href === "/tasks")
    nav.splice(taskIndex + 1, 0, {
      name: "Finance",
      href: "/finance",
      icon: "₹",
    })
  }

  const items = nav.map((item) =>
    item.href === "/notifications"
      ? { ...item, badge: count ?? 0 }
      : item
  )

  return (
    <div className="flex min-h-screen">
      <Sidebar
        items={items}
        who={`${me.full_name} · ${me.role}`}
        signOut={signOut}
      />
      <main className="flex-1 min-w-0 p-8">
        <Flash />
        {notificationError && (
          <p className="text-sm text-amber-500">
            Notifications could not be loaded: {notificationError.message}
          </p>
        )}
        {children}
      </main>
    </div>
  )
}
