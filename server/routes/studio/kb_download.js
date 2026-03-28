const { getUserFromJwt } = require('../../lib/supabase');
const { readSettings, normalizeUrl } = require('../../services/quickbaseSync');

/**
 * Knowledge Base Download Proxy
 * Proxies requests to Quickbase to handle authentication and direct downloads.
 */
module.exports = async (req, res) => {
  try {
    // 1. Authenticate the MUMS user
    const auth = req.headers.authorization || '';
    const jwt = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const user = await getUserFromJwt(jwt);
    if (!user) {
      res.statusCode = 401;
      return res.end('Unauthorized');
    }

    // 2. Validate the target URL
    const src = req.query && req.query.url ? String(req.query.url) : '';
    const settingsOut = await readSettings();
    const realm = settingsOut.ok && settingsOut.settings ? settingsOut.settings.quickbaseRealm : '';
    const safeUrl = normalizeUrl(src, realm);

    if (!safeUrl) {
      res.statusCode = 400;
      return res.end('Invalid URL');
    }

    const u = new URL(safeUrl);
    if (!/\.quickbase\.com$/i.test(u.hostname)) {
      res.statusCode = 400;
      return res.end('Invalid host');
    }

    // 3. Proxy the request to Quickbase with User Token
    const token = settingsOut.ok && settingsOut.settings ? settingsOut.settings.quickbaseUserToken : '';
    
    const qbResp = await fetch(safeUrl, {
      headers: {
        'QB-Realm-Hostname': realm,
        'Authorization': `QB-USER-TOKEN ${token}`
      }
    });

    if (!qbResp.ok) {
      res.statusCode = qbResp.status || 502;
      return res.end('Download failed from Quickbase');
    }

    // 4. Stream the response back to the client
    const body = Buffer.from(await qbResp.arrayBuffer());
    
    res.statusCode = 200;
    res.setHeader('Content-Type', qbResp.headers.get('content-type') || 'application/octet-stream');
    res.setHeader('Content-Disposition', qbResp.headers.get('content-disposition') || 'attachment');
    res.setHeader('Cache-Control', 'no-store');
    
    return res.end(body);
  } catch (err) {
    console.error('[KB_DOWNLOAD_ERROR]', err);
    res.statusCode = 500;
    return res.end('Internal server error');
  }
};
