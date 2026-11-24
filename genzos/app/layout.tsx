import "./globals.css"
export const metadata = { title: "GENZ FILMS OS", description: "Creative Storytelling. Strategic Content. Business Growth." }
// theme is applied before first paint so there is no flash; default is dark
const themeScript = `try{var t=localStorage.getItem("theme");if(t!=="light")document.documentElement.classList.add("dark")}catch(e){document.documentElement.classList.add("dark")}`
export default function R({ children }: { children: React.ReactNode }) {
  return <html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head><body>{children}</body></html>
}
