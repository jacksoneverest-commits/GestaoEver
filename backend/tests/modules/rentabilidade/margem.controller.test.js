jest.mock('../../../src/db/connection', () => ({ getPool: jest.fn() }));

const express = require('express');
const request = require('supertest');
const { getPool } = require('../../../src/db/connection');
const { TIMEOUT_CONSULTA_MS } = require('../../../src/shared/timeoutConsulta');
const { listarDias } = require('../../../src/jobs/jobsComum');
const margemRouter = require('../../../src/modules/rentabilidade/margem.routes');

const ROTA = '/api/rentabilidade/margem';
const PERIODO = { inicio: '2026-09-01', fim: '2026-09-30' };
// Todos os dias dos períodos usados nos testes têm a sentinela fechada (cache "completo").
const DIAS_COBERTOS = listarDias('2026-08-01', '2026-09-30');

function montarApp() {
  const app = express();
  app.use('/api/rentabilidade', margemRouter);
  return app;
}

// Linha como o mysql2 devolve (DECIMAL como string).
function linha(id, nome, faturamento, custoTotal, itensSemCusto = 0) {
  return {
    id,
    nome,
    faturamento: String(faturamento),
    custoTotal: custoTotal === null ? null : String(custoTotal),
    itensSemCusto,
  };
}

const ehConsultaCobertura = (sql) => sql.includes('atualizado_em >=');

describe('GET /api/rentabilidade/margem', () => {
  let execute;
  let errorSpy;
  let app;

  // A verificação de cobertura do cache vem primeiro (identificada pelo SQL); a consulta de
  // margem é a segunda chamada. `diasCobertos` controla a resposta da verificação de cobertura.
  function mockBanco({ linhas = [], diasCobertos = DIAS_COBERTOS } = {}) {
    execute.mockImplementation(async ({ sql }) => {
      if (ehConsultaCobertura(sql)) return [diasCobertos.map((dia) => ({ dia })), []];
      return [linhas, []];
    });
  }

  function consultaCobertura() {
    return execute.mock.calls.find(([{ sql }]) => ehConsultaCobertura(sql));
  }

  function consultaMargem() {
    return execute.mock.calls.find(([{ sql }]) => !ehConsultaCobertura(sql));
  }

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

  // Teste crítico 1 (PLAN.md, Task 11.1)
  it('margem por produto é calculada corretamente a partir do faturamento e do custo (CMV) do cache, agregada por agrupador (soma só os itens com custo; semCusto sinaliza quando falta)', async () => {
    mockBanco({
      linhas: [
        linha(1, 'ARROZ 5KG', 1000, 600, 0),
        linha(2, 'FEIJAO 1KG', 500, null, 3),
      ],
    });

    const res = await request(app).get(ROTA).query({ ...PERIODO, agrupador: 'produto' });

    expect(res.status).toBe(200);
    expect(res.body.itens).toEqual([
      { id: 1, nome: 'ARROZ 5KG', faturamento: 1000, custoTotal: 600, lucro: 400, margemPercentual: 40, semCusto: false },
      { id: 2, nome: 'FEIJAO 1KG', faturamento: 500, custoTotal: 0, lucro: 500, margemPercentual: 100, semCusto: true },
    ]);
  });

  // Teste crítico 2 (PLAN.md, Task 11.1)
  it('agrupador fora da lista permitida (produto, grupo, setor, familia) retorna status 400', async () => {
    const res = await request(app)
      .get(ROTA)
      .query({ ...PERIODO, agrupador: 'fornecedor' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: expect.stringMatching(/produto, grupo, setor, familia/) });
    expect(execute).not.toHaveBeenCalled();
  });

  it('a consulta lê só vendas_produto_dia_cache (produto > 0), sem tocar vendaitem, vendacupom nem flagvc', async () => {
    mockBanco({ linhas: [linha(1, 'ARROZ 5KG', 100, 50)] });

    await request(app).get(ROTA).query({ ...PERIODO, agrupador: 'produto' });

    const [{ sql, timeout }, params] = consultaMargem();
    expect(timeout).toBe(TIMEOUT_CONSULTA_MS);
    expect(sql).toContain('FROM vendas_produto_dia_cache');
    expect(sql).toMatch(/produto > 0/);
    expect(sql).not.toMatch(/vendaitem|vendacupom|flagvc/i);
    expect(params).toEqual([PERIODO.inicio, PERIODO.fim]);
  });

  it('verifica a cobertura do cache no período efetivo antes de consultar qualquer dado', async () => {
    mockBanco({ linhas: [linha(1, 'ARROZ 5KG', 100, 50)] });

    await request(app).get(ROTA).query({ ...PERIODO, agrupador: 'produto' });

    expect(execute).toHaveBeenCalledTimes(2);
    const [primeiraChamada] = execute.mock.calls[0];
    expect(ehConsultaCobertura(primeiraChamada.sql)).toBe(true);
  });

  it('cache incompleto: responde 503 sem consultar os dados de margem e sem logar erro inesperado', async () => {
    mockBanco({ linhas: [linha(1, 'ARROZ 5KG', 100, 50)], diasCobertos: [] });

    const res = await request(app).get(ROTA).query({ ...PERIODO, agrupador: 'produto' });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ erro: expect.any(String) });
    expect(consultaMargem()).toBeUndefined();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('semCusto não anula faturamento, custoTotal, lucro nem margemPercentual', async () => {
    mockBanco({ linhas: [linha(1, 'SEM CUSTO TOTAL', 300, null, 5)] });

    const res = await request(app).get(ROTA).query({ ...PERIODO, agrupador: 'produto' });

    expect(res.body.itens[0]).toEqual({
      id: 1, nome: 'SEM CUSTO TOTAL', faturamento: 300, custoTotal: 0, lucro: 300, margemPercentual: 100, semCusto: true,
    });
  });

  it('ordenarPor padrão é faturamento (desc, desempate por id)', async () => {
    mockBanco({
      linhas: [linha(1, 'A', 200, 100), linha(2, 'B', 500, 100), linha(3, 'C', 500, 400)],
    });

    const res = await request(app).get(ROTA).query({ ...PERIODO, agrupador: 'produto' });

    expect(res.body.ordenarPor).toBe('faturamento');
    expect(res.body.itens.map((item) => item.id)).toEqual([2, 3, 1]);
  });

  it('ordenarPor=lucro ordena pelo lucro decrescente', async () => {
    mockBanco({
      linhas: [linha(1, 'A', 200, 190), linha(2, 'B', 500, 100), linha(3, 'C', 300, 250)],
    });

    const res = await request(app).get(ROTA).query({ ...PERIODO, agrupador: 'produto', ordenarPor: 'lucro' });

    expect(res.body.ordenarPor).toBe('lucro');
    // lucros: A=10, B=400, C=50
    expect(res.body.itens.map((item) => item.id)).toEqual([2, 3, 1]);
  });

  it('ordenarPor=margemPercentual ordena pela margem percentual decrescente', async () => {
    mockBanco({
      linhas: [linha(1, 'A', 1000, 900), linha(2, 'B', 100, 10), linha(3, 'C', 200, 150)],
    });

    const res = await request(app).get(ROTA).query({ ...PERIODO, agrupador: 'produto', ordenarPor: 'margemPercentual' });

    expect(res.body.ordenarPor).toBe('margemPercentual');
    // margens: A=10%, B=90%, C=25%
    expect(res.body.itens.map((item) => item.id)).toEqual([2, 3, 1]);
  });

  it('ordenarPor fora da whitelist retorna 400 sem consultar o banco', async () => {
    const res = await request(app)
      .get(ROTA)
      .query({ ...PERIODO, agrupador: 'produto', ordenarPor: 'quantidade' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: expect.stringMatching(/Ordenação inválida/) });
    expect(execute).not.toHaveBeenCalled();
  });

  it('resumo agrega TODO o filtro (antes do limite), não só os itens paginados', async () => {
    mockBanco({
      linhas: [linha(1, 'A', 500, 100), linha(2, 'B', 300, 50, 2), linha(3, 'C', 200, 40)],
    });

    const res = await request(app).get(ROTA).query({ ...PERIODO, agrupador: 'produto', limite: '1' });

    expect(res.body.totalItens).toBe(3);
    expect(res.body.itens).toHaveLength(1);
    expect(res.body.resumo).toEqual({
      faturamento: 1000,
      custoTotal: 190,
      lucro: 810,
      margemPercentual: 81,
      semCusto: true,
    });
  });

  it('id filtra os produtos da dimensão (grupo): WHERE produto.grupo = ? na consulta por produto', async () => {
    mockBanco({ linhas: [linha(101, 'COCA COLA 2L', 600, 150)] });

    const res = await request(app).get(ROTA).query({ ...PERIODO, agrupador: 'grupo', id: '5' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ agrupador: 'grupo', id: 5 });
    expect(res.body.itens.map((item) => item.id)).toEqual([101]);
    const [{ sql }, params] = consultaMargem();
    expect(sql).toContain('produto.grupo = ?');
    expect(sql).toContain('agregado.produto AS id');
    expect(params).toEqual([PERIODO.inicio, PERIODO.fim, 5]);
  });

  // Achado da revisão da Fase 11: falta um teste travando que o `resumo` reflete SÓ os produtos do
  // `id` informado, não o total geral. A query real filtra `produto.grupo = ?` no WHERE (ver teste
  // acima), então o banco já devolveria só as linhas do grupo 5 — o mock aqui simula exatamente isso
  // (nunca linhas de outro grupo, ex.: grupo 9, misturadas na resposta). Se o resumo fosse calculado
  // a partir de um universo maior/diferente das linhas filtradas, este teste falharia.
  it('resumo com agrupador=grupo&id=5 soma só os produtos do grupo 5 (a query já filtra por id), não um total geral', async () => {
    mockBanco({
      linhas: [
        linha(101, 'COCA COLA 2L', 600, 150), // produto do grupo 5
        linha(102, 'GUARANA 2L', 400, 100), // produto do grupo 5
        // Nenhuma linha do grupo 9 (ou de qualquer outro grupo) aparece aqui: o WHERE
        // produto.grupo = 5 já as exclui antes de chegar ao service.
      ],
    });

    const res = await request(app).get(ROTA).query({ ...PERIODO, agrupador: 'grupo', id: '5' });

    expect(res.status).toBe(200);
    expect(res.body.itens.map((item) => item.id)).toEqual([101, 102]);
    expect(res.body.resumo).toEqual({
      faturamento: 1000, // 600 + 400 — só o grupo 5, nunca somado com outro grupo
      custoTotal: 250, // 150 + 100
      lucro: 750,
      margemPercentual: 75,
      semCusto: false,
    });
  });

  it.each([
    ['grupo', 'Sem grupo'],
    ['setor', 'Sem setor'],
    ['familia', 'Sem família'],
  ])('agrupador=%s sem descrição vira "%s" (id 0, COALESCE)', async (agrupador, nomeEsperado) => {
    mockBanco({ linhas: [linha(0, null, 100, 40)] });

    const res = await request(app).get(ROTA).query({ ...PERIODO, agrupador });

    expect(res.body.itens[0]).toMatchObject({ id: 0, nome: nomeEsperado });
  });

  it('fim futuro é limitado a ontem: resposta traz fim efetivo e fimSolicitado', async () => {
    mockBanco({ linhas: [], diasCobertos: listarDias('2026-10-01', '2026-10-14') });

    const res = await request(app)
      .get(ROTA)
      .query({ inicio: '2026-10-01', fim: '2026-10-20', agrupador: 'produto' });

    expect(res.status).toBe(200);
    expect(res.body.fim).toBe('2026-10-14');
    expect(res.body.fimSolicitado).toBe('2026-10-20');
  });

  it('inicio posterior a ontem retorna 400 sem consultar o banco', async () => {
    const res = await request(app)
      .get(ROTA)
      .query({ inicio: '2026-10-15', fim: '2026-10-20', agrupador: 'produto' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: expect.any(String) });
    expect(execute).not.toHaveBeenCalled();
  });

  it('limite inválido (zero, negativo, texto, decimal, acima de 1000) retorna 400 sem consultar o banco', async () => {
    const respostas = await Promise.all(
      ['0', '-5', 'abc', '1.5', '1001'].map((limite) =>
        request(app).get(ROTA).query({ ...PERIODO, agrupador: 'produto', limite })
      )
    );

    respostas.forEach((res) => {
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ erro: expect.stringMatching(/Limite inválido/) });
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('id inválido (zero, negativo, texto, decimal) retorna 400 sem consultar o banco', async () => {
    const respostas = await Promise.all(
      ['0', '-3', 'abc', '1.5'].map((id) => request(app).get(ROTA).query({ ...PERIODO, agrupador: 'grupo', id }))
    );

    respostas.forEach((res) => {
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ erro: expect.any(String) });
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('inicio e fim são obrigatórios (400)', async () => {
    const respostas = await Promise.all([
      request(app).get(ROTA).query({ agrupador: 'produto' }),
      request(app).get(ROTA).query({ agrupador: 'produto', inicio: '2026-09-01' }),
    ]);

    respostas.forEach((res) => {
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ erro: expect.any(String) });
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('erro do banco retorna 500 genérico, sem vazar SQL nem mensagem do MariaDB, e loga só o código', async () => {
    execute.mockRejectedValue(
      Object.assign(new Error("Table 'vendas_produto_dia_cache' doesn't exist"), {
        code: 'ER_NO_SUCH_TABLE',
        sql: 'SELECT ... FROM vendas_produto_dia_cache',
      })
    );

    const res = await request(app).get(ROTA).query({ ...PERIODO, agrupador: 'produto' });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ erro: 'Erro interno.' });
    expect(JSON.stringify(res.body)).not.toMatch(/SELECT|vendas_produto_dia_cache|ER_NO_SUCH_TABLE/i);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0].join(' ')).toContain('ER_NO_SUCH_TABLE');
    expect(errorSpy.mock.calls[0].join(' ')).not.toMatch(/SELECT|doesn't exist/i);
  });

  it('sem produtos com movimento no período responde 200 com lista vazia e resumo zerado', async () => {
    mockBanco({ linhas: [] });

    const res = await request(app).get(ROTA).query({ ...PERIODO, agrupador: 'produto' });

    expect(res.status).toBe(200);
    expect(res.body.totalItens).toBe(0);
    expect(res.body.itens).toEqual([]);
    expect(res.body.resumo).toEqual({ faturamento: 0, custoTotal: 0, lucro: 0, margemPercentual: 0, semCusto: false });
  });
});

describe('margem.controller - erro inesperado (fora do service)', () => {
  let errorSpy;

  function montarAppComServicoQueFalha(erro) {
    let appComFalha;
    jest.isolateModules(() => {
      jest.doMock('../../../src/modules/rentabilidade/margem.service', () => ({
        obterMargem: jest.fn().mockRejectedValue(erro),
        ErroInternoMargem: class ErroInternoMargem extends Error {},
      }));
      const router = require('../../../src/modules/rentabilidade/margem.routes');
      appComFalha = express();
      appComFalha.use('/api/rentabilidade', router);
    });
    jest.dontMock('../../../src/modules/rentabilidade/margem.service');
    return appComFalha;
  }

  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('erro inesperado responde 500 genérico e loga só o nome e o código do erro', async () => {
    const erro = Object.assign(new TypeError('Cannot read properties of undefined SELECT * FROM produto segredo'), {
      code: 'ERR_INESPERADO',
    });
    const appComFalha = montarAppComServicoQueFalha(erro);

    const res = await request(appComFalha).get(ROTA).query({ ...PERIODO, agrupador: 'produto' });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ erro: 'Erro interno.' });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const registro = errorSpy.mock.calls[0].join(' ');
    expect(registro).toContain('TypeError');
    expect(registro).toContain('ERR_INESPERADO');
    expect(registro).not.toMatch(/SELECT|segredo|produto|Cannot read/i);
  });
});
