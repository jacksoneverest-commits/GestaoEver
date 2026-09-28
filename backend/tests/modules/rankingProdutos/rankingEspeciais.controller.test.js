jest.mock('../../../src/db/connection', () => ({ getPool: jest.fn() }));

const express = require('express');
const request = require('supertest');
const { getPool } = require('../../../src/db/connection');
const { JOIN_VENDA_VALIDA, WHERE_VENDA_VALIDA } = require('../../../src/shared/vendaValida');
const { TIMEOUT_CONSULTA_MS } = require('../../../src/shared/timeoutConsulta');
const { buildPeriodFilter, buildDepartmentFilter } = require('../../../src/shared/queryFilters');
const { listarDias } = require('../../../src/jobs/jobsComum');
const rankingEspeciaisRouter = require('../../../src/modules/rankingProdutos/rankingEspeciais.routes');

const BASE = '/api/ranking-produtos';
const PERIODO = { inicio: '2026-09-01', fim: '2026-09-30' };

function montarApp() {
  const app = express();
  app.use(BASE, rankingEspeciaisRouter);
  return app;
}

describe('rankingEspeciais (parados, novos, demanda-baixo-estoque)', () => {
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

  it('GET /parados lista os produtos sem nenhuma venda válida dentro do período', async () => {
    execute.mockResolvedValue([
      [
        { id: 11, nome: 'PRODUTO SEM GIRO A' },
        { id: 12, nome: null },
      ],
      [],
    ]);

    const res = await request(app).get(`${BASE}/parados`).query(PERIODO);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      inicio: '2026-09-01',
      fim: '2026-09-30',
      limite: 50,
      itens: [
        { id: 11, nome: 'PRODUTO SEM GIRO A' },
        { id: 12, nome: 'Sem descrição' },
      ],
    });

    expect(execute).toHaveBeenCalledTimes(1);
    const [{ sql, timeout }, params] = execute.mock.calls[0];
    const periodo = buildPeriodFilter(PERIODO.inicio, PERIODO.fim);
    expect(timeout).toBe(TIMEOUT_CONSULTA_MS);
    // vendas válidas + período ficam DENTRO da subconsulta de vendidos (a condição do LEFT JOIN),
    // e o produto sem venda é o que sobra com "vendidos.produto IS NULL"
    expect(sql).toContain(JOIN_VENDA_VALIDA);
    expect(sql).toContain(WHERE_VENDA_VALIDA);
    expect(sql).toContain(periodo.clause);
    expect(sql).toMatch(/LEFT JOIN \(/);
    expect(sql).toMatch(/vendidos\.produto IS NULL/);
    // período parametrizado (nunca concatenado) e limite como último parâmetro
    expect(params).toEqual([...periodo.params, 50]);
    expect(sql).not.toContain(PERIODO.inicio);
  });

  // /novos (Task 7.4) lê primeira_venda_produto (primeira venda válida, mantida pelo job) e o cache diário
  // (quantidade/faturamento do período). Consultas, em ordem: guarda do histórico de primeira venda
  // (MIN(primeira_venda)), cobertura do período (sentinelas fechadas) e a lista.
  // O relógio está fixado em 2026-10-15 (setembro inteiro fechado); os testes de fim efetivo o reposicionam.
  const DIAS_DO_PERIODO = Array.from({ length: 30 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`);

  const ehGuarda = (sql) => sql.includes('MIN(');
  const ehCobertura = (sql) => sql.includes('atualizado_em >=');

  function mockarNovos({ dias = DIAS_DO_PERIODO, linhas = [], primeiraVendaMinima = '2020-01-15' } = {}) {
    execute.mockImplementation(async ({ sql }) => {
      if (ehGuarda(sql)) return [[{ primeiraVendaMinima }], []];
      if (ehCobertura(sql)) return [dias.map((dia) => ({ dia })), []];
      return [linhas, []];
    });
  }
  const consultaGuarda = () => execute.mock.calls.find(([{ sql }]) => ehGuarda(sql));
  const consultaCobertura = () => execute.mock.calls.find(([{ sql }]) => ehCobertura(sql));
  const consultaNovos = () =>
    execute.mock.calls.find(([{ sql }]) => sql.includes('primeira_venda_produto') && !ehGuarda(sql) && !ehCobertura(sql));

  // Teste crítico 4 (PLAN.md, Task 7.4)
  it('GET /novos lista os produtos cuja primeira venda no cache cai dentro do período, sem consultar o histórico de vendaitem/vendacupom', async () => {
    mockarNovos({
      linhas: [
        { id: 21, nome: 'PRODUTO NOVO X', primeiraVenda: '2026-09-10', quantidadePeriodo: 12.5, faturamentoPeriodo: '150.5000' },
        { id: 22, nome: 'PRODUTO NOVO Y', primeiraVenda: '2026-09-25', quantidadePeriodo: 3, faturamentoPeriodo: '30.0000' },
      ],
    });

    const res = await request(app).get(`${BASE}/novos`).query({ ...PERIODO, limite: '20' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      inicio: '2026-09-01',
      fim: '2026-09-30',
      fimSolicitado: '2026-09-30',
      limite: 20,
      itens: [
        { id: 21, nome: 'PRODUTO NOVO X', primeiraVenda: '2026-09-10', quantidade: 12.5, faturamento: 150.5 },
        { id: 22, nome: 'PRODUTO NOVO Y', primeiraVenda: '2026-09-25', quantidade: 3, faturamento: 30 },
      ],
    });

    const [{ sql, timeout }, params] = consultaNovos();
    const periodo = buildPeriodFilter(PERIODO.inicio, PERIODO.fim);
    expect(timeout).toBe(TIMEOUT_CONSULTA_MS);
    // só o cache: primeira venda + quantidade/faturamento diários; nada de histórico transacional
    expect(sql).toContain('FROM primeira_venda_produto');
    expect(sql).toContain('vendas_produto_dia_cache');
    expect(sql).not.toMatch(/vendaitem|vendacupom|flagvc|NOT EXISTS/i);
    // primeira_venda dentro do período e vendas somadas só do período, ambos parametrizados
    expect(sql).toContain(periodo.clause.replace(/vendacupom\.data/g, 'primeira_venda_produto.primeira_venda'));
    expect(sql).toContain(periodo.clause.replace(/vendacupom\.data/g, 'vendas_produto_dia_cache.dia'));
    expect(sql).toMatch(/LIMIT \?\s*$/);
    expect(params).toEqual([...periodo.params, ...periodo.params, 20]);
    expect(sql).not.toContain(PERIODO.inicio);
    // nenhuma consulta às tabelas transacionais em nenhum momento (nem na guarda nem na cobertura)
    for (const [{ sql: sqlChamada }] of execute.mock.calls) {
      expect(sqlChamada).not.toMatch(/vendaitem|vendacupom/i);
    }
  });

  it('GET /novos desconsidera produtos sem venda no período (primeira venda cancelada depois): HAVING quantidade > 0', async () => {
    mockarNovos();

    await request(app).get(`${BASE}/novos`).query(PERIODO);

    const [{ sql }] = consultaNovos();
    expect(sql).toMatch(/HAVING SUM\(vendas_produto_dia_cache\.quantidade\) > 0/);
    expect(sql).toMatch(/ORDER BY faturamentoPeriodo DESC, produto\.idProduto/);
  });

  it('GET /novos ignora explicitamente a sentinela do cache diário (produto > 0)', async () => {
    mockarNovos();

    await request(app).get(`${BASE}/novos`).query(PERIODO);

    const [{ sql }] = consultaNovos();
    expect(sql).toMatch(/vendas_produto_dia_cache\.produto > 0/);
  });

  it('GET /novos aplica o filtro de departamento (nivel + id) parametrizado', async () => {
    mockarNovos();

    const res = await request(app).get(`${BASE}/novos`).query({ ...PERIODO, nivel: 'familia', id: '9' });

    expect(res.status).toBe(200);
    const periodo = buildPeriodFilter(PERIODO.inicio, PERIODO.fim);
    const departamento = buildDepartmentFilter({ nivel: 'familia', id: '9' });
    const [{ sql }, params] = consultaNovos();
    expect(sql).toContain(departamento.clause);
    expect(params).toEqual([...periodo.params, ...periodo.params, ...departamento.params, 50]);
  });

  it('GET /novos com cache diário que não cobre todos os dias do período retorna 503 { erro } claro, com o comando a rodar, sem lista parcial', async () => {
    mockarNovos({ dias: DIAS_DO_PERIODO.filter((dia) => dia !== '2026-09-12' && dia !== '2026-09-13') });

    const res = await request(app).get(`${BASE}/novos`).query(PERIODO);

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ erro: expect.stringMatching(/cache/i) });
    expect(res.body.erro).toContain('npm run job:cache-produtos -- --desde 2026-09-12');
    expect(res.body.erro).toMatch(/faltam 2 dia\(s\)/);
    expect(consultaNovos()).toBeUndefined();
  });

  it('GET /novos checa a cobertura só do período (não do anterior) pelas sentinelas fechadas do cache, sem vendas_periodo_cache', async () => {
    mockarNovos();

    await request(app).get(`${BASE}/novos`).query(PERIODO);

    const periodo = buildPeriodFilter(PERIODO.inicio, PERIODO.fim);
    const [{ sql }, params] = consultaCobertura();
    expect(sql).toContain('FROM vendas_produto_dia_cache');
    expect(sql).toMatch(/vendas_produto_dia_cache\.produto = 0/);
    expect(sql).toMatch(/atualizado_em >= DATE_ADD\(vendas_produto_dia_cache\.dia, INTERVAL 1 DAY\)/);
    expect(sql).not.toMatch(/UNION|vendas_periodo_cache|quantidade_cupons/);
    expect(params).toEqual(periodo.params);
  });

  // Guarda do histórico de primeira venda (revisão da Fase 7): sem migration 005, só a consulta barata ao cache.
  it('GET /novos com MIN(primeira_venda) posterior ao início do período retorna 503 { erro } explicando o preenchimento do histórico, sem lista', async () => {
    mockarNovos({ primeiraVendaMinima: '2026-09-05' });

    const res = await request(app).get(`${BASE}/novos`).query(PERIODO);

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ erro: expect.stringMatching(/primeira venda/i) });
    expect(res.body.erro).toContain('npm run job:cache-produtos -- --desde');
    expect(res.body.erro).toContain('2026-09-05');
    expect(consultaNovos()).toBeUndefined();
  });

  it('GET /novos com primeira_venda_produto vazia (MIN nulo) também retorna 503 { erro } de histórico não preenchido', async () => {
    mockarNovos({ primeiraVendaMinima: null });

    const res = await request(app).get(`${BASE}/novos`).query(PERIODO);

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ erro: expect.stringMatching(/primeira venda.*vazia|vazia.*primeira venda|histórico/i) });
    expect(consultaNovos()).toBeUndefined();
  });

  it('GET /novos com MIN(primeira_venda) igual ao início do período passa na guarda', async () => {
    mockarNovos({ primeiraVendaMinima: '2026-09-01' });

    const res = await request(app).get(`${BASE}/novos`).query(PERIODO);

    expect(res.status).toBe(200);
  });

  it('a guarda é uma consulta barata só no cache (MIN sobre primeira_venda_produto, sem parâmetros de dados) e vem antes da cobertura e da lista', async () => {
    mockarNovos();

    await request(app).get(`${BASE}/novos`).query(PERIODO);

    const [{ sql, timeout }, params] = consultaGuarda();
    expect(timeout).toBe(TIMEOUT_CONSULTA_MS);
    expect(sql).toMatch(/MIN\(primeira_venda_produto\.primeira_venda\)/);
    expect(sql).toContain('FROM primeira_venda_produto');
    expect(sql).not.toMatch(/vendaitem|vendacupom|vendas_produto_dia_cache|JOIN/i);
    expect(params).toEqual([]);
    const ordem = execute.mock.calls.map(([{ sql: s }]) => (ehGuarda(s) ? 'guarda' : ehCobertura(s) ? 'cobertura' : 'lista'));
    expect(ordem).toEqual(['guarda', 'cobertura', 'lista']);
  });

  // Dias futuros / hoje: o fim efetivo é ONTEM; a guarda compara com o início (que não muda).
  describe('/novos: fim efetivo limitado a ontem', () => {
    it('mês corrente: fim no futuro vira ontem, a resposta devolve o fim efetivo e fimSolicitado, e só os dias fechados são exigidos do cache', async () => {
      fixarHoje(2026, 9, 25);
      mockarNovos({ dias: DIAS_DO_PERIODO.filter((dia) => dia <= '2026-09-24') });

      const res = await request(app).get(`${BASE}/novos`).query(PERIODO);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ inicio: '2026-09-01', fim: '2026-09-24', fimSolicitado: '2026-09-30' });
      const efetivo = buildPeriodFilter('2026-09-01', '2026-09-24');
      expect(consultaCobertura()[1]).toEqual(efetivo.params);
      expect(consultaNovos()[1]).toEqual([...efetivo.params, ...efetivo.params, 50]);
    });

    it('inicio a partir de hoje (nenhum dia fechado no intervalo) retorna 400 { erro } claro, sem consultar o banco', async () => {
      fixarHoje(2026, 9, 25);
      mockarNovos();

      const res = await request(app).get(`${BASE}/novos`).query({ inicio: '2026-09-25', fim: '2026-09-30' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ erro: expect.stringMatching(/fechado/i) });
      expect(res.body.erro).toContain('2026-09-24');
      expect(execute).not.toHaveBeenCalled();
    });
  });

  it('aplica o filtro de departamento (nivel + id) quando informado, via buildDepartmentFilter', async () => {
    execute.mockResolvedValue([[], []]);

    const res = await request(app).get(`${BASE}/parados`).query({ ...PERIODO, nivel: 'setor', id: '5' });

    expect(res.status).toBe(200);
    expect(res.body.itens).toEqual([]);
    const [{ sql }, params] = execute.mock.calls[0];
    const periodo = buildPeriodFilter(PERIODO.inicio, PERIODO.fim);
    const departamento = buildDepartmentFilter({ nivel: 'setor', id: '5' });
    expect(sql).toContain(departamento.clause);
    expect(params).toEqual([...periodo.params, ...departamento.params, 50]);
  });

  it.each(['parados', 'novos', 'demanda-baixo-estoque'])(
    'GET /%s sem inicio/fim retorna 400 { erro } sem consultar o banco',
    async (recurso) => {
      const res = await request(app).get(`${BASE}/${recurso}`);

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ erro: expect.any(String) });
      expect(execute).not.toHaveBeenCalled();
    }
  );

  it.each(['0', '-3', 'abc', '1.5', '501'])('limite inválido (%s) retorna 400', async (limite) => {
    const res = await request(app).get(`${BASE}/novos`).query({ ...PERIODO, limite });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: expect.stringMatching(/limite/i) });
    expect(execute).not.toHaveBeenCalled();
  });

  it('período inválido (fim anterior ao início) retorna 400', async () => {
    const res = await request(app).get(`${BASE}/parados`).query({ inicio: '2026-09-30', fim: '2026-09-01' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: expect.any(String) });
    expect(execute).not.toHaveBeenCalled();
  });

  it('nivel sem id (ou id sem nivel) retorna 400', async () => {
    const semId = await request(app).get(`${BASE}/parados`).query({ ...PERIODO, nivel: 'grupo' });
    const semNivel = await request(app).get(`${BASE}/parados`).query({ ...PERIODO, id: '3' });
    const nivelInvalido = await request(app).get(`${BASE}/novos`).query({ ...PERIODO, nivel: 'loja', id: '3' });

    for (const res of [semId, semNivel, nivelInvalido]) {
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ erro: expect.any(String) });
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it('falha do banco retorna 500 genérico, sem vazar SQL nem mensagem do MariaDB', async () => {
    const erroBanco = Object.assign(new Error('Table erp.vendaitem does not exist SELECT ...'), {
      code: 'ER_NO_SUCH_TABLE',
    });
    execute.mockRejectedValue(erroBanco);

    const res = await request(app).get(`${BASE}/novos`).query(PERIODO);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ erro: 'Erro interno.' });
    expect(JSON.stringify(res.body)).not.toMatch(/vendaitem|SELECT|ER_NO_SUCH_TABLE/);
    expect(errorSpy).toHaveBeenCalled();
  });

  // /demanda-baixo-estoque (Task 7.2): venda válida no período + estoque de produto.qtestoque/qtminima/qtmaxima.
  // Baixo estoque = qtestoque <= qtminima OU cobertura < 7 dias (cobertura = qtestoque / média diária; estoque <= 0 ou NULL = 0).
  describe('/demanda-baixo-estoque', () => {
    // Período da consulta de quantidade vendida no cache (datas ISO: dia >= ? AND dia <= ?).
    const periodoCache = (inicio = PERIODO.inicio, fim = PERIODO.fim) => [inicio, fim];
    const DIAS_SETEMBRO = 30;
    // Cache diário: todos os dias dos períodos usados nos testes têm a sentinela fechada (Task 13.3).
    const DIAS_COBERTOS = listarDias('2026-08-01', '2026-09-30');

    // A verificação de cobertura do cache vem primeiro; depois, a lista.
    function mockarDemanda({ linhas = [], dias = DIAS_COBERTOS } = {}) {
      execute.mockImplementation(async ({ sql }) =>
        ehCobertura(sql) ? [dias.map((dia) => ({ dia })), []] : [linhas, []]
      );
    }
    const consultaDemanda = () => execute.mock.calls.find(([{ sql }]) => !ehCobertura(sql));

    const chamar = (query = PERIODO) => request(app).get(`${BASE}/demanda-baixo-estoque`).query(query);

    // Teste crítico (PLAN.md, Task 7.2): a consulta filtra e ordena no SQL; o service só mapeia a resposta.
    it('lista produtos com venda no período e (qtestoque <= qtminima ou cobertura < 7 dias), ordenados pela menor cobertura primeiro', async () => {
      mockarDemanda({
        linhas: [
          { id: 1, nome: 'ARROZ 5KG', quantidadeVendida: 60, estoqueAtual: -3, estoqueMinimo: 10, estoqueMaximo: 100, coberturaDias: 0 },
          { id: 2, nome: 'FEIJAO 1KG', quantidadeVendida: 90, estoqueAtual: 20, estoqueMinimo: 5, estoqueMaximo: null, coberturaDias: 6.666666666666667 },
          { id: 3, nome: 'SAL 1KG', quantidadeVendida: 30, estoqueAtual: 8, estoqueMinimo: 10, estoqueMaximo: 100, coberturaDias: 8 },
        ],
      });

      const res = await chamar({ ...PERIODO, limite: '20' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        inicio: '2026-09-01',
        fim: '2026-09-30',
        fimSolicitado: '2026-09-30',
        limite: 20,
        itens: [
          {
            id: 1, nome: 'ARROZ 5KG', quantidadeVendida: 60, mediaDiaria: 2, estoqueAtual: -3,
            estoqueMinimo: 10, estoqueMaximo: 100, coberturaDias: 0, motivo: 'abaixo_minimo_e_cobertura_baixa',
          },
          {
            id: 2, nome: 'FEIJAO 1KG', quantidadeVendida: 90, mediaDiaria: 3, estoqueAtual: 20,
            estoqueMinimo: 5, estoqueMaximo: null, coberturaDias: 6.67, motivo: 'cobertura_baixa',
          },
          {
            id: 3, nome: 'SAL 1KG', quantidadeVendida: 30, mediaDiaria: 1, estoqueAtual: 8,
            estoqueMinimo: 10, estoqueMaximo: 100, coberturaDias: 8, motivo: 'abaixo_minimo',
          },
        ],
      });

      expect(execute).toHaveBeenCalledTimes(2); // cobertura do cache + lista
      const [{ sql, timeout }, params] = consultaDemanda();
      expect(timeout).toBe(TIMEOUT_CONSULTA_MS);
      // filtro (estoque <= mínimo OU cobertura < limiar) e ordenação pela menor cobertura, no SQL
      expect(sql).toMatch(/WHERE candidatos\.estoqueAtual <= candidatos\.estoqueMinimo OR candidatos\.coberturaDias < \?/);
      expect(sql).toMatch(/ORDER BY candidatos\.coberturaDias, candidatos\.quantidadeVendida DESC, candidatos\.id\s+LIMIT \?\s*$/);
      // ordem dos placeholders: dias do período -> período do cache (ISO) -> limiar de cobertura -> limite
      expect(params).toEqual([DIAS_SETEMBRO, ...periodoCache(), 7, 20]);
    });

    it('lê o estoque de produto.qtestoque/qtminima/qtmaxima e nunca da flag produto.Estoque', async () => {
      mockarDemanda();

      await chamar();

      const [{ sql }] = consultaDemanda();
      expect(sql).toContain('produto.qtestoque');
      expect(sql).toContain('produto.qtminima');
      expect(sql).toContain('produto.qtmaxima');
      expect(sql).not.toMatch(/\bEstoque\b/);
    });

    it('conta só a venda do período lida do cache (SUM(quantidade) > 0, produto > 0), parametrizada, sem tabelas transacionais', async () => {
      mockarDemanda();

      await chamar();

      const [{ sql }, params] = consultaDemanda();
      expect(sql).toContain('FROM vendas_produto_dia_cache');
      expect(sql).toContain('dia >= ? AND dia <= ?');
      expect(sql).toMatch(/produto > 0/);
      expect(sql).toContain('SUM(quantidade) AS quantidadeVendida');
      expect(sql).toMatch(/HAVING SUM\(quantidade\) > 0/);
      expect(sql).not.toMatch(/vendaitem|vendacupom|flagvc|STRAIGHT_JOIN/);
      expect(sql).not.toContain(PERIODO.inicio);
      expect(params).toEqual([DIAS_SETEMBRO, ...periodoCache(), 7, 50]);
    });

    it('não filtra por situacao nem por Estoque = S', async () => {
      mockarDemanda();

      await chamar();

      const [{ sql }] = consultaDemanda();
      expect(sql).not.toMatch(/situacao/i);
      expect(sql).not.toMatch(/'S'/);
    });

    it('ordena por colunas da tabela derivada, sem alias de agregação dentro de expressão (ER_ILLEGAL_REFERENCE no MariaDB 10.1)', async () => {
      mockarDemanda();

      await chamar();

      const [{ sql }] = consultaDemanda();
      const orderBy = sql.match(/ORDER BY ([^\n]+)/)[1];
      // a agregação (SUM) fica na subconsulta interna; o ORDER BY só usa colunas da tabela derivada
      expect(orderBy).not.toMatch(/SUM\(|\(|\)/);
      expect(sql.slice(sql.indexOf('ORDER BY'))).not.toMatch(/SUM\(/);
    });

    it('estoque negativo, zero ou nulo tem cobertura 0 (regra no SQL) e nulo sai como null na resposta', async () => {
      mockarDemanda({
        linhas: [
          { id: 4, nome: 'SEM SALDO', quantidadeVendida: 15, estoqueAtual: null, estoqueMinimo: null, estoqueMaximo: null, coberturaDias: 0 },
        ],
      });

      const res = await chamar();

      const [{ sql }] = consultaDemanda();
      expect(sql).toMatch(/IF\(COALESCE\(produto\.qtestoque, 0\) <= 0, 0, /);
      expect(res.body.itens).toEqual([
        {
          id: 4, nome: 'SEM SALDO', quantidadeVendida: 15, mediaDiaria: 0.5, estoqueAtual: null,
          estoqueMinimo: null, estoqueMaximo: null, coberturaDias: 0, motivo: 'cobertura_baixa',
        },
      ]);
    });

    it.each([
      ['abaixo_minimo', { estoqueAtual: 10, estoqueMinimo: 10, coberturaDias: 30 }],
      ['cobertura_baixa', { estoqueAtual: 10, estoqueMinimo: 2, coberturaDias: 3 }],
      ['abaixo_minimo_e_cobertura_baixa', { estoqueAtual: 1, estoqueMinimo: 2, coberturaDias: 3 }],
    ])('motivo %s calculado a partir do estoque, do mínimo e da cobertura', async (motivo, campos) => {
      mockarDemanda({ linhas: [{ id: 9, nome: 'X', quantidadeVendida: 30, estoqueMaximo: 50, ...campos }] });

      const res = await chamar();

      expect(res.status).toBe(200);
      expect(res.body.itens[0].motivo).toBe(motivo);
    });

    it('usa o limiar nomeado COBERTURA_MINIMA_DIAS = 7', () => {
      const { COBERTURA_MINIMA_DIAS } = require('../../../src/modules/rankingProdutos/rankingEspeciais.service');
      expect(COBERTURA_MINIMA_DIAS).toBe(7);
    });

    it('a média diária usa os dias inclusivos do período (período de 1 dia e de 10 dias)', async () => {
      mockarDemanda({
        linhas: [{ id: 5, nome: 'Y', quantidadeVendida: 20, estoqueAtual: 1, estoqueMinimo: 5, estoqueMaximo: null, coberturaDias: 0.5 }],
      });

      const umDia = await chamar({ inicio: '2026-09-10', fim: '2026-09-10' });
      const dezDias = await chamar({ inicio: '2026-09-01', fim: '2026-09-10' });

      const consultasDeDados = execute.mock.calls.filter(([{ sql }]) => !ehCobertura(sql));
      expect(consultasDeDados[0][1][0]).toBe(1);
      expect(umDia.body.itens[0].mediaDiaria).toBe(20);
      expect(consultasDeDados[1][1][0]).toBe(10);
      expect(dezDias.body.itens[0].mediaDiaria).toBe(2);
    });

    it('aplica o filtro de departamento (nivel + id) parametrizado e o limite informado', async () => {
      mockarDemanda();

      const res = await chamar({ ...PERIODO, nivel: 'grupo', id: '4', limite: '10' });

      expect(res.status).toBe(200);
      const departamento = buildDepartmentFilter({ nivel: 'grupo', id: '4' });
      const [{ sql }, params] = consultaDemanda();
      expect(sql).toContain(departamento.clause);
      expect(params).toEqual([DIAS_SETEMBRO, ...periodoCache(), ...departamento.params, 7, 10]);
    });

    it.each(['0', '-3', 'abc', '1.5', '501'])('limite inválido (%s) retorna 400 sem consultar o banco', async (limite) => {
      const res = await chamar({ ...PERIODO, limite });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ erro: expect.stringMatching(/limite/i) });
      expect(execute).not.toHaveBeenCalled();
    });

    it('nivel sem id retorna 400 sem consultar o banco', async () => {
      const res = await chamar({ ...PERIODO, nivel: 'setor' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ erro: expect.any(String) });
      expect(execute).not.toHaveBeenCalled();
    });

    it('falha do banco retorna 500 genérico, sem vazar SQL nem mensagem do MariaDB', async () => {
      execute.mockRejectedValue(
        Object.assign(new Error("Unknown column 'produto.qtestoque' in SELECT ..."), { code: 'ER_BAD_FIELD_ERROR' })
      );

      const res = await chamar();

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ erro: 'Erro interno.' });
      expect(JSON.stringify(res.body)).not.toMatch(/qtestoque|SELECT|ER_BAD_FIELD_ERROR/);
      expect(errorSpy).toHaveBeenCalled();
    });

    it('não responde mais 501: a rota consulta o banco', async () => {
      mockarDemanda();

      const res = await chamar();

      expect(res.status).not.toBe(501);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        inicio: '2026-09-01',
        fim: '2026-09-30',
        fimSolicitado: '2026-09-30',
        limite: 50,
        itens: [],
      });
      expect(execute).toHaveBeenCalledTimes(2); // cobertura do cache + lista
    });

    // Dia fechado: o fim efetivo é ONTEM (mesmo critério de /novos). Divisor da cobertura, filtro de período e
    // verificação de cobertura do cache usam o fim efetivo.
    describe('fim efetivo limitado a ontem', () => {
      it('fim no futuro: o divisor (dias) e o filtro de período usam o fim efetivo (ontem); a resposta traz fim e fimSolicitado', async () => {
        fixarHoje(2026, 9, 25);
        mockarDemanda({
          linhas: [{ id: 6, nome: 'Z', quantidadeVendida: 48, estoqueAtual: 10, estoqueMinimo: 2, estoqueMaximo: null, coberturaDias: 5 }],
          dias: listarDias('2026-09-01', '2026-09-24'),
        });

        const res = await chamar(PERIODO);

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ inicio: '2026-09-01', fim: '2026-09-24', fimSolicitado: '2026-09-30', limite: 50 });
        // a cobertura do cache é exigida só até o fim efetivo (ontem)
        expect(execute.mock.calls[0][1]).toEqual(buildPeriodFilter('2026-09-01', '2026-09-24').params);
        expect(execute).toHaveBeenCalledTimes(2);
        expect(consultaDemanda()[1]).toEqual([24, ...periodoCache('2026-09-01', '2026-09-24'), 7, 50]);
        expect(res.body.itens[0].mediaDiaria).toBe(2);
      });

      it('fim igual a hoje também é limitado a ontem', async () => {
        fixarHoje(2026, 9, 25);
        mockarDemanda({ dias: listarDias('2026-09-20', '2026-09-24') });

        const res = await chamar({ inicio: '2026-09-20', fim: '2026-09-25' });

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ inicio: '2026-09-20', fim: '2026-09-24', fimSolicitado: '2026-09-25' });
        expect(consultaDemanda()[1]).toEqual([5, ...periodoCache('2026-09-20', '2026-09-24'), 7, 50]);
      });

      it('inicio a partir de hoje (nenhum dia fechado) retorna 400 { erro } sem consultar o banco', async () => {
        fixarHoje(2026, 9, 25);

        const res = await chamar({ inicio: '2026-09-25', fim: '2026-09-30' });

        expect(res.status).toBe(400);
        expect(res.body).toEqual({ erro: expect.stringMatching(/fechado/i) });
        expect(execute).not.toHaveBeenCalled();
      });

      it('período totalmente passado: fimSolicitado é igual a fim e o divisor não muda', async () => {
        fixarHoje(2026, 9, 25);
        mockarDemanda();

        const res = await chamar({ inicio: '2026-08-01', fim: '2026-08-31' });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({
          inicio: '2026-08-01',
          fim: '2026-08-31',
          fimSolicitado: '2026-08-31',
          limite: 50,
          itens: [],
        });
        expect(consultaDemanda()[1][0]).toBe(31);
      });
    });
  });
});

describe('rankingEspeciais.controller - erro inesperado (fora do service)', () => {
  let errorSpy;

  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  // Router com o service substituído por um que rejeita com um erro que não é de validação, de cache
  // incompleto nem o erro interno (esse o próprio service já loga).
  function montarAppComServicoQueFalha(erro) {
    let appComFalha;
    jest.isolateModules(() => {
      const rejeita = () => jest.fn().mockRejectedValue(erro);
      jest.doMock('../../../src/modules/rankingProdutos/rankingEspeciais.service', () => ({
        obterProdutosParados: rejeita(),
        obterProdutosNovos: rejeita(),
        obterProdutosDemandaBaixoEstoque: rejeita(),
        ErroCacheIncompleto: class ErroCacheIncompleto extends Error {},
        ErroInternoRankingEspeciais: class ErroInternoRankingEspeciais extends Error {},
      }));
      const router = require('../../../src/modules/rankingProdutos/rankingEspeciais.routes');
      appComFalha = express();
      appComFalha.use(BASE, router);
    });
    jest.dontMock('../../../src/modules/rankingProdutos/rankingEspeciais.service');
    return appComFalha;
  }

  it.each(['parados', 'novos', 'demanda-baixo-estoque'])(
    'GET /%s: erro inesperado responde 500 genérico e loga só o nome e o código do erro (nunca mensagem, pilha ou SQL)',
    async (rota) => {
      const erro = Object.assign(new TypeError('Cannot read properties of undefined SELECT * FROM produto segredo'), {
        code: 'ERR_INESPERADO',
      });
      const appComFalha = montarAppComServicoQueFalha(erro);

      const res = await request(appComFalha).get(`${BASE}/${rota}`).query(PERIODO);

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
