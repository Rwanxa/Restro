const { app, ensureInitialized } = require('../server');

module.exports = async (req, res) => {
  try {
    if (req.url && req.url.startsWith('/api/')) {
      await ensureInitialized();
    }
    return app(req, res);
  } catch (err) {
    console.error('Serverless handler error:', err);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(
      JSON.stringify({
        error: 'INTERNAL_SERVER_ERROR',
        message: err?.message || 'Unknown error',
        code: err?.code,
      })
    );
  }
};
