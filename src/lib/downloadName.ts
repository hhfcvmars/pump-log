export function getXLogTextDownloadName(name: string): string {
  return name.replace(/\.xlog$/i, '.txt')
}
