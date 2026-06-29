// /api/auth — real login: phone -> emailed 6-digit code -> verify -> signed session.
// Nothing sensitive lives in the public site; all checks happen here.
//
// POST { action:'request', phone }          -> emails a code to the matching client
// POST { action:'verify',  phone, code }    -> { session, accessToken, name, role, userId }
// POST { action:'session', session }        -> validates a saved session on refresh
//
// Env: CLIENTS (now incl. phone+email+userId per entry), SESSION_SECRET,
//      GOOGLE_* (gmail.send), KV_REST_API_URL/TOKEN (Upstash).

const { google } = require('googleapis');
const crypto = require('crypto');

function cors(res){
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
function clients(){ try{ return JSON.parse(process.env.CLIENTS || '{}'); }catch(e){ return {}; } }
function normPhone(s){ return String(s||'').replace(/\D/g,'').replace(/^972/,'0'); }
function findByPhone(phone){
  const p = normPhone(phone); const map = clients();
  for(const key of Object.keys(map)){
    const c = map[key];
    if(c.phone && normPhone(c.phone) === p) return Object.assign({ key }, c);
  }
  return null;
}

const KV_URL   = process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
async function kv(cmd){
  const r = await fetch(KV_URL, { method:'POST',
    headers:{ 'Authorization':'Bearer '+KV_TOKEN, 'Content-Type':'application/json' },
    body: JSON.stringify(cmd) });
  const d = await r.json();
  if(!r.ok) throw new Error(JSON.stringify(d));
  return d.result;
}

function sign(payload){
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac  = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(body).digest('base64url');
  return body + '.' + mac;
}
function verifySession(tok){
  try{
    const [body, mac] = String(tok||'').split('.');
    if(!body || !mac) return null;
    const exp = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(body).digest('base64url');
    const a = Buffer.from(mac), b = Buffer.from(exp);
    if(a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if(payload.exp && Date.now() > payload.exp) return null;
    return payload;
  }catch(e){ return null; }
}

function gmail(){
  const o = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  o.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.gmail({ version:'v1', auth:o });
}
async function sendCodeEmail(to, code, name){
  const subject = 'קוד הכניסה שלך · פורטל לוי אדריכלים';
  const spaced = String(code).split('').join('&nbsp;&nbsp;'); // breathing room between digits

  const text =
`שלום ${name},

קוד הכניסה שלך לפורטל הוא: ${code}

הקוד תקף ל-10 דקות. אם לא ביקשת קוד כניסה, אפשר להתעלם מהודעה זו.

לוי אדריכלים`;

  const html =
`<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0B0B0C;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0B0B0C;">
    <tr><td align="center" style="padding:40px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#141416;border:1px solid #26262A;border-radius:20px;overflow:hidden;">

        <tr><td align="center" style="padding:44px 32px 8px 32px;">
          <div style="font-size:54px;line-height:1;color:#FF5A2C;">&#10043;</div>
        </td></tr>

        <tr><td align="center" style="padding:4px 32px 0 32px;">
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:3px;color:#8A8A92;text-transform:uppercase;">לוי אדריכלים &middot; פורטל לקוחות</div>
        </td></tr>

        <tr><td align="center" style="padding:18px 32px 0 32px;">
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:800;color:#F5F5F0;">שלום ${name},</div>
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#B6B6BE;padding-top:10px;line-height:1.6;">קוד הכניסה החד&#8209;פעמי שלך לפורטל:</div>
        </td></tr>

        <tr><td align="center" style="padding:26px 32px 6px 32px;">
          <table role="presentation" cellpadding="0" cellspacing="0" style="background:#0B0B0C;border:1px solid #FF5A2C;border-radius:14px;">
            <tr><td align="center" style="padding:18px 30px;font-family:'Courier New',monospace;font-size:38px;font-weight:700;letter-spacing:2px;color:#FF5A2C;">${spaced}</td></tr>
          </table>
        </td></tr>

        <tr><td align="center" style="padding:18px 40px 0 40px;">
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#8A8A92;line-height:1.7;">הקוד תקף ל&#8209;10 דקות. אם לא ביקשת קוד כניסה, אפשר להתעלם מהודעה זו בבטחה.</div>
        </td></tr>

        <tr><td style="padding:30px 32px 0 32px;"><div style="height:1px;background:#26262A;line-height:1px;font-size:0;">&nbsp;</div></td></tr>

        <tr><td align="center" style="padding:18px 32px 40px 32px;">
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#F5F5F0;font-weight:700;">לוי אדריכלים</div>
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#6A6A72;padding-top:4px;">תכנון. ליווי. בנייה.</div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const boundary = 'b_' + Date.now();
  const mime = [
    'To: ' + to,
    'Subject: =?UTF-8?B?' + Buffer.from(subject).toString('base64') + '?=',
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="' + boundary + '"',
    '',
    '--' + boundary,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(text).toString('base64'),
    '',
    '--' + boundary,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(html).toString('base64'),
    '',
    '--' + boundary + '--'
  ].join('\r\n');
  const raw = Buffer.from(mime).toString('base64url');
  await gmail().users.messages.send({ userId:'me', requestBody:{ raw } });
}

module.exports = async function handler(req, res){
  cors(res);
  if(req.method === 'OPTIONS') return res.status(204).end();
  if(req.method !== 'POST')     return res.status(405).json({ error:'method' });
  if(!process.env.SESSION_SECRET) return res.status(500).json({ error:'no_secret' });
  if(!KV_URL || !KV_TOKEN)        return res.status(500).json({ error:'no_store' });

  const { action } = req.body || {};
  try{
    if(action === 'request'){
      const c = findByPhone(req.body.phone);
      // Never reveal whether a phone is registered.
      if(!c || !c.email) return res.status(200).json({ ok:true });
      const p = normPhone(c.phone);

      // 20s cooldown between sends
      const cd = await kv(['GET', 'auth:cd:'+p]);
      if(cd) return res.status(429).json({ error:'cooldown' });
      // max 5 sends / hour
      const cnt = await kv(['INCR', 'auth:rl:'+p]);
      if(cnt === 1) await kv(['EXPIRE', 'auth:rl:'+p, '3600']);
      if(cnt > 5)   return res.status(429).json({ error:'too_many' });

      const code = '' + Math.floor(100000 + Math.random()*900000);
      await kv(['SET', 'auth:code:'+p, JSON.stringify({ code, tries:0, key:c.key }), 'EX', '600']);
      await kv(['SET', 'auth:cd:'+p, '1', 'EX', '20']);
      await sendCodeEmail(c.email, code, c.name);
      return res.status(200).json({ ok:true });
    }

    if(action === 'verify'){
      const p = normPhone(req.body.phone);
      const code = String(req.body.code || '').trim();
      const raw = await kv(['GET', 'auth:code:'+p]);
      if(!raw) return res.status(400).json({ error:'expired' });
      const data = JSON.parse(raw);
      if(data.tries >= 5){ await kv(['DEL','auth:code:'+p]); return res.status(429).json({ error:'locked' }); }
      if(code !== data.code){
        data.tries++;
        await kv(['SET','auth:code:'+p, JSON.stringify(data), 'EX','600']);
        return res.status(401).json({ error:'wrong', left: 5 - data.tries });
      }
      await kv(['DEL','auth:code:'+p]);
      const c = clients()[data.key] || {};
      const exp = Date.now() + 1000*60*60*12; // 12-hour session
      const session = sign({ key:data.key, exp });
      return res.status(200).json({
        ok:true, session, accessToken:data.key,
        name:c.name||'', role:c.all?'architect':'client', userId:c.userId||'viewer'
      });
    }

    if(action === 'session'){
      const payload = verifySession(req.body.session);
      if(!payload) return res.status(401).json({ error:'invalid' });
      const c = clients()[payload.key];
      if(!c) return res.status(401).json({ error:'invalid' });
      return res.status(200).json({
        ok:true, accessToken:payload.key,
        name:c.name||'', role:c.all?'architect':'client', userId:c.userId||'viewer'
      });
    }

    return res.status(400).json({ error:'bad_action' });
  }catch(e){
    return res.status(500).json({ error:'server', detail:String(e && e.message || e) });
  }
};
