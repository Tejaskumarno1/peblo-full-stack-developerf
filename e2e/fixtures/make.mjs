// Makes small PowerPoint, Word, Excel and PDF files for the tests (written to a temp folder, never committed).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const root = createRequire(path.join(here, '..', '..', 'package.json'));
const client = createRequire(path.join(here, '..', '..', 'client', 'package.json'));

export async function makeFixtures(dir = fs.mkdtempSync(path.join(os.tmpdir(), 'peblo-fx-'))) {
  const out = {};
  // PowerPoint: 5 slides
  const PptxGenJS = root('pptxgenjs');
  const p = new PptxGenJS();
  const titles = ['Launch plan', 'Goals', 'Scope', 'Timeline', 'Risks'];
  titles.forEach((t, i) => { const s = p.addSlide(); s.addText(t, { x: 0.6, y: 0.5, w: 8, h: 1, fontSize: 32, bold: true }); s.addText(i === 4 ? 'The main risk is the share page review' : `Point ${i + 1} about ${t}`, { x: 0.6, y: 1.8, w: 8, h: 1, fontSize: 18 }); });
  out.pptx = path.join(dir, 'Launch-plan.pptx'); await p.writeFile({ fileName: out.pptx });
  // Word
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = root('docx');
  const d = new Document({ sections: [{ children: [
    new Paragraph({ text: 'Launch plan: scope and owners', heading: HeadingLevel.HEADING_1 }),
    new Paragraph({ children: [new TextRun('The redesign ships on Friday with no open blockers. Owners are listed per area.')] }),
    new Paragraph({ children: [new TextRun('Review on Friday morning, then ship.')] }),
  ] }] });
  out.docx = path.join(dir, 'Launch-brief.docx'); fs.writeFileSync(out.docx, await Packer.toBuffer(d));
  // Excel: two sheets, 260 rows on the first
  const X = client('xlsx');
  const wb = X.utils.book_new();
  const rows = [['Item', 'Q3', 'Q4', 'Change']];
  for (let i = 1; i <= 260; i += 1) rows.push([i === 1 ? 'Design' : `Item ${i}`, 1000 + i, 1100 + i, 100]);
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(rows), 'Budget');
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([['Team', 'Owner'], ['Design', 'Priya'], ['Cloud', 'Arun']]), 'Q4');
  out.xlsx = path.join(dir, 'Q4-budget.xlsx'); X.writeFile(wb, out.xlsx);
  // PDF: 4 pages
  const { jsPDF } = client('jspdf');
  const pdf = new jsPDF();
  for (let i = 1; i <= 4; i += 1) { if (i > 1) pdf.addPage(); pdf.setFontSize(22); pdf.text(`Agreement page ${i}`, 20, 30); pdf.setFontSize(12); pdf.text(i === 2 ? 'Review on Friday' : 'Terms and conditions apply.', 20, 50); }
  out.pdf = path.join(dir, 'Contract-v3.pdf'); fs.writeFileSync(out.pdf, Buffer.from(pdf.output('arraybuffer')));
  // something nobody can preview, and something too big
  out.pages = path.join(dir, 'Report.pages'); fs.writeFileSync(out.pages, Buffer.from('not really a pages file'));
  out.big = path.join(dir, 'Big-deck.pptx'); fs.writeFileSync(out.big, Buffer.alloc(26 * 1024 * 1024, 1));
  out.dir = dir;
  return out;
}
if (process.argv[1] && process.argv[1].endsWith('make.mjs')) console.log(JSON.stringify(await makeFixtures(process.argv[2]), null, 1));
