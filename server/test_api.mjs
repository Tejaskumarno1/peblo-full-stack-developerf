import fetch from 'node-fetch';

async function test() {
  const loginRes = await fetch('http://localhost:3001/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo@peblo.dev', password: 'demo123' })
  });
  const loginData = await loginRes.json();
  const token = loginData.accessToken;

  const createRes = await fetch('http://localhost:3001/api/notes', {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ title: 'My Test Note', content: 'Testing 123' })
  });
  const createData = await createRes.json();
  console.log('Created:', createData.note.title);

  const getRes = await fetch('http://localhost:3001/api/notes', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const getData = await getRes.json();
  console.log('Total notes:', getData.notes.length);
}
test();
