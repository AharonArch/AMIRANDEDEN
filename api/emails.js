// /api/emails — email correspondence for the portal, scoped by the caller's token.
//
// Admin (Aharon): sees only threads he SENT to Amir and/or Eden. No drafts.
//   Wael-only / other-project threads never appear (we query Amir/Eden only).
// Amir / Eden: see only their own correspondence with Aharon. No drafts.
// Wael: sees only project threads that include BOTH Amir and Eden. No drafts.
//
// GET with header x-portal-token
// Env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN (gmail.readonly), CLIENTS

const { google } = require('googleapis');

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
  const oauth = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  oauth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.gmail({ version: 'v1', auth: oauth });
}
function header(headers, name){
  const h = (headers || []).find(x => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}
function b64(d){ return Buffer.from(d.replace(/-/g,'+').replace(/_/g,'/'), 'base64').toString('utf8'); }
function decodeBody(payload){
  function walk(p){
    if (!p) return '';
    if (p.mimeType === 'text/plain' && p.body && p.body.data) return b64(p.body.data);
    if (p.parts){ for (const part of p.parts){ const t = walk(part); if (t) return t; } }
    if (p.mimeType === 'text/html' && p.body && p.body.data){
      return b64(p.body.data).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g,' ').replace(/\s+\n/g,'\n');
    }
    return '';
  }
  return walk(payload).trim();
}

module.exports = async function handler(req, res){
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET')     return res.status(405).json({ error: 'method' });

  const token  = req.headers['x-portal-token'];
  const client = clientFor(token);
  if (!client) return res.status(401).json({ error: 'unauthorized' });

  try{
    const gmail = gmailClient();
    const map = JSON.parse(process.env.CLIENTS || '{}');
    const isAdmin = client.all === true;

    const adminEntry = Object.values(map).find(c => c.all);
    const adminEmail = (adminEntry && adminEntry.email) || client.email;
    const byId = id => Object.values(map).find(c => c.userId === id) || null;
    const amir = byId('amir'), eden = byId('eden'), wael = byId('wael');
    const amirE = amir && amir.email, edenE = eden && eden.email, waelE = wael && wael.email;
    const lc = s => String(s || '').toLowerCase();

    const NODRAFT = '-in:drafts -in:trash -in:spam';
    let q, requireBoth = false;
    const labelWith = [];      // used to label "with whom" in admin view
    if (amir) labelWith.push({ name: amir.name, email: amirE });
    if (eden) labelWith.push({ name: eden.name, email: edenE });

    if (isAdmin){
      // Only threads Aharon sent to Amir and/or Eden.
      q = `from:${adminEmail} (to:${amirE} OR to:${edenE}) ${NODRAFT}`;
    } else if (client.userId === 'wael'){
      // Wael: only project threads that include BOTH Amir and Eden.
      q = `from:${adminEmail} (to:${amirE} OR to:${edenE}) ${NODRAFT}`;
      requireBoth = true;
    } else {
      // Amir / Eden: their own correspondence with Aharon.
      q = `((from:${adminEmail} to:${client.email}) OR (from:${client.email} to:${adminEmail})) ${NODRAFT}`;
    }

    const list = await gmail.users.threads.list({ userId: 'me', q, maxResults: 30 });
    const threads = list.data.threads || [];

    const out = [];
    for (const t of threads){
      const full = await gmail.users.threads.get({ userId: 'me', id: t.id, format: 'full' });
      const rawMsgs = full.data.messages || [];
      // Drop any draft messages inside the thread.
      const msgs = rawMsgs
        .filter(m => !((m.labelIds || []).includes('DRAFT')))
        .map(m => ({
          from: header(m.payload.headers, 'From'),
          to:   header(m.payload.headers, 'To'),
          date: header(m.payload.headers, 'Date'),
          subject: header(m.payload.headers, 'Subject'),
          body: decodeBody(m.payload).slice(0, 6000)
        }));
      if (!msgs.length) continue;   // thread was only a draft

      const blob = lc(msgs.map(m => m.from + ' ' + m.to).join(' '));

      // Wael view: keep only threads where BOTH Amir and Eden appear.
      if (requireBoth){
        if (!(amirE && blob.includes(lc(amirE)) && edenE && blob.includes(lc(edenE)))) continue;
      }

      const who = labelWith.find(w => w.email && blob.includes(lc(w.email)));
      out.push({
        id: t.id,
        subject: msgs[0].subject || '(ללא נושא)',
        with: who ? who.name : '',
        messages: msgs
      });
    }

    out.sort((a,b) => {
      const da = new Date(a.messages[a.messages.length-1]?.date || 0);
      const db = new Date(b.messages[b.messages.length-1]?.date || 0);
      return db - da;
    });
    return res.status(200).json({ admin: isAdmin, threads: out });
  } catch (e){
    return res.status(500).json({ error: 'server', detail: String(e && e.message || e) });
  }
};
