const path = require('path');
// Caminho absoluto: a tarefa agendada do Windows roda com outro diretório corrente.
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const createApp = require('./app');

const PORT = process.env.PORT || 3001;
const app = createApp();

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
