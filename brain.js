// /api/brain  — proxies chat requests to Claude, keeping the API key on the server.
// Expects POST { system, messages }  with header  x-portal-token: <client token>
// Env vars required:  ANTHROPIC_API_KEY , CLIENTS (JSON map token -> {name,email})

function cors(res){
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-portal-token');
}

function clientFor(token){
  try{ const map = JSON.parse(process.env.CLIENTS || '{}'); return map[token] || null; }
  catch(e){ return null; }
}

export default async function handler(req, res){
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'method' });

  // Authorize: only known client tokens may use the brain (prevents anonymous API abuse).
  const token = req.headers['x-portal-token'];
  if (!clientFor(token)) return res.status(401).json({ error: 'unauthorized' });

  try{
    const { system, messages } = req.body || {};
    if (!Array.isArray(messages)) return res.status(400).json({ error: 'messages' });

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: system || '',
        messages
      })
    });
    const data = await r.json();
    if (!r.ok) return res.status(502).json({ error: 'upstream', detail: data });

    const text = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text).join('\n').trim();
    return res.status(200).json({ text });
  } catch (e){
    return res.status(500).json({ error: 'server', detail: String(e) });
  }
}
