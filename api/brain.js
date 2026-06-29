// /api/brain — proxies chat to Claude, keeping the API key AND the private
// project knowledge on the server. The browser sends only the conversation;
// the full context (facts + meeting summaries + transcripts + WhatsApp) is
// assembled here, so none of it is downloadable from the static site.
//
// POST { messages:[{role,content}] }  with header  x-portal-token
// Env: ANTHROPIC_API_KEY , CLIENTS

const { FACTS, MEETINGS, WHATSAPP } = require('../projectData');

function cors(res){
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-portal-token');
}
function clientFor(token){
  try{ const map = JSON.parse(process.env.CLIENTS || '{}'); return map[token] || null; }
  catch(e){ return null; }
}

function buildKB(){
  let kb = 'אתה "המוח" — עוזר חכם של פרויקט בנייה למגורים. ענה תמיד בעברית, בצורה ברורה ולעניין. '
    + 'אם המידע נמצא בנתוני הפרויקט שלהלן — בסס עליו את התשובה. לשאלות כלליות שאינן על הפרויקט, השתמש בידע הכללי שלך וציין בקצרה שזה אינו מתוך נתוני הפרויקט.\n\n'
    + '== נתוני הפרויקט ==\n' + FACTS;
  const wc = MEETINGS.filter(m => m.summary || m.transcript);
  if (wc.length){
    kb += '\n== פגישות ==\n';
    wc.forEach(m => {
      kb += '\n[פגישה ' + m.date + ' — ' + m.title + ']\n'
          + (m.summary ? 'סיכום: ' + m.summary + '\n' : '')
          + (m.transcript ? 'תמלול: ' + m.transcript + '\n' : '');
    });
  }
  if (WHATSAPP) kb += '\n== התכתבות קבוצת הוואטסאפ (אמיר, עדן, אהרון) ==\n' + WHATSAPP + '\n';
  return kb;
}

module.exports = async function handler(req, res){
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'method' });

  // Only known client tokens may use the brain (prevents anonymous API abuse).
  const token = req.headers['x-portal-token'];
  if (!clientFor(token)) return res.status(401).json({ error: 'unauthorized' });

  try{
    const { messages } = req.body || {};
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
        system: buildKB(),
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
};
