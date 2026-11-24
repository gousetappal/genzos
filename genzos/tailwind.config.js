const v = n => `rgb(var(--${n}) / <alpha-value>)`
module.exports = { darkMode: "class", content: ["./app/**/*.tsx", "./components/**/*.tsx"], theme: { extend: { colors: { navy: v("navy"), card: v("card"), line: v("line"), fg: v("fg") } } } }
