export function licensePreviewKind(url: string): 'image' | 'file' {
  try {
    return /\.(?:png|jpe?g)$/i.test(new URL(url).pathname) ? 'image' : 'file';
  } catch { return 'file'; }
}
