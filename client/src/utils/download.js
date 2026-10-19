// Save text or a Blob as a file in the browser (no server involved).
export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(filename, text, mime = 'text/plain') {
  downloadBlob(filename, new Blob([text], { type: `${mime};charset=utf-8` }));
}

/** A title made safe to use as a file name. */
export function safeFileName(title, fallback = 'note') {
  const s = String(title || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return s || fallback;
}
