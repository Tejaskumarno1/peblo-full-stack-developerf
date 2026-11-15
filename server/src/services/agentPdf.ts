import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import prisma from '../db.js';

/*
 * A shared note as one PDF: the text, and every picture drawn on the page with its description and its address underneath.
 * For people and AI tools that take a file (an upload, an attachment) and cannot open pictures from a link.
 */
const MAX_PICS = 20;
const MAX_BYTES = 6_000_000;

// The note's text for a printed page: no HTML tags or markdown picture syntax (pictures are drawn separately).
function plain(md: string) {
  return String(md || '')
    .replace(/<figure>[\s\S]*?<\/figure>/g, '\n')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

type Pic = { id: string; url: string; description: string | null };

async function pngOf(id: string, userId: string): Promise<Buffer | null> {
  const rows = (await prisma.$queryRaw`SELECT data, size FROM media WHERE id = ${id} AND user_id = ${userId}`.catch(() => [])) as any[];
  if (!rows.length || (rows[0].size ?? 0) > MAX_BYTES) return null;
  try { return await sharp(Buffer.from(rows[0].data)).rotate().resize({ width: 1200, withoutEnlargement: true }).png().toBuffer(); } catch { return null; }
}

export async function notePdf(note: { title: string; content: string; author: string | null; updatedAt: Date; link: string; userId: string }, pics: Pic[]): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 54, info: { Title: note.title || 'Untitled', Author: note.author || 'Peblo' } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  const width = doc.page.width - 108;

  doc.font('Helvetica-Bold').fontSize(22).fillColor('#2a1f17').text(note.title || 'Untitled', { width });
  doc.moveDown(0.3).font('Helvetica').fontSize(9.5).fillColor('#6b5d50')
    .text(`Shared by ${note.author || 'unknown'}  |  Updated ${note.updatedAt.toISOString().slice(0, 10)}  |  ${note.link}`, { width });
  doc.moveDown(0.8).fillColor('#2a1f17').fontSize(11.5);
  for (const raw of plain(note.content).split('\n')) {
    const line = raw.replace(/\s+$/g, '');
    if (!line) { doc.moveDown(0.5); continue; }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) { doc.moveDown(0.4).font('Helvetica-Bold').fontSize(h[1].length === 1 ? 17 : h[1].length === 2 ? 14.5 : 12.5).text(h[2], { width }).font('Helvetica').fontSize(11.5); continue; }
    doc.text(line.replace(/^\s*[-*]\s+/, '• '), { width, lineGap: 2 });
  }

  const shown = pics.slice(0, MAX_PICS);
  if (shown.length) {
    doc.addPage();
    doc.font('Helvetica-Bold').fontSize(16).fillColor('#2a1f17').text(`Pictures (${pics.length})`, { width });
    doc.moveDown(0.6);
    let n = 0;
    for (const p of shown) {
      n++;
      const png = await pngOf(p.id, note.userId);
      if (png) {
        const meta = await sharp(png).metadata();
        const h = Math.min(330, width * ((meta.height || 1) / (meta.width || 1)));
        if (doc.y + h + 70 > doc.page.height - 54) doc.addPage();
        doc.image(png, { fit: [width, h], align: 'center' });
        doc.y += h + 6;
      }
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#2a1f17').text(`Image ${n}`, { width });
      if (p.description) doc.font('Helvetica').fontSize(10).fillColor('#2a1f17').text(p.description.replace(/\s+/g, ' ').slice(0, 600), { width });
      doc.font('Helvetica').fontSize(8.5).fillColor('#3b6ea5').text(p.url, { width, link: p.url, underline: true });
      doc.moveDown(1);
      if (doc.y > doc.page.height - 120) doc.addPage();
    }
    if (pics.length > shown.length) doc.font('Helvetica').fontSize(10).fillColor('#6b5d50').text(`${pics.length - shown.length} more pictures are listed in the Markdown version of this link.`, { width });
  }
  doc.end();
  return done;
}
