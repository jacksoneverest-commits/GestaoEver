// Task 13.3 do PLAN.md: as quatro rotas que precisam da quantidade vendida por produto no período
// (GET /api/estoque/niveis, /cobertura, /parados e GET /api/ranking-produtos/demanda-baixo-estoque) leem o
// cache `vendas_produto_dia_cache` em vez de agregar vendaitem/vendacupom. Este arquivo cobre o comportamento
// COMUM às quatro rotas (os testes críticos da task têm exatamente um `it` cada, com laço sobre as rotas);
// as regras próprias de cada rota continuam nos testes do respectivo controller.
// Banco sempre mockado.

jest.mock('../../../src/db/connection', () => ({ getPool: jest.fn() }));

const express = require('express');
const request = require('supertest');
const { getPool } = require('../../../src/db/connection');
const { buildPeriodFilter } = require('../../../src/shared/queryFilters');
const { listarDias } = require('../../../src/jobs/jobsComum');
const estoqueRouter = require('../../../src/modules/estoque/estoque.routes');
const estoqueCoberturaRouter = require('../../../src/modules/estoque/estoqueCobertura.routes');
const rankingEspeciaisRouter = require('../../../src/modules/rankingProdutos/rankingEspeciais.routes');

const PERIODO = { inicio: '2026-09-01', fim: '2026-09-30' };
const DIAS_DO_PERIODO = listarDias(PERIODO.inicio, PERIODO.fim);
const RUIDO = 16.689999999999998;

const ehCobertura = (sql) => sql.includes('atualizado_em >=');
const ehResumo = (sql) => sql.includes('SUM(CASE');
const ehTotal = (sql) => /COUNT\(\*\)/.test(sql);

// Uma linha de dados por rota, com `quantidadeVendida` cheia de ruído de ponto flutuante quando a rota a devolve.
const ROTAS = [
  {
    nome: 'niveis',
    url: '/api/estoque/niveis',
    linha: { id: 1, nome: 'A', estoqueAtual: 0, estoqueMinimo: 5, estoqueMaximo: null, quantidadeVendida: RUIDO, coberturaDias: 0 },
  },
  {
    nome: 'cobertura',
    url: '/api/estoque/cobertura',
    linha: { id: 1, nome: 'A', estoqueAtual: 10, quantidadeVendida: RUIDO, coberturaDias: 18 },
  },
  {
    nome: 'parados',
    url: '/api/estoque/parados',
    linha: { id: 1, nome: 'A', estoqueAtual: 10, custoUnitario: 2, valorParado: 20 },
    semQuantidadeVendida: true,
  },
  {
    nome: 'demanda-baixo-estoque',
    url: '/api/ranking-produtos/demanda-baixo-estoque',
    linha: { id: 1, nome: 'A', quantidadeVendida: RUIDO, estoqueAtual: 0, estoqueMinimo: 5, estoqueMaximo: null, coberturaDias: 0 },
  },
];
const ROTAS_COM_QUANTIDADE = ROTAS.filter((rota) => !rota.semQuantidadeVendida);

describe('Task 13.3 - rotas de estoque e de alta demanda lendo vendas_produto_dia_cache', () => {
  let execute;
  let errorSpy;
  let app;

  // Só o Date é falso: supertest/http precisam dos timers reais.
  const NAO_FALSIFICAR = [
    'hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
    'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval',
    'setTimeout', 'clearTimeout',
  ];
  function fixarHoje(ano, mes, dia) {
    jest.useFakeTimers({ now: new Date(ano, mes - 1, dia, 12, 0, 0), doNotFake: NAO_FALSIFICAR });
  }

  // Cobertura (sentinelas fechadas), resumo, totais e lista são consultas distintas; o mock responde pelo SQL.
  function mockar(rota, { dias = DIAS_DO_PERIODO, linhas = [rota.linha] } = {}) {
    execute.mockImplementation(async ({ sql }) => {
      if (ehCobertura(sql)) return [dias.map((dia) => ({ dia })), []];
      if (ehResumo(sql)) return [[{ ruptura: 1, proximoRuptura: 0, excesso: 0 }], []];
      if (ehTotal(sql)) return [[{ totalItens: linhas.length, valorTotalParado: 20 }], []];
      return [linhas, []];
    });
  }
  const consultasDeDados = () => execute.mock.calls.filter(([{ sql }]) => !ehCobertura(sql));
  const consultaCobertura = () => execute.mock.calls.find(([{ sql }]) => ehCobertura(sql));
  const chamar = (rota, query = PERIODO) => request(app).get(rota.url).query(query);

  beforeEach(() => {
    fixarHoje(2026, 10, 15);
    execute = jest.fn();
    getPool.mockReturnValue({ execute });
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    app = express();
    app.use('/api/estoque', estoqueRouter);
    app.use('/api/estoque', estoqueCoberturaRouter);
    app.use('/api/ranking-produtos', rankingEspeciaisRouter);
  });

  afterEach(() => {
    jest.useRealTimers();
    errorSpy.mockRestore();
    getPool.mockReset();
  });

  // Testes críticos (PLAN.md, Task 13.3): exatamente um it cada, com laço sobre as rotas.
  it('As rotas de estoque e a de alta demanda somam a quantidade vendida a partir de vendas_produto_dia_cache, sem consultar vendaitem, vendacupom nem flagvc', async () => {
    for (const rota of ROTAS) {
      execute.mockReset();
      mockar(rota);

      const res = await chamar(rota);

      expect([rota.nome, res.status]).toEqual([rota.nome, 200]);
      const dados = consultasDeDados();
      expect(dados.length).toBeGreaterThan(0);
      // a soma vem do cache: SUM(quantidade) por produto em vendas_produto_dia_cache
      expect(dados.some(([{ sql }]) => /FROM vendas_produto_dia_cache/.test(sql) && /SUM\(quantidade\) AS quantidadeVendida/.test(sql))).toBe(true);
      // nenhuma consulta (dados nem cobertura) toca as tabelas transacionais nem flagvc
      for (const [{ sql }] of execute.mock.calls) {
        expect(sql).not.toMatch(/vendaitem|vendacupom|flagvc/i);
      }
    }
  });

  it('Quando o cache não cobre todos os dias fechados do período, essas rotas respondem 503 com mensagem clara', async () => {
    for (const rota of ROTAS) {
      execute.mockReset();
      mockar(rota, { dias: DIAS_DO_PERIODO.filter((dia) => dia !== '2026-09-12' && dia !== '2026-09-13') });

      const res = await chamar(rota);

      expect([rota.nome, res.status]).toEqual([rota.nome, 503]);
      expect(res.body).toEqual({ erro: expect.stringMatching(/cache/i) });
      expect(res.body.erro).toContain('npm run job:cache-produtos -- --desde 2026-09-12');
      expect(res.body.erro).toMatch(/faltam 2 dia\(s\)/);
      // sem resultado parcial: nenhuma consulta de dados foi feita, só a verificação de cobertura
      expect(consultasDeDados()).toEqual([]);
      expect(execute).toHaveBeenCalledTimes(1);
    }
  });

  it('quantidadeVendida sai arredondada a 3 casas (sem ruído de ponto flutuante como 16,689999999999998)', async () => {
    // parados não devolve quantidadeVendida (só estoque parado); as outras três rotas devolvem
    for (const rota of ROTAS_COM_QUANTIDADE) {
      execute.mockReset();
      mockar(rota);

      const res = await chamar(rota);

      expect([rota.nome, res.status]).toEqual([rota.nome, 200]);
      expect([rota.nome, res.body.itens[0].quantidadeVendida]).toEqual([rota.nome, 16.69]);
      expect(String(res.body.itens[0].quantidadeVendida)).not.toMatch(/\d{6,}/);
      // média diária segue com 2 casas (16.69 / 30 = 0.556...)
      if (res.body.itens[0].mediaDiaria !== undefined) expect(res.body.itens[0].mediaDiaria).toBe(0.56);
    }
  });

  // Extras (um it por comportamento; it.each sobre as quatro rotas)
  describe.each(ROTAS.map((rota) => [rota.nome, rota]))('%s', (_nome, rota) => {
    it('lê só produto > 0 (ignora a sentinela produto = 0), agrupa por produto e usa HAVING SUM(quantidade) > 0', async () => {
      mockar(rota);

      await chamar(rota);

      const [{ sql }] = consultasDeDados().find(([{ sql: s }]) => /FROM vendas_produto_dia_cache/.test(s));
      expect(sql).toMatch(/produto > 0/);
      expect(sql).toMatch(/GROUP BY produto/);
      expect(sql).toMatch(/HAVING SUM\(quantidade\) > 0/);
      // o cache já só tem vendas válidas: sem STRAIGHT_JOIN nem filtro de venda válida
      expect(sql).not.toMatch(/STRAIGHT_JOIN|Venda|status/);
    });

    it('filtra o período por dia >= ? AND dia <= ? com as datas ISO do período (parametrizadas, nunca concatenadas)', async () => {
      mockar(rota);

      await chamar(rota);

      for (const [{ sql }, params] of consultasDeDados().filter(([{ sql: s }]) => /FROM vendas_produto_dia_cache/.test(s))) {
        expect(sql).toContain('dia >= ? AND dia <= ?');
        expect(sql).not.toContain(PERIODO.inicio);
        expect(sql).not.toContain(PERIODO.fim);
        const posicao = params.indexOf(PERIODO.inicio);
        expect(posicao).toBeGreaterThanOrEqual(0);
        expect(params[posicao + 1]).toBe(PERIODO.fim);
      }
    });

    it('verifica a cobertura do cache no período efetivo (fim limitado a ontem) antes de qualquer consulta de dados', async () => {
      fixarHoje(2026, 9, 25);
      mockar(rota, { dias: listarDias('2026-09-01', '2026-09-24') });

      const res = await chamar(rota);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ inicio: '2026-09-01', fim: '2026-09-24', fimSolicitado: '2026-09-30' });
      const [{ sql }, params] = execute.mock.calls[0];
      expect(ehCobertura(sql)).toBe(true);
      expect(params).toEqual(buildPeriodFilter('2026-09-01', '2026-09-24').params);
      // as consultas de dados usam o mesmo período efetivo, em ISO
      for (const [, paramsDados] of consultasDeDados()) {
        const posicao = paramsDados.indexOf('2026-09-01');
        expect(paramsDados[posicao + 1]).toBe('2026-09-24');
      }
    });

    it('503 de cache incompleto não é logado como erro inesperado', async () => {
      mockar(rota, { dias: [] });

      const res = await chamar(rota);

      expect(res.status).toBe(503);
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('inicio a partir de hoje retorna 400 sem consultar o banco (nem a cobertura)', async () => {
      fixarHoje(2026, 9, 25);
      mockar(rota);

      const res = await chamar(rota, { inicio: '2026-09-25', fim: '2026-09-30' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ erro: expect.stringMatching(/fechado/i) });
      expect(execute).not.toHaveBeenCalled();
    });

    it('falha do banco na verificação de cobertura retorna 500 genérico, sem vazar SQL nem código, logando só o código', async () => {
      execute.mockRejectedValue(
        Object.assign(new Error("Table 'vendas_produto_dia_cache' doesn't exist SELECT ..."), { code: 'ER_NO_SUCH_TABLE' })
      );

      const res = await chamar(rota);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ erro: 'Erro interno.' });
      expect(JSON.stringify(res.body)).not.toMatch(/vendas_produto_dia_cache|SELECT|ER_NO_SUCH_TABLE/);
      expect(errorSpy).toHaveBeenCalled();
      expect(errorSpy.mock.calls.map((chamada) => chamada.join(' ')).join(' ')).not.toMatch(/SELECT|doesn't exist/);
    });
  });

  // Regra de negócio preservada: o cache não muda o filtro de bloqueados nem o de Estoque = 'N' (rotas de estoque;
  // a de alta demanda não filtra situacao nem Estoque por decisão do usuário) nem o de departamento.
  it.each(ROTAS.map((rota) => [rota.nome, rota]))('%s: filtros de bloqueados e de Estoque (só estoque) e de departamento parametrizado continuam valendo', async (_nome, rota) => {
    mockar(rota);

    const res = await chamar(rota, { ...PERIODO, nivel: 'grupo', id: '4' });

    expect(res.status).toBe(200);
    const comProduto = consultasDeDados().filter(([{ sql }]) => /produto\.idProduto/.test(sql));
    expect(comProduto.length).toBeGreaterThan(0);
    for (const [{ sql }, params] of comProduto) {
      if (rota.nome === 'demanda-baixo-estoque') {
        // decisão do usuário: alta demanda continua sem filtro de situação e sem filtro de Estoque
        expect(sql).not.toMatch(/situacao/);
        expect(sql).not.toMatch(/produto\.Estoque/);
      } else {
        expect(sql).toContain("COALESCE(produto.situacao, '') <> 'B'");
        expect(sql).toMatch(/COALESCE\(\s*produto\.Estoque\s*,\s*'S'\s*\)\s*(<>|!=)\s*'N'/);
      }
      expect(sql).toContain('produto.grupo = ?');
      expect(params).toContain(4);
    }
  });
});
