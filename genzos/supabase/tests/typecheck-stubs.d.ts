// Loose stand-ins for packages that cannot be installed here. They catch syntax, scope, import and helper-signature errors, NOT prop/column typos.
declare namespace JSX { interface IntrinsicElements { [k: string]: { [a: string]: any; onChange?: (e: any) => void; onSubmit?: (e: any) => void; onClick?: (e: any) => void } } interface Element {} interface ElementChildrenAttribute { children: {} } }
declare namespace React { type ReactNode = any; type FormEvent = any; type ChangeEvent<T = any> = any }
declare module "react/jsx-runtime" { export const jsx: any, jsxs: any, Fragment: any }
declare module "react" {
  export type ReactNode = any
  export function useState<T>(v: T | (() => T)): [T, (v: T | ((p: T) => T)) => void]
  export function useEffect(f: () => void | (() => void), d?: any[]): void
  export const Suspense: any
  export function useRef<T>(v?: T): { current: T }
  export function useTransition(): [boolean, (f: () => void) => void]
}
declare module "next/navigation" {
  export function redirect(u: string): never
  export function notFound(): never
  export function useRouter(): { replace(u: string): void; push(u: string): void; refresh(): void }
  export function usePathname(): string
  export function useSearchParams(): URLSearchParams & { size: number }
}
declare module "next/link" { const L: (p: { href: string; [k: string]: any }) => any; export default L }
declare module "next/cache" { export function revalidatePath(p: string): void }
declare module "next/headers" { export function cookies(): Promise<{ getAll(): { name: string; value: string }[]; set(n: string, v: string, o?: any): void }> ; export function headers(): Promise<Headers> }
declare module "next/server" {
  export class NextRequest extends Request { cookies: any; nextUrl: URL }
  export class NextResponse extends Response { cookies: any; static next(o?: any): NextResponse; static redirect(u: URL | string): NextResponse; static json(b: any, i?: any): NextResponse }
}
declare module "@supabase/ssr" {
  export type CookieOptions = Record<string, any>
  type Err = { message: string; code?: string } | null
  type Res<T> = { data: T; count: number | null; error: Err }
  export interface QB extends PromiseLike<Res<any[] | null>> {
    select(c?: string, o?: { count?: "exact"; head?: boolean }): QB; insert(v: any, o?: any): QB; update(v: any): QB; upsert(v: any, o?: any): QB; delete(): QB
    eq(c: string, v: any): QB; neq(c: string, v: any): QB; in(c: string, v: any[]): QB; is(c: string, v: any): QB; gte(c: string, v: any): QB; lt(c: string, v: any): QB; overlaps(c: string, v: any): QB; lte(c: string, v: any): QB; gt(c: string, v: any): QB
    ilike(c: string, v: string): QB; or(f: string): QB; not(c: string, op: string, v: any): QB; contains(c: string, v: any): QB; order(c: string, o?: { ascending?: boolean; nullsFirst?: boolean }): QB; limit(n: number): QB; range(a: number, b: number): QB
    single(): PromiseLike<Res<any>>; maybeSingle(): PromiseLike<Res<any>>
  }
  export interface Client {
    from(t: string): QB; rpc(f: string, a?: any): QB & PromiseLike<Res<any>>
    auth: { getUser(): Promise<{ data: { user: { id: string; email?: string } | null }; error: Err }>; signOut(): Promise<any>; signInWithPassword(a: any): Promise<{ error: Err }>; resetPasswordForEmail(e: string, o?: any): Promise<{ error: Err }>; updateUser(a: any): Promise<{ error: Err }>; exchangeCodeForSession(c: string): Promise<{ error: Err }>; getSession(): Promise<any> }
    storage: { from(b: string): { upload(p: string, f: any, o?: any): Promise<{ error: Err }>; createSignedUrl(p: string, s: number): Promise<{ data: { signedUrl: string } | null; error: Err }>; remove(p: string[]): Promise<{ error: Err }> } }
  }
  export function createServerClient(u: string, k: string, o: any): Client
  export function createBrowserClient(u: string, k: string): Client
}
declare module "*.css" {}
declare var process: { env: Record<string, string | undefined> }
