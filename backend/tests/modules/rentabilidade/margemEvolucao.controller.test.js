jest.mock('../../../src/db/connection', () => ({ getPool: jest.fn() }));

const express = require('express');
const request = require('supertest');
const { getPool } = require('../../../src/db/connection');
const { TIMEOUT_CONSULTA_MS } = require('../../../src/shared/timeoutConsulta');
const { buildPeriodFilter, buildDepartmentFilter } = require('../../../src/shared/queryFilters');
const { listarDias } = require('../../../src/jobs/jobsComum');
const margemEvolucaoRouter = require('../../../src/modules/rentabilidade/margemEvolucao.routes');

const BASE = '/api/rentabilidade';
// Cache diário: todos os dias envolvidos nos testes têm a sentinela fechada (padrão Task 13.3/cacheProduto.js).
const DIAS_COBERTOS = listarDias('2026-06-01', '2026-09-30');

function montarApp() {
  const app = express();
  app.use(BASE, margemEvolucaoRouter);
  return app;
}

describe('margemEvolucao (evolucao, abaixo-minimo)', () => {
  let execute;
  let errorSpy;
  let app;

  const NAO_FALSIFICAR = [
    'hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
    'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval',
    'setTimeout', 'clearTimeout',
  ];
  function fixarHoje(ano, mes, dia) {
    jest.useFakeTimers({ now: new Date(ano, mes - 1, dia, 12, 0, 0), doNotFake: NAO_FALSIFICAR });
  }

  const ehCobertura = (sql) => sql.includes('atualizado_em >=');
  const consultaDados = () => execute.mock.calls.find(([{ sql }]) => !ehCobertura(sql));
  const consultasDeDados = () => execute.mock.calls.filter(([{ sql }]) => !ehCobertura(sql));

  // A verificação de cobertura do cache vem primeiro; a consulta de dados é a segunda chamada ao pool.
  function mockar({ linhas = [], dias = DIAS_COBERTOS } = {}) {
    execute.mockImplementation(async ({ sql }) => {
      if (ehCobertura(sql)) return [dias.map((dia) => ({ dia })), []];
      return [linhas, []];
    });
  }

  beforeEach(() => {
    fixarHoje(2026, 10, 15);
    execute = jest.fn();
    getPool.mockReturnValue({ execute });
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    app = montarApp();
  });

  afterEach(() => {
    jest.useRealTimers();
    errorSpy.mockRestore();
    getPool.mockReset();
  });

  describe('/evolucao', () => {
    const PERIODO = { inicio: '2026-09-01', fim: '2026-09-30' };
    const chamar = (query = PERIODO) => request(app).get(`${BASE}/evolucao`).query(query);

    // Teste crítico 1 (PLAN.md, Task 11.2)
    it('retorna a margem agregada por período (por mês) em ordem cronológica', async () => {
      mockar({
        linhas: [
          { periodo: '2026-07', faturamento: '1000.0000', custoTotal: '600.0000', itensSemCusto: 0 },
          { periodo: '2026-09', faturamento: '2000.0000', custoTotal: '1200.0000', itensSemCusto: 0 },
          { periodo: '2026-08', faturamento: '1500.0000', custoTotal: '900.0000', itensSemCusto: 0 },
        ],
      });

      const res = await chamar({ inicio: '2026-07-01', fim: '2026-09-30' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        inicio: '2026-07-01',
        fim: '2026-09-30',
        fimSolicitado: '2026-09-30',
        itens: [
          { periodo: '2026-07', faturamento: 1000, custoTotal: 600, lucro: 400, margemPercentual: 40, semCusto: false },
          { periodo: '2026-08', faturamento: 1500, custoTotal: 900, lucro: 600, margemPercentual: 40, semCusto: false },
          { periodo: '2026-09', faturamento: 2000, custoTotal: 1200, lucro: 800, margemPercentual: 40, semCusto: false },
        ],
      });
    });

    // Comportamento de ordem cronológica isolado do banco: mesmo que o SELECT devolva linhas fora de ordem
    // (não confia só no ORDER BY do SQL), a resposta é sempre ordenada pelo próprio serviço.
    it('mantém ordem cronológica mesmo quando o banco devolve os meses fora de ordem, e nunca pula um mês do intervalo', async () => {
      mockar({
        linhas: [
          { periodo: '2026-09', faturamento: '100.0000', custoTotal: '50.0000', itensSemCusto: 0 },
          { periodo: '2026-07', faturamento: '200.0000', custoTotal: '100.0000', itensSemCusto: 0 },
          // 2026-08 não tem nenhuma linha no cache (mês sem venda) — não pode ser pulado.
        ],
      });

      const res = await chamar({ inicio: '2026-07-01', fim: '2026-09-30' });

      expect(res.status).toBe(200);
      expect(res.body.itens.map((item) => item.periodo)).toEqual(['2026-07', '2026-08', '2026-09']);
      // Mês sem dado: zeros, sem inventar valor, custoTotal null (não há dado, não é custo zero conhecido).
      expect(res.body.itens[1]).toEqual({
        periodo: '2026-08', faturamento: 0, custoTotal: null, lucro: 0, margemPercentual: 0, semCusto: false,
      });
    });

    it('semCusto não anula faturamento/custoTotal/lucro: os valores parciais continuam aparecendo, só o aviso é sinalizado', async () => {
      mockar({
        linhas: [{ periodo: '2026-09', faturamento: '1000.0000', custoTotal: '300.0000', itensSemCusto: 4 }],
      });

      const res = await chamar();

      expect(res.body.itens[0]).toEqual({
        periodo: '2026-09', faturamento: 1000, custoTotal: 300, lucro: 700, margemPercentual: 70, semCusto: true,
      });
    });

    it('mês em que nenhum item tem custo (custoTotal NULL do banco): lucro usa custo 0, sem quebrar', async () => {
      mockar({
        linhas: [{ periodo: '2026-09', faturamento: '500.0000', custoTotal: null, itensSemCusto: 3 }],
      });

      const res = await chamar();

      expect(res.body.itens[0]).toEqual({
        periodo: '2026-09', faturamento: 500, custoTotal: null, lucro: 500, margemPercentual: 100, semCusto: true,
      });
    });

    it('a consulta lê só vendas_produto_dia_cache com produto > 0, nunca vendaitem, vendacupom ou flagvc', async () => {
      mockar();

      await chamar();

      const [{ sql, timeout }, params] = consultaDados();
      expect(timeout).toBe(TIMEOUT_CONSULTA_MS);
      expect(sql).toContain('FROM vendas_produto_dia_cache');
      expect(sql).toMatch(/produto > 0/);
      expect(sql).toContain("DATE_FORMAT(vendas_produto_dia_cache.dia, '%Y-%m')");
      expect(sql).not.toMatch(/vendaitem|vendacupom|flagvc|STRAIGHT_JOIN/);
      expect(sql).toContain('dia >= ? AND');
      expect(sql).toContain('dia <= ?');
      expect(params).toEqual([PERIODO.inicio, PERIODO.fim]);
    });

    it('filtro de departamento (nivel + id) é opcional e, quando informado, filtra via JOIN com produto, parametrizado', async () => {
      mockar();

      const res = await chamar({ ...PERIODO, nivel: 'setor', id: '7' });

      expect(res.status).toBe(200);
      const departamento = buildDepartmentFilter({ nivel: 'setor', id: '7' });
      const [{ sql }, params] = consultaDados();
      expect(sql).toMatch(/INNER JOIN produto ON produto\.idProduto = vendas_produto_dia_cache\.produto/);
      expect(sql).toContain(departamento.clause);
      expect(params).toEqual([PERIODO.inicio, PERIODO.fim, ...departamento.params]);
    });

    it('sem departamento, não há JOIN com produto', async () => {
      mockar();

      await chamar();

      const [{ sql }] = consultaDados();
      expect(sql).not.toMatch(/JOIN produto/);
    });

    it('fim no futuro é limitado a ontem; a resposta traz fim efetivo e fimSolicitado', async () => {
      fixarHoje(2026, 9, 25);
      mockar({ dias: listarDias('2026-08-01', '2026-09-24'), linhas: [] });

      const res = await chamar(PERIODO);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ inicio: '2026-09-01', fim: '2026-09-24', fimSolicitado: '2026-09-30' });
      const [, params] = consultaDados();
      expect(params).toEqual(['2026-09-01', '2026-09-24']);
      expect(execute.mock.calls[0][1]).toEqual(buildPeriodFilter('2026-09-01', '2026-09-24').params);
    });

    it('inicio a partir de hoje (nenhum dia fechado) retorna 400 { erro } claro, sem consultar o banco', async () => {
      fixarHoje(2026, 9, 25);

      const res = await chamar({ inicio: '2026-09-25', fim: '2026-09-30' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ erro: expect.stringMatching(/fechado/i) });
      expect(execute).not.toHaveBeenCalled();
    });

    it('quando o cache não cobre todo o período efetivo, responde 503 { erro } antes de consultar os dados, sem log de erro inesperado', async () => {
      execute.mockImplementation(async ({ sql }) => {
        if (ehCobertura(sql)) return [[], []]; // nenhum dia coberto
        throw new Error('não deveria consultar dados sem o cache coberto');
      });

      const res = await chamar();

      expect(res.status).toBe(503);
      expect(res.body).toEqual({ erro: expect.any(String) });
      expect(execute).toHaveBeenCalledTimes(1);
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  describe('/abaixo-minimo', () => {
    const PERIODO = { inicio: '2026-09-01', fim: '2026-09-30', minimo: '20' };
    const chamar = (query = PERIODO) => request(app).get(`${BASE}/abaixo-minimo`).query(query);

    // Teste crítico 2 (PLAN.md, Task 11.2)
    it('lista apenas produtos cuja margem calculada é inferior ao minimo informado', async () => {
      mockar({
        linhas: [
          { id: 1, nome: 'MARGEM BOA', faturamento: '1000.0000', custoTotal: '400.0000', itensSemCusto: 0 }, // 60%
          { id: 2, nome: 'MARGEM RUIM', faturamento: '1000.0000', custoTotal: '900.0000', itensSemCusto: 0 }, // 10%
          { id: 3, nome: 'MARGEM NO LIMITE', faturamento: '1000.0000', custoTotal: '800.0000', itensSemCusto: 0 }, // 20% (não é < 20)
        ],
      });

      const res = await chamar({ ...PERIODO, minimo: '20' });

      expect(res.status).toBe(200);
      expect(res.body.itens).toEqual([
        { id: 2, nome: 'MARGEM RUIM', faturamento: 1000, custoTotal: 900, lucro: 100, margemPercentual: 10, semCusto: false },
      ]);
      expect(res.body.totalItens).toBe(1);
    });

    it('ordena por margemPercentual ascendente (pior primeiro), desempate por id, e aplica o limite depois de filtrar/ordenar', async () => {
      mockar({
        linhas: [
          { id: 20, nome: 'B', faturamento: '1000.0000', custoTotal: '950.0000', itensSemCusto: 0 }, // 5%
          { id: 10, nome: 'A', faturamento: '1000.0000', custoTotal: '950.0000', itensSemCusto: 0 }, // 5% (empate, id menor primeiro)
          { id: 30, nome: 'C', faturamento: '1000.0000', custoTotal: '990.0000', itensSemCusto: 0 }, // 1%
        ],
      });

      const res = await chamar({ ...PERIODO, minimo: '50', limite: '2' });

      expect(res.status).toBe(200);
      expect(res.body.totalItens).toBe(3); // total antes do limite
      expect(res.body.limite).toBe(2);
      expect(res.body.itens.map((item) => item.id)).toEqual([30, 10]);
    });

    it('semCusto não anula os valores: produto com custo parcial mantém faturamento/custoTotal/lucro calculados', async () => {
      mockar({
        linhas: [{ id: 5, nome: 'PARCIAL', faturamento: '1000.0000', custoTotal: '900.0000', itensSemCusto: 2 }],
      });

      const res = await chamar({ ...PERIODO, minimo: '50' });

      expect(res.body.itens[0]).toEqual({
        id: 5, nome: 'PARCIAL', faturamento: 1000, custoTotal: 900, lucro: 100, margemPercentual: 10, semCusto: true,
      });
    });

    it('minimo ausente ou inválido retorna 400 sem consultar o banco', async () => {
      for (const minimo of [undefined, '', 'abc', 'NaN', '2000', '-2000']) {
        const query = { ...PERIODO };
        if (minimo === undefined) delete query.minimo;
        else query.minimo = minimo;

        const res = await request(app).get(`${BASE}/abaixo-minimo`).query(query);

        expect(res.status).toBe(400);
        expect(res.body).toEqual({ erro: expect.stringMatching(/minimo/i) });
      }
      expect(execute).not.toHaveBeenCalled();
    });

    it('minimo aceita casas decimais e valores negativos', async () => {
      mockar({
        linhas: [{ id: 1, nome: 'X', faturamento: '1000.0000', custoTotal: '1050.0000', itensSemCusto: 0 }], // -5%
      });

      const res = await chamar({ ...PERIODO, minimo: '-2.5' });

      expect(res.status).toBe(200);
      expect(res.body.minimo).toBe(-2.5);
      expect(res.body.itens[0].margemPercentual).toBe(-5);
    });

    it('a consulta agrega por produto lendo só vendas_produto_dia_cache com produto > 0, sem vendaitem/vendacupom/flagvc', async () => {
      mockar();

      await chamar();

      const [{ sql, timeout }, params] = consultaDados();
      expect(timeout).toBe(TIMEOUT_CONSULTA_MS);
      expect(sql).toContain('FROM vendas_produto_dia_cache');
      expect(sql).toMatch(/produto > 0/);
      expect(sql).toContain('GROUP BY vendas_produto_dia_cache.produto');
      expect(sql).toMatch(/HAVING SUM\(vendas_produto_dia_cache\.faturamento\) > 0/);
      expect(sql).not.toMatch(/vendaitem|vendacupom|flagvc|STRAIGHT_JOIN/);
      expect(sql).toMatch(/LEFT\s+JOIN\s+produto\s+ON\s+produto\.idProduto\s*=\s*vendas_produto_dia_cache\.produto/i);
      expect(params).toEqual([PERIODO.inicio, PERIODO.fim]);
    });

    // Achado da revisão da Fase 11: produto removido do cadastro (migration 004, linhas 29-34) continua
    // com faturamento/custo no cache, mas some da lista com INNER JOIN produto. Mesmo padrão de
    // margem.service.js/curvaAbc.service.js: LEFT JOIN, nunca INNER JOIN.
    it('usa LEFT JOIN produto (nunca INNER JOIN): produto sem registro em `produto` continua na lista, com "Sem descrição"', async () => {
      mockar({
        linhas: [{ id: 1, nome: null, faturamento: '1000.0000', custoTotal: '900.0000', itensSemCusto: 0 }],
      });

      const res = await chamar({ ...PERIODO, minimo: '20' });

      expect(res.status).toBe(200);
      const [{ sql }] = consultaDados();
      expect(sql).toMatch(/LEFT\s+JOIN\s+produto/i);
      expect(sql).not.toMatch(/INNER\s+JOIN\s+produto/i);
      expect(res.body.itens).toEqual([
        { id: 1, nome: 'Sem descrição', faturamento: 1000, custoTotal: 900, lucro: 100, margemPercentual: 10, semCusto: false },
      ]);
    });

    it('filtro de departamento (nivel + id) é opcional nesta rota também, parametrizado', async () => {
      mockar();

      const res = await chamar({ ...PERIODO, nivel: 'grupo', id: '3' });

      expect(res.status).toBe(200);
      const departamento = buildDepartmentFilter({ nivel: 'grupo', id: '3' });
      const [{ sql }, params] = consultaDados();
      expect(sql).toContain(departamento.clause);
      expect(params).toEqual([PERIODO.inicio, PERIODO.fim, ...departamento.params]);
    });

    it('nivel sem id, id sem nivel ou nivel inválido retornam 400 sem consultar o banco', async () => {
      const semId = await chamar({ ...PERIODO, nivel: 'grupo' });
      const semNivel = await chamar({ ...PERIODO, id: '3' });
      const nivelInvalido = await chamar({ ...PERIODO, nivel: 'loja', id: '3' });

      for (const res of [semId, semNivel, nivelInvalido]) {
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ erro: expect.any(String) });
      }
      expect(execute).not.toHaveBeenCalled();
    });

    it('limite inválido (0, negativo, texto, decimal, 1001) retorna 400 sem consultar o banco', async () => {
      for (const limite of ['0', '-3', 'abc', '1.5', '1001']) {
        const res = await chamar({ ...PERIODO, limite });

        expect(res.status).toBe(400);
        expect(res.body).toEqual({ erro: expect.stringMatching(/limite/i) });
      }
      expect(execute).not.toHaveBeenCalled();
    });

    it('limite 1000 é aceito e o padrão é 100 quando não informado', async () => {
      mockar();

      const comLimite = await chamar({ ...PERIODO, limite: '1000' });
      const semLimite = await chamar(PERIODO);

      expect(comLimite.status).toBe(200);
      expect(comLimite.body.limite).toBe(1000);
      expect(semLimite.body.limite).toBe(100);
    });

    it('fim no futuro é limitado a ontem; a resposta traz fim efetivo e fimSolicitado', async () => {
      fixarHoje(2026, 9, 25);
      mockar({ dias: listarDias('2026-08-01', '2026-09-24'), linhas: [] });

      const res = await chamar(PERIODO);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ inicio: '2026-09-01', fim: '2026-09-24', fimSolicitado: '2026-09-30' });
      const [, params] = consultaDados();
      expect(params).toEqual(['2026-09-01', '2026-09-24']);
    });

    it('inicio a partir de hoje (nenhum dia fechado) retorna 400 { erro } claro, sem consultar o banco', async () => {
      fixarHoje(2026, 9, 25);

      const res = await chamar({ inicio: '2026-09-25', fim: '2026-09-30', minimo: '20' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ erro: expect.stringMatching(/fechado/i) });
      expect(execute).not.toHaveBeenCalled();
    });

    it('quando o cache não cobre todo o período efetivo, responde 503 { erro } antes de consultar os dados, sem log de erro inesperado', async () => {
      execute.mockImplementation(async ({ sql }) => {
        if (ehCobertura(sql)) return [[], []];
        throw new Error('não deveria consultar dados sem o cache coberto');
      });

      const res = await chamar();

      expect(res.status).toBe(503);
      expect(res.body).toEqual({ erro: expect.any(String) });
      expect(execute).toHaveBeenCalledTimes(1);
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  describe('validação comum (as duas rotas)', () => {
    const ROTAS = [
      ['evolucao', {}],
      ['abaixo-minimo', { minimo: '20' }],
    ];

    it.each(ROTAS)('GET /%s sem inicio/fim retorna 400 { erro } sem consultar o banco', async (rota, extra) => {
      const res = await request(app).get(`${BASE}/${rota}`).query(extra);

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ erro: expect.any(String) });
      expect(execute).not.toHaveBeenCalled();
    });

    it.each(ROTAS)('GET /%s com período inválido (fim anterior ao início) retorna 400', async (rota, extra) => {
      const res = await request(app).get(`${BASE}/${rota}`).query({ inicio: '2026-09-30', fim: '2026-09-01', ...extra });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ erro: expect.any(String) });
      expect(execute).not.toHaveBeenCalled();
    });

    it.each(ROTAS)('GET /%s: falha do banco na consulta de dados retorna 500 genérico, sem vazar SQL nem mensagem do MariaDB, logando só o código', async (rota, extra) => {
      execute.mockImplementation(async ({ sql }) => {
        if (ehCobertura(sql)) return [DIAS_COBERTOS.map((dia) => ({ dia })), []];
        throw Object.assign(new Error("Unknown column 'vendas_produto_dia_cache.x' in SELECT"), { code: 'ER_BAD_FIELD_ERROR' });
      });

      const res = await request(app).get(`${BASE}/${rota}`).query({ inicio: '2026-09-01', fim: '2026-09-30', ...extra });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ erro: 'Erro interno.' });
      expect(JSON.stringify(res.body)).not.toMatch(/vendas_produto_dia_cache\.x|SELECT|ER_BAD_FIELD_ERROR/);
      expect(errorSpy).toHaveBeenCalled();
      const registro = errorSpy.mock.calls.map((chamada) => chamada.join(' ')).join(' ');
      expect(registro).toContain('ER_BAD_FIELD_ERROR');
      expect(registro).not.toMatch(/SELECT|Unknown column/i);
    });
  });
});

describe('margemEvolucao.controller - erro inesperado (fora do service)', () => {
  const BASE_LOCAL = '/api/rentabilidade';
  let errorSpy;

  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  function montarAppComServicoQueFalha(erro) {
    let appComFalha;
    jest.isolateModules(() => {
      const rejeita = () => jest.fn().mockRejectedValue(erro);
      jest.doMock('../../../src/modules/rentabilidade/margemEvolucao.service', () => ({
        obterEvolucaoMargem: rejeita(),
        obterProdutosAbaixoMinimo: rejeita(),
        ErroInternoMargemEvolucao: class ErroInternoMargemEvolucao extends Error {},
      }));
      const router = require('../../../src/modules/rentabilidade/margemEvolucao.routes');
      appComFalha = express();
      appComFalha.use(BASE_LOCAL, router);
    });
    jest.dontMock('../../../src/modules/rentabilidade/margemEvolucao.service');
    return appComFalha;
  }

  it.each(['evolucao', 'abaixo-minimo'])(
    'GET /%s: erro inesperado responde 500 genérico e loga só o nome e o código do erro (nunca mensagem, pilha ou SQL)',
    async (rota) => {
      const erro = Object.assign(new TypeError('Cannot read properties of undefined SELECT * FROM produto segredo'), {
        code: 'ERR_INESPERADO',
      });
      const appComFalha = montarAppComServicoQueFalha(erro);

      const res = await request(appComFalha)
        .get(`${BASE_LOCAL}/${rota}`)
        .query({ inicio: '2026-09-01', fim: '2026-09-30', minimo: '20' });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ erro: 'Erro interno.' });
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const registro = errorSpy.mock.calls[0].join(' ');
      expect(registro).toContain('TypeError');
      expect(registro).toContain('ERR_INESPERADO');
      expect(registro).not.toMatch(/SELECT|segredo|FROM produto|Cannot read/i);
    }
  );
});
