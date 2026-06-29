// /api/kb — serves project knowledge to authenticated clients.
// Returns meeting SUMMARIES only (for the meetings tab). Transcripts and the
// WhatsApp history are never sent to the browser — they stay server-side and
// are used only by /api/brain to build Claude's context.
//
// GET  with header x-portal-token  ->  { meetings: [ {id,title,date,url,summary} ] }

const { MEETINGS } = require('../projectData');

function cors(res){
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-portal-token');
}
function clientFor(token){
  try{ const map = JSON.parse(process.env.CLIENTS || '{}'); return map[token] || null; }
  catch(e){ return null; }
}

module.exports = async function handler(req, res){
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET')     return res.status(405).json({ error: 'method' });

  const token = req.headers['x-portal-token'];
  if (!clientFor(token)) return res.status(401).json({ error: 'unauthorized' });

  // Summaries only — strip transcripts before they ever leave the server.
  const meetings = MEETINGS.map(m => ({
    id: m.id, title: m.title, date: m.date, url: m.url, summary: m.summary || ''
  }));
  return res.status(200).json({ meetings });
};
