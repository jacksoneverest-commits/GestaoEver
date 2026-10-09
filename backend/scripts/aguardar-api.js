// Espera a API responder em /health. Uso: node scripts/aguardar-api.js <porta> [timeoutSegundos=60]
// Exit code 0 = API no ar; 1 = não respondeu a tempo. Usado pelo instalador antes da carga inicial.
const http = require('http');

const porta = Number(process.argv[2]);
const timeoutMs = (Number(process.argv[3]) || 60) * 1000;

if (!Number.isInteger(porta) || porta < 1 || porta > 65535) {
  console.error('Uso: node scripts/aguardar-api.js <porta> [timeoutSegundos]');
  process.exit(1);
}

const limite = Date.now() + timeoutMs;

function tentar() {
  const req = http.get({ host: '127.0.0.1', port: porta, path: '/health', timeout: 2000 }, (res) => {
    res.resume();
    if (res.statusCode === 200) process.exit(0);
    repetir();
  });
  req.on('timeout', () => req.destroy());
  req.on('error', repetir);
}

function repetir() {
  if (Date.now() >= limite) {
    console.error('A API não respondeu a tempo.');
    process.exit(1);
  }
  setTimeout(tentar, 1000);
}

tentar();
