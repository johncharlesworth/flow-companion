// "Download JSON" from the header menu (the normalized flow) and Download under
// a Document answer (the markdown): `<Flow label> v<n>.<ext>`, with the flow's
// label made safe for a filename first. The label is org data, not ours.

export function downloadFilename(label: string, versionNumber: number, extension: 'json' | 'md'): string {
  const safe = label.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Flow';
  return `${safe} v${versionNumber}.${extension}`;
}

export function downloadTextFile(filename: string, text: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
