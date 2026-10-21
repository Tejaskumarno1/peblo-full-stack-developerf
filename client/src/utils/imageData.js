import api from '../api/client';
import { getToken } from '../api/token';

// Turn a picked, dropped or pasted file into something that can live inside a note.
// Pictures are converted to WebP (smaller than JPEG/PNG, keeps transparency), kept to 1920px, and stored on the server;
// the note only holds a short address like /api/media/<id>. Animated GIFs are kept as they are so they still move.
// Other files are kept as they are, up to 4 MB.
export const MAX_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

export function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That picture could not be opened')); };
    img.src = url;
  });
}

/** A picture file -> a WebP Blob no larger than `max` pixels on its long side. Falls back to JPEG if WebP is unavailable. */
export async function imageToWebp(file, max = 1920, quality = 0.82) {
  const img = await loadImage(file);
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * k));
  c.height = Math.max(1, Math.round(img.naturalHeight * k));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/webp', quality));
  if (blob && blob.type === 'image/webp') return blob;
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not convert the picture'))), 'image/jpeg', 0.85));
}

/** Keeps the picture on the server and returns its address, or null when that is not possible (signed out, offline). */
export async function storeImage(blob) {
  if (!getToken()) return null;
  try {
    const { data } = await api.post('/media', blob, { headers: { 'Content-Type': blob.type } });
    const base = String(api.defaults.baseURL || '/api').replace(/\/+$/, '');
    return `${base}/media/${data.id}`;
  } catch { return null; }
}

/** -> { name, url, size, isImage } or throws an Error with a message the person can read. */
export async function fileToAttachment(file) {
  const isImage = /^image\/(png|jpe?g|webp|gif|bmp|avif)/.test(file.type);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  if (!isImage) {
    if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name || 'That file'} is over 4 MB`);
    return { id, name: file.name || 'file', url: await readAsDataUrl(file), size: file.size, isImage: false };
  }
  const isGif = /gif/.test(file.type);
  const blob = isGif ? file : await imageToWebp(file);
  if (blob.size > MAX_IMAGE_BYTES) throw new Error(`${file.name || 'That picture'} is still over 6 MB after shrinking`);
  const base = file.name && !/^image\.\w+$/.test(file.name) ? file.name.replace(/\.\w+$/, '') : `screenshot-${stamp}`;
  const ext = isGif ? 'gif' : blob.type === 'image/webp' ? 'webp' : 'jpg';
  const url = (await storeImage(blob)) || (await readAsDataUrl(blob));
  return { id, name: `${base}.${ext}`, url, size: blob.size, isImage: true };
}

export const attachmentMarkdown = (list) => list.map((a) => (a.isImage ? `![${a.name}](${a.url})` : `[${a.name}](${a.url})`)).join('\n\n');

/** Exports must stand on their own, so pictures stored on the server are turned back into inline data. */
export async function inlineMedia(text) {
  const src = String(text || '');
  const ids = [...new Set([...src.matchAll(/\/api\/media\/([\w-]+)/g)].map((m) => m[1]))];
  if (!ids.length) return src;
  const found = {};
  await Promise.all(ids.map(async (id) => {
    try {
      const res = await fetch(`/api/media/${id}`);
      if (res.ok) found[id] = await readAsDataUrl(await res.blob());
    } catch { /* leave the address as it is */ }
  }));
  return src.replace(/\/api\/media\/([\w-]+)/g, (m, id) => found[id] || m);
}
