// Turn a picked, dropped or pasted file into something that can live inside a note.
// Pictures are shrunk (max 1600px, JPEG) so a screenshot stays small; other files are kept as they are, up to 4 MB.
export const MAX_FILE_BYTES = 4 * 1024 * 1024;

export function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

export function shrinkImage(dataUrl, max = 1600) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onerror = () => resolve(dataUrl);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * k));
      c.height = Math.max(1, Math.round(img.height * k));
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.src = dataUrl;
  });
}

/** -> { name, url, size, isImage } or throws an Error with a message the person can read. */
export async function fileToAttachment(file) {
  const isImage = /^image\/(png|jpe?g|webp|gif)/.test(file.type);
  if (!isImage && file.size > MAX_FILE_BYTES) throw new Error(`${file.name || 'That file'} is over 4 MB`);
  const raw = await readAsDataUrl(file);
  const url = isImage && !/gif/.test(file.type) ? await shrinkImage(raw) : raw;
  if (url.length > MAX_FILE_BYTES * 1.4) throw new Error(`${file.name || 'That picture'} is too large`);
  const name = file.name && file.name !== 'image.png' ? file.name : `screenshot-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.jpg`;
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name, url, size: file.size, isImage };
}

export const attachmentMarkdown = (list) => list.map((a) => (a.isImage ? `![${a.name}](${a.url})` : `[${a.name}](${a.url})`)).join('\n\n');
