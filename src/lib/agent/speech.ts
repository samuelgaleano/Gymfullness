/** Turns an assistant reply into something pleasant to read aloud (tts.speak). */
export function toSpokenText(text: string, maxChars = 280): string {
  const s = text
    .replace(/[*_`#>]+/g, '')
    .replace(/^\s*(?:[•\-–]|\d+[.)])\s+/gm, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s*\n+\s*/g, '. ')
    .replace(/\.{2,}/g, '.')
    .replace(/([.!?:])\s*\./g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  if (s.length <= maxChars) return s
  const cut = s.slice(0, maxChars)
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '))
  return end > 60 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '')
}
