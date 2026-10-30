// Runs the spreadsheet read off the main thread (see sheetRead.js). A bad file can only hurt this worker, which is stopped after a time limit.
import * as X from 'xlsx';
import { readSheetsWith } from './sheetRead.js';

self.onmessage = (e) => {
  try {
    const { buf, opts } = e.data;
    self.postMessage({ ok: true, result: readSheetsWith(X.read ? X : X.default, buf, opts) });
  } catch (err) {
    self.postMessage({ ok: false, code: err && err.code, message: String((err && err.message) || err) });
  }
};
