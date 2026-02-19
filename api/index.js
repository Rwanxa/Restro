const { app, ensureInitialized } = require('../server');

module.exports = async (req, res) => {
  await ensureInitialized();
  return app(req, res);
};
