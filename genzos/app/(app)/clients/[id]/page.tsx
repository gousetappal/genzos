import Link from 'next/link'
import { notFound } from 'next/navigation'
import { sb } from '@/lib/supabase/server'
import { back, must, run } from '@/lib/flash'
import { STAGES, fmt, label, tone } from '@/lib/ui'
import { SECTIONS, COMP_FIELDS, COMING, LINKED, type F } from '@/lib/research'

// Every form carries a hidden "back" path so the user lands on the same tab with a green/red banner.
const here = (f: FormData) => String(f.get('back') || `/clients/${f.get('client_id')}`)
const clean = (f: FormData, fields: F[]) => { const r: Record<string, any> = {}; for (const [k, , num] of fields) { const v = String(f.get(k) ?? '').trim(); r[k] = num ? (v === '' ? null : Math.max(0, Number(v))) : (v || null) } return r }
const url = (v: FormDataEntryValue | null) => { try { const u = new URL(String(v)); return /^https?:$/.test(u.protocol) ? u.toString() : null } catch { return null } }
const tx = (f: FormData, k: string) => String(f.get(k) ?? '').trim() || null

async function save(f: FormData) {
  'use server'
  await run(here(f), 'Saved', async () => {
    const sec = SECTIONS.find(x => x.table === f.get('table')); if (!sec) throw new Error('Invalid section')
    const s = await sb(); const { data: { user } } = await s.auth.getUser()
    must(await s.from(sec.table).upsert({ client_id: String(f.get('client_id')), ...clean(f, sec.fields), updated_by: user!.id, updated_at: new Date().toISOString() }, { onConflict: 'client_id' }))
  })
}
async function addComp(f: FormData) {
  'use server'
  await run(here(f), 'Competitor added', async () => {
    const s = await sb(); const { data: { user } } = await s.auth.getUser()
    const c = clean(f, COMP_FIELDS); if (!c.name) throw new Error('Competitor name is required')
    must(await s.from('competitors').insert({ client_id: String(f.get('client_id')), ...c, created_by: user!.id }))
  })
}
async function delComp(f: FormData) {
  'use server'
  await run(here(f), 'Competitor deleted', async () => { const s = await sb(); must(await s.from('competitors').delete().eq('id', f.get('id'))) })
}
async function assign(f: FormData) {
  'use server'
  const rm = !!f.get('remove')
  await run(here(f), rm ? 'Removed from client' : 'Assigned', async () => {
    const s = await sb(); const cid = String(f.get('client_id'))
    must(rm ? await s.from('client_assignments').delete().eq('client_id', cid).eq('employee_id', f.get('employee_id'))
      : await s.from('client_assignments').upsert({ client_id: cid, employee_id: f.get('employee_id') }))
  })
}
async function saveFin(f: FormData) {
  'use server'
  await run(here(f), 'Finance details saved', async () => {
    const s = await sb()
    must(await s.from('client_finance').upsert({ client_id: String(f.get('client_id')), monthly_package_amount: Math.max(0, Number(f.get('amount') || 0)), gstin: tx(f, 'gstin'), billing_address: tx(f, 'billing'), updated_at: new Date().toISOString() }))
  })
}
async function updateClient(f: FormData) {
  'use server'
  await run(here(f), 'Client updated', async () => {
    const s = await sb(); const cm = Number(f.get('contract_months')); const name = tx(f, 'business_name'); if (!name) throw new Error('Business name is required')
    const r = must(await s.from('clients').update({ business_name: name, category: tx(f, 'category'), owner_name: tx(f, 'owner_name'), phone: tx(f, 'phone'), email: tx(f, 'email'), location: tx(f, 'location'), instagram_url: tx(f, 'instagram_url'), website: tx(f, 'website'), description: tx(f, 'description'), internal_notes: tx(f, 'internal_notes'), start_date: tx(f, 'start_date'), status: f.get('status'), monthly_deliverables: Math.max(0, Number(f.get('monthly_deliverables') || 0)), contract_months: cm > 0 ? cm : null, updated_at: new Date().toISOString() }).eq('id', String(f.get('client_id'))).select('id')) as any[]
    if (!r.length) throw new Error('Not allowed: only admins can edit client details')
  })
}
async function deleteClient(f: FormData) {
  'use server'
  await run(here(f), '', async () => {
    if (f.get('confirm') !== 'on') throw new Error('Tick the confirmation box first')
    const s = await sb(); const r = must(await s.from('clients').delete().eq('id', f.get('client_id')).select('id')) as any[]
    if (!r.length) throw new Error('Not allowed: only admins can delete clients')
    back('/clients', 'ok', 'Client deleted')
  })
}
async function addVideo(f: FormData) {
  'use server'
  await run(here(f), 'Published video added', async () => {
    const link = url(f.get('url')), title = tx(f, 'title'), day = String(f.get('date') ?? '')
    if (!title || !link || !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Title, a valid http(s) link and a date are required')
    const s = await sb(); const { data: { user } } = await s.auth.getUser()
    const r = await s.from('videos').insert({ client_id: String(f.get('client_id')), title, status: 'published', published_url: link, published_on: day, created_by: user!.id })
    if (r.error) throw new Error(r.error.code === '23505' ? 'That link is already counted for this client' : r.error.message)
  })
}
async function delVideo(f: FormData) {
  'use server'
  await run(here(f), 'Video removed', async () => {
    const s = await sb(); const r = must(await s.from('videos').delete().eq('id', f.get('id')).select('id')) as any[]
    if (!r.length) throw new Error('Not allowed: only admins or project managers can remove videos')
  })
}
async function newScript(f: FormData) {
  'use server'
  await run(here(f), '', async () => {
    const s = await sb(); const { data: { user } } = await s.auth.getUser(); const title = tx(f, 'title'); if (!title) throw new Error('Enter a script title')
    const r = must(await s.from('scripts').insert({ client_id: String(f.get('client_id')), title, scriptwriter_id: user!.id, created_by: user!.id }).select('id').single()) as any
    back(`/scripts/${r.id}`, 'ok', 'Script created')
  })
}
async function newVideo(f: FormData) {
  'use server'
  await run(here(f), 'Video added to the pipeline', async () => {
    const s = await sb(); const { data: { user } } = await s.auth.getUser(); const title = tx(f, 'title'); if (!title) throw new Error('Enter a video title')
    must(await s.from('videos').insert({ client_id: String(f.get('client_id')), title, status: 'planned', stage: 'idea_created', created_by: user!.id }))
  })
}

const Fields = ({ fields, row }: { fields: F[]; row?: any }) => <div className="grid lg:grid-cols-2 gap-3">{fields.map(([k, l, num]) =>
  <label key={k} className="text-sm text-slate-400">{l}{num ? <input name={k} type="number" min="0" defaultValue={row?.[k] ?? ''} className="inp mt-1" /> : <textarea name={k} rows={2} defaultValue={row?.[k] ?? ''} className="inp mt-1" />}</label>)}</div>

export default async function Profile({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; month?: string }> }) {
  const { id } = await params; const { tab = 'overview', month } = await searchParams; const s = await sb()
  const self = `/clients/${id}?tab=${tab}${tab === 'deliverables' && month ? `&month=${month}` : ''}`
  const { data: c } = await s.from('clients').select('*').eq('id', id).maybeSingle(); if (!c) notFound()
  const { data: { user } } = await s.auth.getUser()
  const { data: me } = await s.from('profiles').select('role').eq('id', user!.id).single(); const admin = me?.role === 'admin'
  const tabs = [['overview', 'Overview'], ['research', 'Business Research'], ['competitors', 'Competitor Analysis'], ['strategy', 'Content Strategy'], ['scripts', 'Scripts'], ['pipeline', 'Pipeline'], ['deliverables', 'Deliverables'], ...(admin ? [['finance', 'Financial Information']] : [])]
  let body: React.ReactNode = null
  if (tab === 'overview') {
    const [{ data: asg }, { data: staff }] = await Promise.all([s.from('client_assignments').select('employee_id, p:profiles(full_name)').eq('client_id', id), s.from('profiles').select('id,full_name').in('role', ['employee', 'project_manager']).eq('is_active', true)])
    const info: [string, any][] = [['Owner', c.owner_name], ['Category', c.category], ['Phone', c.phone], ['Email', c.email], ['Location', c.location], ['Instagram', c.instagram_url], ['Website', c.website], ['Videos / month', c.monthly_deliverables], ['Status', c.status]]
    body = <div className="space-y-6"><div className="grid lg:grid-cols-3 gap-3">{info.map(([l, v]) => <div key={l} className="bg-card border border-line rounded-xl p-4"><div className="text-xs text-slate-400">{l}</div><div>{v || '—'}</div></div>)}</div>
      <div className="bg-card border border-line rounded-xl p-4 space-y-3"><h3 className="font-semibold">Assigned team</h3>
        {asg?.map((a: any) => <form key={a.employee_id} action={assign} className="flex gap-3 text-sm"><input type="hidden" name="client_id" value={id} /><input type="hidden" name="back" value={self} /><input type="hidden" name="employee_id" value={a.employee_id} /><input type="hidden" name="remove" value="1" />{a.p?.full_name}{admin && <button className="text-red-400 underline">Remove</button>}</form>)}
        {!asg?.length && <p className="text-sm text-slate-400">No one assigned yet. Employees only see clients they are assigned to.</p>}
        {admin && <form action={assign} className="flex gap-2"><input type="hidden" name="client_id" value={id} /><input type="hidden" name="back" value={self} /><select name="employee_id" className="inp max-w-xs">{staff?.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select><button className="btn">Assign</button></form>}</div>
      {admin && <form action={updateClient} className="bg-card border border-line rounded-xl p-5 space-y-3"><h3 className="font-semibold">Edit client details</h3><input type="hidden" name="client_id" value={id} /><input type="hidden" name="back" value={self} />
        <div className="grid lg:grid-cols-3 gap-3">{([['business_name', 'Business name'], ['category', 'Category'], ['owner_name', 'Owner'], ['phone', 'Phone'], ['email', 'Email'], ['location', 'Location'], ['instagram_url', 'Instagram URL'], ['website', 'Website'], ['start_date', 'Start date', 'date'], ['monthly_deliverables', 'Videos per month', 'number'], ['contract_months', 'Contract (months)', 'number']] as [string, string, string?][]).map(([k, l, ty]) =>
          <label key={k} className="text-sm text-slate-400">{l}<input name={k} type={ty || 'text'} min={ty === 'number' ? 0 : undefined} required={k === 'business_name'} defaultValue={c[k] ?? ''} className="inp mt-1" /></label>)}
          <label className="text-sm text-slate-400">Status<select name="status" defaultValue={c.status} className="inp mt-1">{['lead', 'prospect', 'onboarding', 'active', 'on_hold', 'completed', 'lost'].map(x => <option key={x}>{x}</option>)}</select></label></div>
        <label className="text-sm text-slate-400 block">Business description<textarea name="description" rows={2} defaultValue={c.description ?? ''} className="inp mt-1" /></label>
        <label className="text-sm text-slate-400 block">Internal notes<textarea name="internal_notes" rows={2} defaultValue={c.internal_notes ?? ''} className="inp mt-1" /></label><button className="btn">Save changes</button></form>}
      {admin && <form action={deleteClient} className="border border-red-900 rounded-xl p-5 space-y-3"><h3 className="font-semibold text-red-400">Delete client</h3>
        <p className="text-sm text-slate-400">Permanently removes this client with all research, competitors, finance record and published-video records. This cannot be undone.</p>
        <input type="hidden" name="client_id" value={id} /><input type="hidden" name="back" value={self} /><label className="text-sm flex gap-2"><input type="checkbox" name="confirm" required /> I understand, delete {c.business_name}</label>
        <button className="bg-red-600 rounded-lg px-4 py-2 font-semibold">Delete client</button></form>}</div>
  } else if (tab === 'research' || tab === 'strategy') {
    const secs = SECTIONS.filter(x => x.group === tab)
    const rows = await Promise.all(secs.map(x => s.from(x.table).select('*').eq('client_id', id).maybeSingle()))
    body = <div className="space-y-6">{secs.map((x, i) => <form key={x.table} action={save} className="bg-card border border-line rounded-xl p-5 space-y-3">
      <h3 className="font-semibold">{x.title}</h3><input type="hidden" name="client_id" value={id} /><input type="hidden" name="back" value={self} /><input type="hidden" name="table" value={x.table} />
      <Fields fields={x.fields} row={rows[i].data} /><div className="flex items-center gap-3"><button className="btn">Save</button>{rows[i].data?.updated_at && <span className="text-xs text-slate-400">Last saved {new Date(rows[i].data.updated_at).toLocaleString('en-IN')}</span>}</div></form>)}</div>
  } else if (tab === 'competitors') {
    const { data: comps } = await s.from('competitors').select('*').eq('client_id', id).order('created_at')
    body = <div className="space-y-6">{comps?.map(k => <div key={k.id} className="bg-card border border-line rounded-xl p-5"><div className="flex justify-between"><h3 className="font-semibold">{k.name}</h3>
      <form action={delComp}><input type="hidden" name="id" value={k.id} /><input type="hidden" name="client_id" value={id} /><input type="hidden" name="back" value={self} /><button className="text-red-400 text-sm underline">Delete</button></form></div>
      <dl className="grid lg:grid-cols-2 gap-x-6 gap-y-2 mt-3 text-sm">{COMP_FIELDS.slice(1).map(([key, l]) => k[key] != null && <div key={key}><dt className="text-slate-400">{l}</dt><dd>{k[key]}</dd></div>)}</dl></div>)}
      {!comps?.length && <p className="text-slate-400">No competitors added yet.</p>}
      <form action={addComp} className="bg-card border border-line rounded-xl p-5 space-y-3"><h3 className="font-semibold">Add competitor</h3><input type="hidden" name="client_id" value={id} /><input type="hidden" name="back" value={self} />
        <input name="name" required placeholder="Competitor name" className="inp" /><Fields fields={COMP_FIELDS.slice(1)} /><button className="btn">Add competitor</button></form></div>
  } else if (tab === 'scripts') {
    const { data: rows } = await s.from('scripts').select('id,title,status,version,platform,updated_at,writer:profiles!scripts_scriptwriter_id_fkey(full_name)').eq('client_id', id).order('updated_at', { ascending: false }).limit(200)
    body = <div className="space-y-6">
      <form action={newScript} className="bg-card border border-line rounded-xl p-4 flex gap-3 flex-wrap"><input type="hidden" name="client_id" value={id} /><input type="hidden" name="back" value={self} />
        <input name="title" required placeholder="New script title" className="inp !w-80" /><button className="btn">Create script</button></form>
      <table className="w-full text-left"><thead className="text-slate-400 text-sm"><tr><th className="py-2">Title</th><th>Writer</th><th>Platform</th><th>Status</th><th>Ver.</th><th>Updated</th></tr></thead>
        <tbody>{rows?.map((r: any) => <tr key={r.id} className="border-t border-line"><td className="py-2"><Link href={`/scripts/${r.id}`} className="hover:underline font-medium">{r.title}</Link></td><td>{r.writer?.full_name ?? '—'}</td><td>{r.platform}</td>
          <td><span className={`tag ${tone(r.status)}`}>{label(r.status)}</span></td><td>v{r.version}</td><td>{fmt(r.updated_at)}</td></tr>)}
          {!rows?.length && <tr><td colSpan={6} className="py-8 text-center text-slate-400">No scripts for this client yet.</td></tr>}</tbody></table></div>
  } else if (tab === 'pipeline') {
    const { data: vids } = await s.from('videos').select('id,code,title,stage,shoot_date,editing_deadline,updated_at,editor:profiles!videos_editor_id_fkey(full_name)').eq('client_id', id).order('updated_at', { ascending: false }).limit(300)
    const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10)
    const late = (v: any) => v.editing_deadline && v.editing_deadline < today && ['editing', 'footage_uploaded', 'revision_required'].includes(v.stage)
    const count = (st: string) => (vids ?? []).filter((v: any) => v.stage === st).length
    body = <div className="space-y-6">
      <div className="flex gap-2 flex-wrap">{STAGES.map(st => <div key={st} className="bg-card border border-line rounded-lg px-3 py-2 text-xs"><div className="text-slate-400">{label(st)}</div><div className="text-lg font-bold">{count(st)}</div></div>)}</div>
      <div className="flex gap-3 items-center"><form action={newVideo} className="flex gap-2"><input type="hidden" name="client_id" value={id} /><input type="hidden" name="back" value={self} />
        <input name="title" required placeholder="New video title" className="inp !w-72" /><button className="btn">Add to pipeline</button></form>
        <Link href={`/production?client=${id}`} className="underline text-sm text-slate-400">Open board for this client →</Link></div>
      <table className="w-full text-left text-sm"><thead className="text-slate-400"><tr><th className="py-2">Code</th><th>Title</th><th>Stage</th><th>Editor</th><th>Shoot</th><th>Edit deadline</th></tr></thead>
        <tbody>{vids?.map((v: any) => <tr key={v.id} className="border-t border-line"><td className="py-2 text-slate-400">{v.code}</td><td><Link href={`/production?client=${id}&video=${v.id}`} className="hover:underline">{v.title}</Link></td>
          <td><span className={`tag ${tone(v.stage)}`}>{label(v.stage)}</span></td><td>{v.editor?.full_name ?? '—'}</td><td>{fmt(v.shoot_date)}</td><td className={late(v) ? 'text-red-400' : ''}>{fmt(v.editing_deadline)}{late(v) && ' (overdue)'}</td></tr>)}
          {!vids?.length && <tr><td colSpan={6} className="py-8 text-center text-slate-400">No videos in the pipeline yet.</td></tr>}</tbody></table></div>
  } else if (tab === 'deliverables') {
    const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10)
    const ym = /^\d{4}-\d{2}$/.test(month ?? '') ? month! : today.slice(0, 7); const [y, m] = ym.split('-').map(Number)
    const start = `${ym}-01`, end = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10)
    const shift = (d: number) => new Date(Date.UTC(y, m - 1 + d, 1)).toISOString().slice(0, 7)
    const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    const [{ data: vids }, { count: total }] = await Promise.all([
      s.from('videos').select('*').eq('client_id', id).eq('status', 'published').gte('published_on', start).lt('published_on', end).order('published_on', { ascending: false }),
      s.from('videos').select('*', { count: 'exact', head: true }).eq('client_id', id).eq('status', 'published')])
    const done = vids?.length ?? 0, target = c.monthly_deliverables, left = Math.max(0, target - done), pct = target ? Math.min(100, Math.round(done / target * 100)) : 0
    const contractTotal = c.contract_months ? target * c.contract_months : 0
    const stats: [string, number | string][] = [['Videos wanted / month', target], ['Published this month', done], ['Remaining this month', left], ['Published all-time', contractTotal ? `${total ?? 0} / ${contractTotal}` : (total ?? 0)]]
    body = <div className="space-y-6">
      <div className="flex items-center gap-3"><Link href={`?tab=deliverables&month=${shift(-1)}`} className="underline text-sm">← Prev</Link><b>{label}</b><Link href={`?tab=deliverables&month=${shift(1)}`} className="underline text-sm">Next →</Link></div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{stats.map(([l, v]) => <div key={l} className="bg-card border border-line rounded-xl p-5"><div className="text-sm text-slate-400">{l}</div><div className="text-3xl font-bold mt-1">{v}</div></div>)}</div>
      <div><div className="h-3 bg-line rounded-full overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} /></div>
        <p className="text-sm text-slate-400 mt-1">{done} of {target} delivered ({pct}%){done > target && ` · ${done - target} extra beyond package`}{target === 0 && ' · set "Videos per month" in Overview'}</p></div>
      <form action={addVideo} className="bg-card border border-line rounded-xl p-4 grid lg:grid-cols-4 gap-3"><input type="hidden" name="client_id" value={id} /><input type="hidden" name="back" value={self} />
        <input name="title" required placeholder="Video title" className="inp" /><input name="url" type="url" required placeholder="Paste published link (https://…)" className="inp lg:col-span-2" />
        <input name="date" type="date" required defaultValue={today} className="inp" /><button className="btn lg:col-span-4 w-fit">Add published video</button></form>
      <table className="w-full text-left"><thead className="text-slate-400 text-sm"><tr><th className="py-2">Date</th><th>Title</th><th>Link</th><th></th></tr></thead><tbody>
        {vids?.map(v => <tr key={v.id} className="border-t border-line"><td className="py-2">{v.published_on}</td><td>{v.title}</td><td><a href={v.published_url} target="_blank" rel="noopener noreferrer" className="underline text-blue-400 break-all">{v.published_url}</a></td>
          <td><form action={delVideo}><input type="hidden" name="id" value={v.id} /><input type="hidden" name="client_id" value={id} /><input type="hidden" name="back" value={self} /><button className="text-red-400 text-sm underline">Remove</button></form></td></tr>)}
        {!vids?.length && <tr><td colSpan={4} className="py-8 text-center text-slate-400">No published videos in {label}.</td></tr>}</tbody></table></div>
  } else if (tab === 'finance' && admin) {
    const { data: fin } = await s.from('client_finance').select('*').eq('client_id', id).maybeSingle()
    body = <form action={saveFin} className="bg-card border border-line rounded-xl p-5 grid lg:grid-cols-2 gap-3 max-w-3xl"><input type="hidden" name="client_id" value={id} /><input type="hidden" name="back" value={self} />
      <label className="text-sm text-slate-400">Monthly package (₹)<input name="amount" type="number" min="0" defaultValue={fin?.monthly_package_amount ?? 0} className="inp mt-1" /></label>
      <label className="text-sm text-slate-400">GSTIN<input name="gstin" defaultValue={fin?.gstin ?? ''} className="inp mt-1" /></label>
      <label className="text-sm text-slate-400 lg:col-span-2">Billing address<textarea name="billing" rows={2} defaultValue={fin?.billing_address ?? ''} className="inp mt-1" /></label><button className="btn w-fit">Save</button></form>
  }
  return <div className="space-y-6"><div><Link href="/clients" className="text-sm text-slate-400">← Clients</Link><h1 className="text-2xl font-bold">{c.business_name}</h1></div>
    <nav className="flex flex-wrap gap-2 border-b border-line pb-2">{tabs.map(([k, l]) => <Link key={k} href={`?tab=${k}`} className={`px-3 py-1.5 rounded-lg text-sm ${tab === k ? 'bg-line' : 'hover:bg-line/50'}`}>{l}</Link>)}
      {LINKED.map(([l, h]) => <Link key={l} href={`${h}?client=${id}`} className="px-3 py-1.5 rounded-lg text-sm hover:bg-line/50">{l} ↗</Link>)}
      {COMING.map(l => <span key={l} title="Coming in a later phase" className="px-3 py-1.5 text-sm text-slate-600">{l}</span>)}</nav>
    {body}</div>
}
