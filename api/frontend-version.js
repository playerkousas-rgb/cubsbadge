// Public frontend build metadata only. Never reads the troop registry, GAS, or credentials.
const release = require('../data/frontend-release.json');

module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, max-age=0, must-revalidate');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method && req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (req.method === 'HEAD') return res.status(200).end();
  return res.status(200).json({ app: release.app, build: release.build });
};
