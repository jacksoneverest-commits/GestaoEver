jest.mock('../../../src/db/connection', () => ({ getPool: jest.fn() }));

const express = require('express');
const request = require('supertest');
const { getPool } = require('../../../src/db/connection');
const { TIMEOUT_CONSULTA_MS } = require('../../../src/shared/timeoutConsulta');
const { buildPeriodFilter, buildDepartmentFilter } = require('../../../src/shared/queryFilters');
const { listarDias } = require('../../../src/jobs/jobsComum');
const estoqueRouter = require('../../../src/modules/estoque/estoque.routes');

const BASE = '/api/estoque';
const PERIODO = { inicio: '2026-09-01', fim: '2026-09-30' };
const DIAS_SETEMBRO = 30;
// Cache diário: todos os dias dos períodos usados nos testes têm a sentinela fechada (Task 13.3).
const DIAS_COBERTOS = listarDias('2026-08-01', '2026-09-30');
// Período do cache na consulta de quantidade vendida: datas ISO do período efetivo (dia >= ? AND dia <= ?).
const periodoCache = (inicio = PERIODO.inicio, fim = PERIODO.fim) => [inicio, fim];
const FILTRO_NAO_BLOQUEADO = "COALESCE(produto.situacao, '') <> 'B'";
// Produto que não controla estoque (produto.Estoque = 'N') fica fora; NULL conta como controla (robusto a NULL).
const FILTRO_CONTROLA_ESTOQUE = /COALESCE\(\s*produto\.Estoque\s*,\s*'S'\s*\)\s*(<>|!=)\s*'N'/;

function montarApp() {
  const app = express();
  app.use(BASE, estoqueRouter);
  return app;
}

describe('GET /api/estoque/niveis', () => {
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

  const ehResumo = (sql) => sql.includes('SUM(CASE');
  const ehCobertura = (sql) => sql.includes('atualizado_em >=');
  const consultaResumo = () => execute.mock.calls.find(([{ sql }]) => ehResumo(sql));
  const consultaLista = () => execute.mock.calls.find(([{ sql }]) => !ehResumo(sql) && !ehCobertura(sql));

  // Antes de tudo vem a verificação de cobertura do cache (sentinelas fechadas); depois a lista e o resumo,
  // duas consultas paralelas que o mock distingue pelo SQL.
  function mockarBanco({ linhas = [], resumo = { ruptura: 0, proximoRuptura: 0, excesso: 0 }, dias = DIAS_COBERTOS } = {}) {
    execute.mockImplementation(async ({ sql }) => {
      if (ehCobertura(sql)) return [dias.map((dia) => ({ dia })), []];
      return ehResumo(sql) ? [[resumo], []] : [linhas, []];
    });
  }

  const chamar = (query = PERIODO) => request(app).get(`${BASE}/niveis`).query(query);

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

  // Testes críticos (PLAN.md, Task 13.1): um it cada.
  it('Produtos com estoque atual menor ou igual a 0 e venda no período aparecem classificados como ruptura (produtos sem venda no período não entram)', async () => {
    mockarBanco({
      linhas: [
        { id: 1, nome: 'ARROZ 5KG', estoqueAtual: -3, estoqueMinimo: 10, estoqueMaximo: 100, quantidadeVendida: 90, coberturaDias: 0 },
        { id: 2, nome: 'FEIJAO 1KG', estoqueAtual: 0, estoqueMinimo: 5, estoqueMaximo: null, quantidadeVendida: 30, coberturaDias: 0 },
      ],
      resumo: { ruptura: '2', proximoRuptura: '4', excesso: '1' },
    });

    const res = await chamar();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      inicio: '2026-09-01',
      fim: '2026-09-30',
      fimSolicitado: '2026-09-30',
      classificacao: 'ruptura',
      limite: 50,
      totalItens: 2,
      resumo: { ruptura: 2, proximoRuptura: 4, excesso: 1 },
      itens: [
        {
          id: 1, nome: 'ARROZ 5KG', estoqueAtual: -3, estoqueMinimo: 10, estoqueMaximo: 100,
          quantidadeVendida: 90, mediaDiaria: 3, coberturaDias: 0, classificacao: 'ruptura',
        },
        {
          id: 2, nome: 'FEIJAO 1KG', estoqueAtual: 0, estoqueMinimo: 5, estoqueMaximo: null,
          quantidadeVendida: 30, mediaDiaria: 1, coberturaDias: 0, classificacao: 'ruptura',
        },
      ],
    });

    const [{ sql }] = consultaLista();
    // só entra quem vendeu no período (HAVING > 0 na venda agregada do cache + condição no filtro) e tem estoque <= 0
    expect(sql).toMatch(/HAVING SUM\(quantidade\) > 0/);
    expect(sql).toContain('WHERE candidatos.quantidadeVendida > 0 AND candidatos.estoqueAtual <= 0');
    // produto sem venda entra na base por LEFT JOIN (necessário ao excesso), então a condição acima é o que o exclui
    expect(sql).toMatch(/LEFT JOIN \(/);
  });

  it('Produtos com estoque atual acima do máximo configurado (com qtmaxima > 0) aparecem classificados como excesso', async () => {
    mockarBanco({
      linhas: [
        { id: 7, nome: 'SAL 1KG', estoqueAtual: 300, estoqueMinimo: 10, estoqueMaximo: 100, quantidadeVendida: 0, coberturaDias: null },
      ],
      resumo: { ruptura: 0, proximoRuptura: 0, excesso: 1 },
    });

    const res = await chamar({ ...PERIODO, classificacao: 'excesso' });

    expect(res.status).toBe(200);
    expect(res.body.classificacao).toBe('excesso');
    expect(res.body.totalItens).toBe(1);
    expect(res.body.itens).toEqual([
      {
        id: 7, nome: 'SAL 1KG', estoqueAtual: 300, estoqueMinimo: 10, estoqueMaximo: 100,
        quantidadeVendida: 0, mediaDiaria: 0, coberturaDias: null, classificacao: 'excesso',
      },
    ]);
    const [{ sql }] = consultaLista();
    // qtmaxima > 0 e qtestoque > qtmaxima, com ou sem venda (não exige quantidadeVendida > 0)
    expect(sql).toContain('WHERE candidatos.estoqueMaximo > 0 AND candidatos.estoqueAtual > candidatos.estoqueMaximo');
    expect(sql).not.toMatch(/WHERE[^\n]*quantidadeVendida > 0/);
  });

  it("Produtos bloqueados (situacao = 'B') não entram em nenhuma classificação nem no resumo", async () => {
    mockarBanco();

    const res = await chamar();

    expect(res.status).toBe(200);
    expect(execute).toHaveBeenCalledTimes(3); // cobertura do cache + lista + resumo
    // a exclusão está na base compartilhada: lista e resumo (contagens) usam o mesmo filtro
    expect(consultaLista()[0].sql).toContain(FILTRO_NAO_BLOQUEADO);
    expect(consultaResumo()[0].sql).toContain(FILTRO_NAO_BLOQUEADO);
  });

  it("Produtos que não controlam estoque (`produto.Estoque = 'N'`) não entram em nenhuma classificação nem no `resumo`", async () => {
    // O banco (mockado) já devolve só quem controla estoque: o produto 99 (Estoque = 'N') não vem na lista nem nas contagens.
    mockarBanco({
      linhas: [
        { id: 1, nome: 'ARROZ 5KG', estoqueAtual: -3, estoqueMinimo: 10, estoqueMaximo: 100, quantidadeVendida: 90, coberturaDias: 0 },
      ],
      resumo: { ruptura: '1', proximoRuptura: '0', excesso: '0' },
    });

    for (const classificacao of ['ruptura', 'proximo_ruptura', 'excesso']) {
      const res = await chamar({ ...PERIODO, classificacao });

      expect(res.status).toBe(200);
      expect(res.body.itens.map((item) => item.id)).not.toContain(99);
      expect(res.body.resumo).toEqual({ ruptura: 1, proximoRuptura: 0, excesso: 0 });
    }

    // a exclusão está na base compartilhada: TODAS as consultas de dados (lista e resumo, das 3 classificações) filtram
    const consultasDeDados = execute.mock.calls.filter(([{ sql }]) => !ehCobertura(sql));
    expect(consultasDeDados).toHaveLength(6); // 3 classificações x (lista + resumo)
    for (const [{ sql }] of consultasDeDados) {
      expect(sql).toMatch(FILTRO_CONTROLA_ESTOQUE);
      expect(sql).toContain(FILTRO_NAO_BLOQUEADO); // o filtro de bloqueados continua valendo
    }
  });

  // Extras (um it por comportamento)
  it('a quantidade vendida vem do cache diário (SUM(quantidade) do período em datas ISO parametrizadas), sem tabelas transacionais', async () => {
    mockarBanco();

    await chamar();

    const [{ sql, timeout }, params] = consultaLista();
    expect(timeout).toBe(TIMEOUT_CONSULTA_MS);
    expect(sql).toContain('FROM vendas_produto_dia_cache');
    expect(sql).toContain('SUM(quantidade) AS quantidadeVendida');
    expect(sql).toContain('dia >= ? AND dia <= ?');
    expect(sql).toMatch(/produto > 0/);
    expect(sql).not.toMatch(/vendaitem|vendacupom|flagvc|STRAIGHT_JOIN/);
    expect(sql).not.toContain(PERIODO.inicio);
    expect(sql).toMatch(/LIMIT \?\s*$/);
    // dias do período -> período do cache (ISO) -> limite (ruptura não usa o limiar de cobertura)
    expect(params).toEqual([DIAS_SETEMBRO, ...periodoCache(), 50]);
  });

  it('lê o estoque de produto.qtestoque/qtminima/qtmaxima (NULL como 0); a flag produto.Estoque só aparece no filtro, nunca como quantidade', async () => {
    mockarBanco();

    await chamar();

    for (const [{ sql }] of execute.mock.calls.filter(([{ sql: s }]) => !ehCobertura(s))) {
      expect(sql).toContain('COALESCE(produto.qtestoque, 0)');
      expect(sql).toContain('produto.qtminima');
      expect(sql).toContain('produto.qtmaxima');
      expect(sql.replace(FILTRO_CONTROLA_ESTOQUE, '')).not.toMatch(/produto\.Estoque/);
    }
  });

  it.each([
    ['ruptura', /ORDER BY candidatos\.quantidadeVendida DESC, candidatos\.id\s+LIMIT \?\s*$/],
    ['proximo_ruptura', /ORDER BY candidatos\.coberturaDias, candidatos\.quantidadeVendida DESC, candidatos\.id\s+LIMIT \?\s*$/],
    ['excesso', /ORDER BY candidatos\.excesso DESC, candidatos\.id\s+LIMIT \?\s*$/],
  ])('ordenação de %s no SQL, por colunas simples da tabela derivada', async (classificacao, ordenacao) => {
    mockarBanco();

    await chamar({ ...PERIODO, classificacao });

    const [{ sql }] = consultaLista();
    expect(sql).toMatch(ordenacao);
    const orderBy = sql.match(/ORDER BY ([^\n]+)/)[1];
    // MariaDB 10.1: sem agregação/alias de agregação em expressão no ORDER BY
    expect(orderBy).not.toMatch(/SUM\(|\(|\)/);
  });

  it('próximo da ruptura: venda > 0 e estoque > 0 e (estoque <= mínimo OU cobertura < 7 dias), com o limiar como parâmetro', async () => {
    mockarBanco({
      linhas: [
        { id: 3, nome: 'A', estoqueAtual: 20, estoqueMinimo: 5, estoqueMaximo: null, quantidadeVendida: 90, coberturaDias: 6.666666666666667 },
      ],
      resumo: { ruptura: 0, proximoRuptura: 1, excesso: 0 },
    });

    const res = await chamar({ ...PERIODO, classificacao: 'proximo_ruptura' });

    expect(res.status).toBe(200);
    const { COBERTURA_MINIMA_DIAS } = require('../../../src/modules/estoque/estoque.service');
    expect(COBERTURA_MINIMA_DIAS).toBe(7);
    const [{ sql }, params] = consultaLista();
    expect(sql).toContain(
      'WHERE candidatos.quantidadeVendida > 0 AND candidatos.estoqueAtual > 0 AND ' +
        '(candidatos.estoqueAtual <= candidatos.estoqueMinimo OR candidatos.coberturaDias < ?)'
    );
    // dias -> período -> limiar -> limite
    expect(params).toEqual([DIAS_SETEMBRO, ...periodoCache(), 7, 50]);
    expect(res.body.itens[0]).toEqual({
      id: 3, nome: 'A', estoqueAtual: 20, estoqueMinimo: 5, estoqueMaximo: null,
      quantidadeVendida: 90, mediaDiaria: 3, coberturaDias: 6.67, classificacao: 'proximo_ruptura',
    });
  });

  it('cobertura: estoque <= 0 vale 0 e produto sem venda tem cobertura null (regra no SQL)', async () => {
    mockarBanco();

    await chamar();

    const [{ sql }] = consultaLista();
    expect(sql).toMatch(
      /IF\(COALESCE\(vendidos\.quantidadeVendida, 0\) > 0, IF\(COALESCE\(produto\.qtestoque, 0\) <= 0, 0, COALESCE\(produto\.qtestoque, 0\) \* \? \/ vendidos\.quantidadeVendida\), NULL\) AS coberturaDias/
    );
  });

  it('resumo: uma consulta de contagens com os mesmos filtros (período, departamento, bloqueados), sem limite', async () => {
    mockarBanco({ resumo: { ruptura: '3', proximoRuptura: null, excesso: '8' } });

    const res = await chamar({ ...PERIODO, nivel: 'setor', id: '5', limite: '10' });

    expect(res.status).toBe(200);
    expect(res.body.resumo).toEqual({ ruptura: 3, proximoRuptura: 0, excesso: 8 });
    const departamento = buildDepartmentFilter({ nivel: 'setor', id: '5' });
    const [{ sql, timeout }, params] = consultaResumo();
    expect(timeout).toBe(TIMEOUT_CONSULTA_MS);
    expect(sql).not.toMatch(/LIMIT/);
    expect(sql).toContain(departamento.clause);
    expect(sql).toContain(FILTRO_NAO_BLOQUEADO);
    expect(sql).toMatch(FILTRO_CONTROLA_ESTOQUE);
    expect(sql).toContain('FROM vendas_produto_dia_cache');
    expect(sql).not.toMatch(/vendaitem|vendacupom|flagvc/);
    // o limiar aparece no SELECT externo, antes da subconsulta: limiar -> dias -> período (cache, ISO) -> departamento
    expect(params).toEqual([7, DIAS_SETEMBRO, ...periodoCache(), ...departamento.params]);
  });

  it('totalItens é o total da classificação pedida (antes do limite), vindo do resumo', async () => {
    mockarBanco({
      linhas: [{ id: 7, nome: 'X', estoqueAtual: 300, estoqueMinimo: null, estoqueMaximo: 100, quantidadeVendida: 0, coberturaDias: null }],
      resumo: { ruptura: 9, proximoRuptura: 4, excesso: 120 },
    });

    const res = await chamar({ ...PERIODO, classificacao: 'excesso', limite: '1' });

    expect(res.body.limite).toBe(1);
    expect(res.body.itens).toHaveLength(1);
    expect(res.body.totalItens).toBe(120);
    expect(consultaLista()[1].slice(-1)).toEqual([1]);
  });

  it('aplica o filtro de departamento (nivel + id) parametrizado, na lista e no resumo', async () => {
    mockarBanco();

    const res = await chamar({ ...PERIODO, nivel: 'grupo', id: '4', limite: '10' });

    expect(res.status).toBe(200);
    const departamento = buildDepartmentFilter({ nivel: 'grupo', id: '4' });
    const [{ sql }, params] = consultaLista();
    expect(sql).toContain(departamento.clause);
    expect(params).toEqual([DIAS_SETEMBRO, ...periodoCache(), ...departamento.params, 10]);
    expect(consultaResumo()[0].sql).toContain(departamento.clause);
  });

  it('classificação padrão é ruptura', async () => {
    mockarBanco();

    const res = await chamar();

    expect(res.body.classificacao).toBe('ruptura');
    expect(consultaLista()[0].sql).toContain('candidatos.estoqueAtual <= 0');
  });

  it.each(['abc', 'RUPTURA', "ruptura' OR 1=1 --", 'parados'])(
    'classificacao inválida (%s) retorna 400 sem consultar o banco',
    async (classificacao) => {
      const res = await chamar({ ...PERIODO, classificacao });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ erro: expect.stringMatching(/classifica/i) });
      expect(execute).not.toHaveBeenCalled();
    }
  );

  it.each(['0', '-3', 'abc', '1.5', '501'])('limite inválido (%s) retorna 400 sem consultar o banco', async (limite) => {
    const res = await chamar({ ...PERIODO, limite });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: expect.stringMatching(/limite/i) });
    expect(execute).not.toHaveBeenCalled();
  });

  it('limite 500 é aceito e vira o último parâmetro da lista', async () => {
    mockarBanco();

    const res = await chamar({ ...PERIODO, limite: '500' });

    expect(res.status).toBe(200);
    expect(res.body.limite).toBe(500);
    expect(consultaLista()[1].slice(-1)).toEqual([500]);
  });

  it('sem inicio/fim retorna 400 { erro } sem consultar o banco', async () => {
    const semTudo = await chamar({});
    const semFim = await chamar({ inicio: '2026-09-01' });

    for (const res of [semTudo, semFim]) {
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ erro: expect.any(String) });
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it('período inválido (fim anterior ao início) retorna 400', async () => {
    const res = await chamar({ inicio: '2026-09-30', fim: '2026-09-01' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: expect.any(String) });
    expect(execute).not.toHaveBeenCalled();
  });

  it('nivel sem id, id sem nivel ou nivel inválido retorna 400 sem consultar o banco', async () => {
    const semId = await chamar({ ...PERIODO, nivel: 'grupo' });
    const semNivel = await chamar({ ...PERIODO, id: '3' });
    const nivelInvalido = await chamar({ ...PERIODO, nivel: 'loja', id: '3' });

    for (const res of [semId, semNivel, nivelInvalido]) {
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ erro: expect.any(String) });
    }
    expect(execute).not.toHaveBeenCalled();
  });

  describe('dia fechado: fim efetivo limitado a ontem', () => {
    it('fim no futuro: o divisor (dias) e o filtro de período usam o fim efetivo; a resposta traz fim e fimSolicitado', async () => {
      fixarHoje(2026, 9, 25);
      mockarBanco({
        linhas: [{ id: 6, nome: 'Z', estoqueAtual: 0, estoqueMinimo: 2, estoqueMaximo: null, quantidadeVendida: 48, coberturaDias: 0 }],
        dias: listarDias('2026-09-01', '2026-09-24'),
      });

      const res = await chamar(PERIODO);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ inicio: '2026-09-01', fim: '2026-09-24', fimSolicitado: '2026-09-30' });
      // a cobertura do cache é exigida só até o fim efetivo (ontem)
      expect(execute.mock.calls[0][1]).toEqual(buildPeriodFilter('2026-09-01', '2026-09-24').params);
      expect(consultaLista()[1]).toEqual([24, ...periodoCache('2026-09-01', '2026-09-24'), 50]);
      expect(consultaResumo()[1]).toEqual([7, 24, ...periodoCache('2026-09-01', '2026-09-24')]);
      expect(res.body.itens[0].mediaDiaria).toBe(2);
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
      mockarBanco();

      const res = await chamar({ inicio: '2026-08-01', fim: '2026-08-31' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ inicio: '2026-08-01', fim: '2026-08-31', fimSolicitado: '2026-08-31' });
      expect(consultaLista()[1][0]).toBe(31);
    });
  });

  it('média diária = quantidadeVendida / dias e cobertura arredondadas a 2 casas; nulos de estoque saem como null', async () => {
    mockarBanco({
      linhas: [
        { id: 8, nome: null, estoqueAtual: 0, estoqueMinimo: null, estoqueMaximo: null, quantidadeVendida: 10, coberturaDias: 0 },
        { id: 9, nome: 'W', estoqueAtual: 5, estoqueMinimo: 1, estoqueMaximo: 9, quantidadeVendida: 10, coberturaDias: '1.6666666' },
      ],
    });

    const res = await chamar();

    expect(res.body.itens[0]).toMatchObject({ id: 8, nome: 'Sem descrição', mediaDiaria: 0.33, coberturaDias: 0, estoqueMinimo: null });
    expect(res.body.itens[1]).toMatchObject({ id: 9, mediaDiaria: 0.33, coberturaDias: 1.67 });
  });

  it('falha do banco retorna 500 genérico, sem vazar SQL nem mensagem do MariaDB, logando só o código', async () => {
    execute.mockRejectedValue(
      Object.assign(new Error("Unknown column 'produto.qtestoque' in SELECT ..."), { code: 'ER_BAD_FIELD_ERROR' })
    );

    const res = await chamar();

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ erro: 'Erro interno.' });
    expect(JSON.stringify(res.body)).not.toMatch(/qtestoque|SELECT|ER_BAD_FIELD_ERROR/);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const registro = errorSpy.mock.calls[0].join(' ');
    expect(registro).toContain('ER_BAD_FIELD_ERROR');
    expect(registro).not.toMatch(/SELECT|qtestoque|Unknown column/);
  });
});

describe('estoque.controller - erro inesperado (fora do service)', () => {
  let errorSpy;

  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('GET /niveis: erro inesperado responde 500 genérico e loga só o nome e o código do erro (nunca mensagem, pilha ou SQL)', async () => {
    const erro = Object.assign(new TypeError('Cannot read properties of undefined SELECT * FROM produto segredo'), {
      code: 'ERR_INESPERADO',
    });
    let appComFalha;
    jest.isolateModules(() => {
      jest.doMock('../../../src/modules/estoque/estoque.service', () => ({
        obterNiveisEstoque: jest.fn().mockRejectedValue(erro),
        ErroInternoEstoque: class ErroInternoEstoque extends Error {},
      }));
      const router = require('../../../src/modules/estoque/estoque.routes');
      appComFalha = express();
      appComFalha.use(BASE, router);
    });
    jest.dontMock('../../../src/modules/estoque/estoque.service');

    const res = await request(appComFalha).get(`${BASE}/niveis`).query(PERIODO);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ erro: 'Erro interno.' });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const registro = errorSpy.mock.calls[0].join(' ');
    expect(registro).toContain('TypeError');
    expect(registro).toContain('ERR_INESPERADO');
    expect(registro).not.toMatch(/SELECT|segredo|FROM produto|Cannot read/i);
  });
});
