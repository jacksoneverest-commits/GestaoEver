const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { ESTADO_PATH } = require('../../jobs/agendarJobsDiarios');

const SCRIPT_ROTINA_DIARIA = path.resolve(__dirname, '../../jobs/agendarJobsDiarios.js');

// Estado em memória da atualização disparada pela API. Só uma por vez (a rotina é idempotente por
// upsert, mas duas em paralelo disputariam o mesmo banco do ERP à toa).
let estado = novoEstado();

function novoEstado() {
  return { situacao: 'ocioso', iniciadoEm: null, finalizadoEm: null };
}

function lerUltimaAtualizacao() {
  try {
    const registro = JSON.parse(fs.readFileSync(ESTADO_PATH, 'utf8'));
    return registro && registro.ultimaExecucaoOk ? registro.ultimaExecucaoOk : null;
  } catch {
    return null; // nunca rodou, ou arquivo ausente/corrompido
  }
}

function obterStatus() {
  return { ...estado, ultimaAtualizacao: lerUltimaAtualizacao() };
}

function finalizar(situacao) {
  if (estado.situacao !== 'rodando') return; // 'error' e 'exit' podem disparar os dois
  estado = { ...estado, situacao, finalizadoEm: new Date().toISOString() };
}

// Dispara a mesma rotina do job diário (agendarJobsDiarios.js) em um processo node separado — os jobs
// fecham a pool de conexão ao terminar, então nunca rodam dentro do processo da API. Se já houver uma
// em andamento, não dispara outra e devolve o status atual.
function iniciarAtualizacao() {
  if (estado.situacao === 'rodando') return obterStatus();

  estado = { situacao: 'rodando', iniciadoEm: new Date().toISOString(), finalizadoEm: null };
  try {
    const filho = spawn(process.execPath, [SCRIPT_ROTINA_DIARIA], { stdio: 'ignore', windowsHide: true });
    filho.on('error', () => finalizar('falha'));
    filho.on('exit', (codigo) => finalizar(codigo === 0 ? 'ok' : 'falha'));
  } catch {
    finalizar('falha');
  }
  return obterStatus();
}

// Só para testes.
function reiniciarEstado() {
  estado = novoEstado();
}

module.exports = { iniciarAtualizacao, obterStatus, reiniciarEstado };
