// Vercel Serverless Function - 旅團配置 API v2.1 (uses shared registry)
const { getTroopsRegistry } = require('./_lib/registry');

function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'OPTIONS') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  try {
    const troops = getTroopsRegistry();
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(200).json({
      troops,
      _note: 'backend from troops.json public, apikey from TROOP_{ID}_APIKEY env var anti-crawler, human protected by login token; frontend should use troopId only and go via /api/proxy for GAS calls'
    });
  } catch (e) {
    console.error('troops api error', e.message);
    res.setHeader('Cache-Control', 'no-store');
    res.status(500).json({ success: false, error: 'Failed to load troops registry' });
  }
}

module.exports = handler;
