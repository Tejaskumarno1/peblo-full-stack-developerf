// Profile pictures: any picture -> a centred square 256x256 WebP data address (about 10-25 KB).
export async function avatarToWebp(file, size = 256) {
  if (!file || !/^image\//.test(file.type)) throw new Error('Choose a picture file.');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('That picture could not be opened')); i.src = url; });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth - side) / 2, sy = (img.naturalHeight - side) / 2;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    c.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, size, size);
    let out = c.toDataURL('image/webp', 0.82);
    if (!out.startsWith('data:image/webp')) throw new Error('This browser cannot make WebP pictures.');
    for (let q = 0.7; out.length > 150_000 && q > 0.3; q -= 0.15) out = c.toDataURL('image/webp', q);
    return out;
  } finally { URL.revokeObjectURL(url); }
}
