// /api/comments — shared storage for plan comments, so everyone sees them on refresh.
// Backed by Upstash Redis. Authorship and deletion are enforced SERVER-SIDE:
//   - the author of a comment is taken from the caller's token, not from the browser
//     (a logged-in user cannot post under someone else's name);
//   - a comment can be deleted only by its author, or by the admin.
//
// GET    -> { comments: { "<plan>": [ {id,who,name,text,time} ] } }
// POST   { f, msg:{ text, id?, time? } }   -> appends (who/name set from token)
// DELETE { f, id }                         -> removes (author or admin only)
//
// Env: KV_REST_API_URL/TOKEN (or UPSTASH_*), CLIENTS

function cors(res){
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-portal-token');
}
function clientFor(token){
  try{ const map = JSON.parse(process.env.CLIENTS || '{}'); return map[token] || null; }
  catch(e){ return null; }
}

const KV_URL   = process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const KEY = 'amireden:comments';

async function kv(cmd){
  const r = await fetch(KV_URL, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + KV_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd)
  });
  const d = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(d));
  return d.result;
}
async function readAll(){ const v = await kv(['GET', KEY]); return v ? JSON.parse(v) : {}; }
async function writeAll(obj){ await kv(['SET', KEY, JSON.stringify(obj)]); }

module.exports = async function handler(req, res){
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const token  = req.headers['x-portal-token'];
  const client = clientFor(token);
  if (!client) return res.status(401).json({ error: 'unauthorized' });
  if (!KV_URL || !KV_TOKEN) return res.status(500).json({ error: 'no_store' });

  const callerId    = String(client.userId || 'viewer');
  const callerName  = String(client.name || '');
  const callerAdmin = client.all === true;

  try{
    if (req.method === 'GET'){
      const comments = await readAll();
      return res.status(200).json({ comments });
    }

    if (req.method === 'POST'){
      const { f, msg } = req.body || {};
      if (!f || !msg || !msg.text) return res.status(400).json({ error: 'bad' });
      const all = await readAll();
      all[f] = all[f] || [];
      all[f].push({
        id:   String(msg.id || Date.now()),
        who:  callerId,             // identity comes from the token, not the browser
        name: callerName,
        text: String(msg.text).slice(0, 4000),
        time: String(msg.time || '')
      });
      await writeAll(all);
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE'){
      const { f, id } = req.body || {};
      const all = await readAll();
      const arr = all[f] || [];
      const target = arr.find(m => String(m.id) === String(id));
      if (!target) return res.status(200).json({ ok: true }); // already gone
      if (!callerAdmin && String(target.who) !== callerId){
        return res.status(403).json({ error: 'forbidden' });
      }
      all[f] = arr.filter(m => String(m.id) !== String(id));
      await writeAll(all);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'method' });
  } catch (e){
    return res.status(500).json({ error: 'server', detail: String(e && e.message || e) });
  }
};
