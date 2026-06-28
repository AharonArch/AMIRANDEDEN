// /api/emails  — returns the email correspondence between Aharon and ONE client,
// scoped by the caller's personal token. A client can only ever see their own thread.
//
// Expects GET  with header  x-portal-token: <client token>
// Env vars required:
//   GOOGLE_CLIENT_ID , GOOGLE_CLIENT_SECRET , GOOGLE_REFRESH_TOKEN   (Aharon's Gmail, read-only)
//   CLIENTS  (JSON map token -> { "name": "...", "email": "client@example.com" })

import { google } from 'googleapis';

function cors(res){
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-portal-token');
}

function clientFor(token){
  try{ const map = JSON.parse(process.env.CLIENTS || '{}'); return map[token] || null; }
  catch(e){ return null; }
}

function gmailClient(){
  const oauth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.gmail({ version: 'v1', auth: oauth });
}

function header(headers, name){
  const h = (headers || []).find(x => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

function decodeBody(payload){
  // Walk the MIME tree, prefer text/plain, fall back to text/html (stripped).
  function walk(p){
    if (!p) return '';
    if (p.mimeType === 'text/plain' && p.body && p.body.data) return b64(p.body.data);
    if (p.parts){
      for (const part of p.parts){ const t = walk(part); if (t) return t; }
    }
    if (p.mimeType === 'text/html' && p.body && p.body.data){
      return b64(p.body.data).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g,' ').replace(/\s+\n/g,'\n');
    }
    return '';
  }
  return walk(payload).trim();
}
function b64(d){ return Buffer.from(d.replace(/-/g,'+').replace(/_/g,'/'), 'base64').toString('utf8'); }

export default async function handler(req, res){
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET')     return res.status(405).json({ error: 'method' });

  const token  = req.headers['x-portal-token'];
  const client = clientFor(token);
  if (!client) return res.status(401).json({ error: 'unauthorized' });

  try{
    const gmail = gmailClient();
    const email = client.email;
    // Only this client's correspondence:
    const q = `(from:${email} OR to:${email})`;
    const list = await gmail.users.threads.list({ userId: 'me', q, maxResults: 20 });
    const threads = list.data.threads || [];

    const out = [];
    for (const t of threads){
      const full = await gmail.users.threads.get({ userId: 'me', id: t.id, format: 'full' });
      const msgs = (full.data.messages || []).map(m => ({
        from: header(m.payload.headers, 'From'),
        to:   header(m.payload.headers, 'To'),
        date: header(m.payload.headers, 'Date'),
        subject: header(m.payload.headers, 'Subject'),
        body: decodeBody(m.payload).slice(0, 6000)
      }));
      out.push({
        id: t.id,
        subject: msgs.length ? msgs[0].subject : '(ללא נושא)',
        messages: msgs
      });
    }
    // newest thread first
    out.sort((a,b) => {
      const da = new Date(a.messages[a.messages.length-1]?.date || 0);
      const db = new Date(b.messages[b.messages.length-1]?.date || 0);
      return db - da;
    });
    return res.status(200).json({ client: { name: client.name, email }, threads: out });
  } catch (e){
    return res.status(500).json({ error: 'server', detail: String(e && e.message || e) });
  }
}
