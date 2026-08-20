export async function copyText(text: string, selectFallback: () => void): Promise<boolean> {
  try {
    if (!navigator.clipboard) throw new Error('Clipboard API unavailable')
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    selectFallback()
    return false
  }
}
