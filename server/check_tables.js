import sqlite3 from 'sqlite3';
const db1 = new sqlite3.Database('prisma/dev.db');
db1.all("SELECT name FROM sqlite_master WHERE type='table'", (err, rows) => {
  console.log('prisma/dev.db tables:', rows ? rows.map(r => r.name) : err.message);
});
const db2 = new sqlite3.Database('prisma/prisma/dev.db');
db2.all("SELECT name FROM sqlite_master WHERE type='table'", (err, rows) => {
  console.log('prisma/prisma/dev.db tables:', rows ? rows.map(r => r.name) : err.message);
});
