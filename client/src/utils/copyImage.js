// Copy a picture to the clipboard so it can be pasted into a chat, a document or another note.
// The clipboard takes PNG, so the picture is drawn onto a canvas first; if the browser refuses, the address is copied instead.
const toPng = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    try {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth || img.width; c.height = img.naturalHeight || img.height;
      c.getContext('2d').drawImage(img, 0, 0);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('no image'))), 'image/png');
    } catch (e) { reject(e); }
  };
  img.onerror = () => reject(new Error('could not load the picture'));
  img.src = src;
});

/** @returns {Promise<'image'|'link'|'failed'>} what ended up on the clipboard */
export async function copyImage(src) {
  const url = String(src || '').split('#')[0];
  if (!url) return 'failed';
  try {
    if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': toPng(url) })]);
      return 'image';
    }
  } catch { /* fall through to the address */ }
  try {
    const abs = new URL(url, window.location.href).href;
    if (/^data:/.test(url)) return 'failed';
    await navigator.clipboard.writeText(abs);
    return 'link';
  } catch { return 'failed'; }
}
