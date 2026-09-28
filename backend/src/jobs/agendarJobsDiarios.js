// Orquestrador diário dos jobs de cache (PLAN.md, decisão do usuário 2026-09-26/27).
//
// Roda, em sequência, os dois jobs que mantêm os caches de leitura em dia:
//   1) job:cache-vendas    (vendasPeriodoCache.job.js)  -> vendas_periodo_cache (por dia)
//   2) job:cache-produtos  (vendasProdutoCache.job.js)  -> vendas_produto_dia_cache + primeira_venda_produto
//
// Por que existe: cada job, sozinho, só recalcula uma janela recente (7 ou 31 dias). Se o
// agendador não rodar por vários dias (computador desligado, falha), dias mais antigos ficam
// "abertos" e crescimento/queda/novos/estoque/demanda respondem 503 até alguém rodar com --desde
// manualmente. Este script decide sozinho quando precisa de --desde, olhando a última execução
// bem-sucedida registrada em ESTADO_PATH.
//
// Cada job roda em um PROCESSO NODE SEPARADO (não via require() direto): os dois fecham a pool de
// conexão ao final (pool.end(), no finally de executarCli), e essa pool é um singleton em
// db/connection.js compartilhado por todo o processo Node — chamar os dois jobs no mesmo processo
// faria o segundo receber uma pool já encerrada. Processos separados evitam isso e reproduzem
// exatamente `npm run job:cache-vendas` / `job:cache-produtos`.
//
// Uso:
//   node src/jobs/agendarJobsDiarios.js
//   npm run job:diario   (a partir de backend/)
//
// Agendamento (Windows, Agendador de Tarefas): ver backend/scripts/agendar-tarefa-windows.md.
// Escreve no banco do ERP (via os dois jobs) — mesma regra deles: só rodar com confirmação do
// usuário no ambiente alvo (dev/produção). Nunca falha "silenciosamente": sempre grava uma linha
// no log, e o exit code reflete o resultado (0 = os dois OK; 1 = algum falhou).

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const RAIZ_BACKEND = path.resolve(__dirname, '../..');
const DIR_ESTADO = path.join(RAIZ_BACKEND, 'estado-jobs');
const ESTADO_PATH = path.join(DIR_ESTADO, 'ultima-execucao.json');
const LOG_PATH = path.join(DIR_ESTADO, 'jobs-diarios.log');

// Se a última execução bem-sucedida for mais antiga que isso, assume que podem ter ficado dias
// sem fechar e pede --desde ao job de produto (que só reprocessa dias ainda não fechados, então é
// barato repetir). 2 dias de folga sobre a janela de recálculo normal (que já cobre 7 dias).
const LIMITE_DIAS_SEM_RODAR_PARA_DESDE = 2;
const JANELA_DESDE_DIAS = 30;

function hojeLocalIso(agora = new Date()) {
  const ano = agora.getFullYear();
  const mes = String(agora.getMonth() + 1).padStart(2, '0');
  const dia = String(agora.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

function somarDias(dataIso, quantidade) {
  const [ano, mes, dia] = dataIso.split('-').map(Number);
  const data = new Date(ano, mes - 1, dia + quantidade);
  return hojeLocalIso(data);
}

function lerEstado() {
  try {
    return JSON.parse(fs.readFileSync(ESTADO_PATH, 'utf8'));
  } catch (erro) {
    return null; // primeira execução, ou arquivo corrompido/ausente: trata como "nunca rodou"
  }
}

function gravarEstado(estado) {
  fs.mkdirSync(DIR_ESTADO, { recursive: true });
  fs.writeFileSync(ESTADO_PATH, JSON.stringify(estado, null, 2));
}

function logar(linha) {
  fs.mkdirSync(DIR_ESTADO, { recursive: true });
  const carimbo = new Date().toISOString();
  fs.appendFileSync(LOG_PATH, `[${carimbo}] ${linha}\n`);
}

function decidirDesde(estado, hoje) {
  if (!estado || !estado.ultimaExecucaoOk) {
    return somarDias(hoje, -JANELA_DESDE_DIAS);
  }
  const diasParados = Math.round(
    (new Date(hoje).getTime() - new Date(estado.ultimaExecucaoOk).getTime()) / (24 * 60 * 60 * 1000)
  );
  if (diasParados >= LIMITE_DIAS_SEM_RODAR_PARA_DESDE) {
    return somarDias(hoje, -JANELA_DESDE_DIAS);
  }
  return null; // rodou recentemente: recálculo normal da janela basta
}

// Roda `node <caminhoScript> [argv]` como processo filho, herdando stdout/stderr para o console
// (o Agendador de Tarefas os captura se configurado) e devolvendo o exit code.
function rodarScriptFilho(caminhoScript, argv) {
  return new Promise((resolve) => {
    const processo = spawn(process.execPath, [caminhoScript, ...argv], {
      cwd: RAIZ_BACKEND,
      stdio: 'inherit',
    });
    processo.on('error', () => resolve(1)); // ex.: node não encontrado — trata como falha
    processo.on('exit', (codigo) => resolve(codigo === null ? 1 : codigo));
  });
}

async function rodarJob(nome, caminhoScript, argv) {
  const codigo = await rodarScriptFilho(caminhoScript, argv);
  if (codigo !== 0) {
    logar(`${nome}: terminou com código ${codigo} (argv: ${JSON.stringify(argv)}).`);
    return false;
  }
  logar(`${nome}: OK (argv: ${JSON.stringify(argv)}).`);
  return true;
}

async function main() {
  const hoje = hojeLocalIso();
  const estadoAnterior = lerEstado();
  const desde = decidirDesde(estadoAnterior, hoje);

  logar(`Início da rotina diária. desde=${desde || '(nenhum; recálculo normal da janela)'}`);

  const argv = desde ? ['--desde', desde] : [];
  const okVendas = await rodarJob(
    'job:cache-vendas',
    path.join(__dirname, 'vendasPeriodoCache.job.js'),
    argv
  );
  const okProdutos = await rodarJob(
    'job:cache-produtos',
    path.join(__dirname, 'vendasProdutoCache.job.js'),
    argv
  );

  const sucesso = okVendas && okProdutos;
  gravarEstado({
    ultimaExecucaoTentativa: hoje,
    ultimaExecucaoOk: sucesso ? hoje : (estadoAnterior && estadoAnterior.ultimaExecucaoOk) || null,
  });
  logar(`Fim da rotina diária. Resultado: ${sucesso ? 'OK' : 'COM FALHA'}.`);
  return sucesso ? 0 : 1;
}

if (require.main === module) {
  main()
    .then((codigo) => {
      process.exitCode = codigo;
    })
    .catch((erro) => {
      logar(`Falha inesperada não tratada (código: ${erro && erro.code ? erro.code : 'desconhecido'}).`);
      process.exitCode = 1;
    });
}

module.exports = { main, decidirDesde, hojeLocalIso, somarDias };
