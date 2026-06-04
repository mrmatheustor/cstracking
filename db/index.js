const { initDatabase } = require('./init');

let dbApi = null;

async function getDb() {
  if (!dbApi) {
    dbApi = await initDatabase();
  }
  return dbApi;
}

module.exports = { getDb };
