require('dotenv').config();
const createApp = require('./app');

const PORT = process.env.PORT || 3001;
const app = createApp();

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
