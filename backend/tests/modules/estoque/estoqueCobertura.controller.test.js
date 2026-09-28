jest.mock('../../../src/db/connection', () => ({ getPool: jest.fn() }));

const express = require('express');
const request = require('supertest');
const { getPool } = require('../../../src/db/connection');
const { TIMEOUT_CONSULTA_MS } = require('../../../src/shared/timeoutConsulta');
const { buildPeriodFilter, buildDepartmentFilter } = require('../../../src/shared/queryFilters');
const { listarDias } = require('../../../src/jobs/jobsComum');
const estoqueCoberturaRouter = require('../../../src/modules/estoque/estoqueCobertura.routes');

const BASE = '/api/estoque';
const PERIODO = { inicio: '2026-09-01', fim: '2026-09-30' };
// Cache diário: todos os dias dos períodos usados nos testes têm a sentinela fechada (Task 13.3).
const DIAS_COBERTOS = listarDias('2026-08-01', '2026-09-30');
const SITUACAO_NAO_BLOQUEADO ="COALESCE(produto.situacao, '') <> 'B'";
// Produto que não controla estoque (produto.Estoque = 'N') fica fora; NULL conta como controla (robusto a NULL).
const FILTRO_CONTROLA_ESTOQUE = /COALESCE\(\s*produto\.Estoque\s*,\s*'S'\s*\)\s*(<>|!=)\s*'N'/;

function montarApp() {
  const app = express();
  app.use(BASE, estoqueCoberturaRouter);
  return app;
}

describe('estoqueCobertura (cobertura, parados)', () => {
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

  // Período da consulta de quantidade vendida no cache (datas ISO: dia >= ? AND dia <= ?).
  const periodo = (inicio = PERIODO.inicio, fim = PERIODO.fim) => ({ params: [inicio, fim] });
  const ehTotal = (sql) => /COUNT\(\*\)/.test(sql);
  const ehCobertura = (sql) => sql.includes('atualizado_em >=');
  const consultaLista = () => execute.mock.calls.find(([{ sql }]) => !ehTotal(sql) && !ehCobertura(sql));
  const consultaTotal = () => execute.mock.calls.find(([{ sql }]) => ehTotal(sql));
  const consultasDeDados = () => execute.mock.calls.filter(([{ sql }]) => !ehCobertura(sql));

  // A verificação de cobertura do cache vem primeiro; lista e totais são consultas distintas: o mock responde
  // conforme o SQL (a ordem entre elas não importa).
  function mockar({ linhas = [], totais = { totalItens: linhas.length, valorTotalParado: '0.0000' }, dias = DIAS_COBERTOS } = {}) {
    execute.mockImplementation(async ({ sql }) => {
      if (ehCobertura(sql)) return [dias.map((dia) => ({ dia })), []];
      return ehTotal(sql) ? [[totais], []] : [linhas, []];
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

  describe('/cobertura', () => {
    const chamar = (query = PERIODO) => request(app).get(`${BASE}/cobertura`).query(query);

    // Teste crítico 1 (PLAN.md, Task 13.2)
    it('cobertura em dias é calculada como estoque atual dividido pela média diária de vendas do período, para um produto com histórico conhecido', async () => {
      // 90 unidades vendidas em 30 dias = média 3/dia; estoque 60 => cobertura 20 dias
      mockar({
        linhas: [{ id: 1, nome: 'ARROZ 5KG', estoqueAtual: 60, quantidadeVendida: 90, coberturaDias: 20 }],
        totais: { totalItens: 1 },
      });

      const res = await chamar({ ...PERIODO, limite: '20' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        inicio: '2026-09-01',
        fim: '2026-09-30',
        fimSolicitado: '2026-09-30',
        limite: 20,
        totalItens: 1,
        itens: [{ id: 1, nome: 'ARROZ 5KG', estoqueAtual: 60, quantidadeVendida: 90, mediaDiaria: 3, coberturaDias: 20 }],
      });

      // no SQL: cobertura = estoque * dias / quantidadeVendida (= estoque / média diária), dias inclusivos como 1º parâmetro
      const [{ sql, timeout }, params] = consultaLista();
      expect(timeout).toBe(TIMEOUT_CONSULTA_MS);
      expect(sql).toContain('produto.qtestoque * ? / vendidos.quantidadeVendida) AS coberturaDias');
      expect(params).toEqual([30, ...periodo().params, 20]);
    });

    it('conta só produtos com venda no período lida do cache (SUM(quantidade) > 0, produto > 0), parametrizado, sem tabelas transacionais', async () => {
      mockar();

      await chamar();

      const [{ sql }, params] = consultaLista();
      expect(sql).toContain('FROM vendas_produto_dia_cache');
      expect(sql).toContain('dia >= ? AND dia <= ?');
      expect(sql).toMatch(/produto > 0/);
      expect(sql).toContain('SUM(quantidade) AS quantidadeVendida');
      expect(sql).toMatch(/HAVING SUM\(quantidade\) > 0/);
      expect(sql).not.toMatch(/vendaitem|vendacupom|flagvc|STRAIGHT_JOIN/);
      expect(sql).toMatch(/INNER JOIN produto ON produto\.idProduto = vendidos\.produto/);
      expect(sql).not.toContain(PERIODO.inicio);
      expect(params).toEqual([30, ...periodo().params, 50]);
    });

    it('estoque atual vem de produto.qtestoque; a flag Estoque só aparece no filtro e o custo não é usado', async () => {
      mockar();

      await chamar();

      const [{ sql }] = consultaLista();
      expect(sql).toContain('produto.qtestoque');
      expect(sql.replace(FILTRO_CONTROLA_ESTOQUE, '')).not.toMatch(/produto\.Estoque/);
      expect(sql).not.toMatch(/precocusto/);
    });

    it('ordena pela menor cobertura (desempate quantidadeVendida desc, id) por colunas simples, sem alias de agregação em expressão (ER_ILLEGAL_REFERENCE no MariaDB 10.1)', async () => {
      mockar();

      await chamar();

      const [{ sql }] = consultaLista();
      expect(sql).toMatch(/ORDER BY candidatos\.coberturaDias, candidatos\.quantidadeVendida DESC, candidatos\.id\s+LIMIT \?\s*$/);
      const orderBy = sql.match(/ORDER BY ([^\n]+)/)[1];
      expect(orderBy).not.toMatch(/SUM\(|\(|\)/);
      expect(sql.slice(sql.indexOf('ORDER BY'))).not.toMatch(/SUM\(/);
    });

    it('estoque zero, negativo ou nulo tem cobertura 0 (regra no SQL) e estoque nulo sai como null na resposta', async () => {
      mockar({
        linhas: [
          { id: 4, nome: 'SEM SALDO', estoqueAtual: null, quantidadeVendida: 15, coberturaDias: 0 },
          { id: 5, nome: 'NEGATIVO', estoqueAtual: -3, quantidadeVendida: 30, coberturaDias: 0 },
        ],
      });

      const res = await chamar();

      const [{ sql }] = consultaLista();
      expect(sql).toMatch(/IF\(COALESCE\(produto\.qtestoque, 0\) <= 0, 0, /);
      expect(res.body.itens).toEqual([
        { id: 4, nome: 'SEM SALDO', estoqueAtual: null, quantidadeVendida: 15, mediaDiaria: 0.5, coberturaDias: 0 },
        { id: 5, nome: 'NEGATIVO', estoqueAtual: -3, quantidadeVendida: 30, mediaDiaria: 1, coberturaDias: 0 },
      ]);
    });

    it('médias e cobertura saem com 2 casas decimais e nome ausente vira "Sem descrição"', async () => {
      mockar({
        linhas: [{ id: 6, nome: null, estoqueAtual: '20', quantidadeVendida: '100', coberturaDias: 6.000000001 }],
      });

      const res = await chamar();

      expect(res.body.itens).toEqual([
        { id: 6, nome: 'Sem descrição', estoqueAtual: 20, quantidadeVendida: 100, mediaDiaria: 3.33, coberturaDias: 6 },
      ]);
    });

    it('totalItens vem de uma consulta de contagem separada (mesmo filtro, sem LIMIT), não do tamanho da página', async () => {
      mockar({ linhas: [{ id: 1, nome: 'A', estoqueAtual: 5, quantidadeVendida: 30, coberturaDias: 5 }], totais: { totalItens: '120' } });

      const res = await chamar({ ...PERIODO, limite: '1' });

      expect(res.status).toBe(200);
      expect(res.body.totalItens).toBe(120);
      expect(res.body.itens).toHaveLength(1);
      expect(execute).toHaveBeenCalledTimes(3); // cobertura do cache + lista + total
      const [{ sql, timeout }, params] = consultaTotal();
      expect(timeout).toBe(TIMEOUT_CONSULTA_MS);
      expect(sql).toContain('FROM vendas_produto_dia_cache');
      expect(sql).not.toMatch(/vendaitem|vendacupom|flagvc/);
      expect(sql).toContain(SITUACAO_NAO_BLOQUEADO);
      expect(sql).not.toMatch(/LIMIT/);
      expect(params).toEqual(periodo().params);
    });

    // Teste crítico 3 (PLAN.md, Task 13.2) — vale para cobertura e parados no mesmo teste
    it('produtos bloqueados (situacao = B) não aparecem em cobertura nem em parados', async () => {
      mockar();

      await chamar();
      await request(app).get(`${BASE}/parados`).query(PERIODO);

      // 2 rotas x (cobertura do cache + lista + total) = 6 consultas; as 4 de dados têm o filtro de bloqueado
      expect(execute).toHaveBeenCalledTimes(6);
      expect(consultasDeDados()).toHaveLength(4);
      for (const [{ sql }] of consultasDeDados()) {
        expect(sql).toContain(`WHERE ${SITUACAO_NAO_BLOQUEADO}`);
      }
    });

    // Teste crítico 4 (PLAN.md, Task 13.2) — vale para cobertura e parados no mesmo teste
    it("Produtos que não controlam estoque (`produto.Estoque = 'N'`) não aparecem em cobertura nem em parados (nem no `valorTotalParado`)", async () => {
      // O banco (mockado) já devolve só quem controla estoque: o produto 99 (Estoque = 'N') não vem nas listas nem nas somas.
      mockar({
        linhas: [{ id: 1, nome: 'ARROZ 5KG', estoqueAtual: 60, quantidadeVendida: 90, coberturaDias: 20 }],
        totais: { totalItens: 1, valorTotalParado: '125.0000' },
      });

      const cobertura = await chamar();
      const parados = await request(app).get(`${BASE}/parados`).query(PERIODO);

      expect(cobertura.body.itens.map((item) => item.id)).not.toContain(99);
      expect(cobertura.body.totalItens).toBe(1);
      expect(parados.body.itens.map((item) => item.id)).not.toContain(99);
      expect(parados.body.totalItens).toBe(1);
      expect(parados.body.valorTotalParado).toBe(125);

      // 2 rotas x (lista + total): as 4 consultas de dados (inclusive a soma do valorTotalParado) filtram Estoque
      expect(consultasDeDados()).toHaveLength(4);
      for (const [{ sql }] of consultasDeDados()) {
        expect(sql).toMatch(FILTRO_CONTROLA_ESTOQUE);
        expect(sql).toContain(SITUACAO_NAO_BLOQUEADO); // o filtro de bloqueados continua valendo
      }
    });

    it('aplica o filtro de departamento (nivel + id) parametrizado na lista e no total, e o limite informado', async () => {
      mockar();

      const res = await chamar({ ...PERIODO, nivel: 'grupo', id: '4', limite: '10' });

      expect(res.status).toBe(200);
      const departamento = buildDepartmentFilter({ nivel: 'grupo', id: '4' });
      const [{ sql }, params] = consultaLista();
      expect(sql).toContain(departamento.clause);
      expect(params).toEqual([30, ...periodo().params, ...departamento.params, 10]);
      const [{ sql: sqlTotal }, paramsTotal] = consultaTotal();
      expect(sqlTotal).toContain(departamento.clause);
      expect(paramsTotal).toEqual([...periodo().params, ...departamento.params]);
    });

    it('fim no futuro: o divisor (dias) e o filtro de período usam o fim efetivo (ontem); a resposta traz fim e fimSolicitado', async () => {
      fixarHoje(2026, 9, 25);
      mockar({
        linhas: [{ id: 7, nome: 'Z', estoqueAtual: 10, quantidadeVendida: 48, coberturaDias: 5 }],
        dias: listarDias('2026-09-01', '2026-09-24'),
      });

      const res = await chamar(PERIODO);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ inicio: '2026-09-01', fim: '2026-09-24', fimSolicitado: '2026-09-30', limite: 50 });
      const efetivo = periodo('2026-09-01', '2026-09-24');
      expect(consultaLista()[1]).toEqual([24, ...efetivo.params, 50]);
      expect(consultaTotal()[1]).toEqual(efetivo.params);
      // a cobertura do cache é exigida só até o fim efetivo (ontem)
      expect(execute.mock.calls[0][1]).toEqual(buildPeriodFilter('2026-09-01', '2026-09-24').params);
      expect(res.body.itens[0].mediaDiaria).toBe(2);
    });

    it('a média diária usa os dias inclusivos do período (1 dia e 10 dias)', async () => {
      mockar({ linhas: [{ id: 5, nome: 'Y', estoqueAtual: 1, quantidadeVendida: 20, coberturaDias: 0.05 }] });

      const umDia = await chamar({ inicio: '2026-09-10', fim: '2026-09-10' });
      const dezDias = await chamar({ inicio: '2026-09-01', fim: '2026-09-10' });

      expect(consultaLista()[1][0]).toBe(1);
      expect(umDia.body.itens[0].mediaDiaria).toBe(20);
      expect(dezDias.body.itens[0].mediaDiaria).toBe(2);
    });

    it('inicio a partir de hoje (nenhum dia fechado) retorna 400 { erro } claro, sem consultar o banco', async () => {
      fixarHoje(2026, 9, 25);
      mockar();

      const res = await chamar({ inicio: '2026-09-25', fim: '2026-09-30' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ erro: expect.stringMatching(/fechado/i) });
      expect(res.body.erro).toContain('2026-09-24');
      expect(execute).not.toHaveBeenCalled();
    });
  });

  describe('/parados', () => {
    const chamar = (query = PERIODO) => request(app).get(`${BASE}/parados`).query(query);

    // Teste crítico 2 (PLAN.md, Task 13.2)
    it('produto com estoque positivo e sem vendas registradas no período aparece em /parados e entra no valorTotalParado (estoque x custo)', async () => {
      mockar({
        linhas: [
          { id: 11, nome: 'PRODUTO SEM GIRO A', estoqueAtual: 10, custoUnitario: '12.5000', valorParado: '125.0000' },
          { id: 12, nome: null, estoqueAtual: 4, custoUnitario: null, valorParado: 0 },
        ],
        totais: { totalItens: 2, valorTotalParado: '125.0000' },
      });

      const res = await chamar();

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        inicio: '2026-09-01',
        fim: '2026-09-30',
        fimSolicitado: '2026-09-30',
        limite: 50,
        totalItens: 2,
        valorTotalParado: 125,
        itens: [
          { id: 11, nome: 'PRODUTO SEM GIRO A', estoqueAtual: 10, custoUnitario: 12.5, valorParado: 125 },
          { id: 12, nome: 'Sem descrição', estoqueAtual: 4, custoUnitario: 0, valorParado: 0 },
        ],
      });

      // só produtos com estoque positivo, custo = precocusto (COALESCE 0) e valor = estoque x custo, no SQL
      const [{ sql, timeout }] = consultaLista();
      expect(timeout).toBe(TIMEOUT_CONSULTA_MS);
      expect(sql).toMatch(/produto\.qtestoque > 0/);
      expect(sql).toContain('COALESCE(produto.precocusto, 0) AS custoUnitario');
      expect(sql).toContain('produto.qtestoque * COALESCE(produto.precocusto, 0) AS valorParado');
    });

    it('a venda válida e o período ficam DENTRO da subconsulta do LEFT JOIN (parado = vendidos.produto IS NULL), sem virar INNER JOIN', async () => {
      mockar();

      await chamar();

      const [{ sql }, params] = consultaLista();
      expect(sql).toMatch(/LEFT JOIN \(/);
      expect(sql).toMatch(/vendidos\.produto IS NULL/);
      expect(sql).toContain('FROM vendas_produto_dia_cache');
      expect(sql).toContain('dia >= ? AND dia <= ?');
      expect(sql).not.toMatch(/vendaitem|vendacupom|flagvc/);
      // o filtro do cache/período existe uma única vez, na subconsulta; o WHERE externo não o repete
      const subconsulta = sql.slice(sql.indexOf('LEFT JOIN ('), sql.indexOf(') AS vendidos'));
      const externo = sql.replace(subconsulta, '');
      expect(subconsulta).toContain('dia >= ? AND dia <= ?');
      expect(externo).not.toContain('dia >= ? AND dia <= ?');
      expect(externo).not.toContain('vendas_produto_dia_cache');
      expect(externo).not.toMatch(/INNER JOIN vendidos/);
      expect(sql).not.toContain(PERIODO.inicio);
      expect(params).toEqual([...periodo().params, 50]);
    });

    it('venda líquida <= 0 (cupom cancelado depois, devolução) não conta como venda: a subconsulta de vendidos tem HAVING SUM(quantidade) > 0', async () => {
      mockar();

      await chamar();

      const [{ sql }] = consultaLista();
      expect(sql).toMatch(/HAVING SUM\(quantidade\) > 0/);
    });

    it('ordena por valor parado desc (desempate id) por colunas simples e limita a página', async () => {
      mockar();

      await chamar({ ...PERIODO, limite: '7' });

      const [{ sql }, params] = consultaLista();
      expect(sql).toMatch(/ORDER BY candidatos\.valorParado DESC, candidatos\.id\s+LIMIT \?\s*$/);
      expect(sql.slice(sql.indexOf('ORDER BY'))).not.toMatch(/SUM\(|\(.*\(/);
      expect(params[params.length - 1]).toBe(7);
    });

    it('valorTotalParado e totalItens somam TODOS os parados do filtro por uma consulta separada, sem LIMIT (não só a página)', async () => {
      mockar({
        linhas: [{ id: 11, nome: 'A', estoqueAtual: 10, custoUnitario: 12.5, valorParado: 125 }],
        totais: { totalItens: '300', valorTotalParado: '98765.4321' },
      });

      const res = await chamar({ ...PERIODO, limite: '1' });

      expect(res.body.itens).toHaveLength(1);
      expect(res.body.totalItens).toBe(300);
      expect(res.body.valorTotalParado).toBe(98765.43);
      expect(execute).toHaveBeenCalledTimes(3); // cobertura do cache + lista + total
      const [{ sql, timeout }, params] = consultaTotal();
      expect(timeout).toBe(TIMEOUT_CONSULTA_MS);
      expect(sql).toMatch(/SUM\(produto\.qtestoque \* COALESCE\(produto\.precocusto, 0\)\)/);
      expect(sql).toMatch(/LEFT JOIN \(/);
      expect(sql).toMatch(/vendidos\.produto IS NULL/);
      expect(sql).toMatch(/produto\.qtestoque > 0/);
      expect(sql).toContain(SITUACAO_NAO_BLOQUEADO);
      expect(sql).not.toMatch(/LIMIT/);
      expect(params).toEqual(periodo().params);
    });

    it('sem nenhum parado: totalItens 0 e valorTotalParado 0 (SUM nulo do banco)', async () => {
      mockar({ linhas: [], totais: { totalItens: 0, valorTotalParado: null } });

      const res = await chamar();

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ totalItens: 0, valorTotalParado: 0, itens: [] });
    });

    it('aplica o filtro de departamento (nivel + id) parametrizado na lista e no total', async () => {
      mockar();

      const res = await chamar({ ...PERIODO, nivel: 'setor', id: '5' });

      expect(res.status).toBe(200);
      const departamento = buildDepartmentFilter({ nivel: 'setor', id: '5' });
      const [{ sql }, params] = consultaLista();
      expect(sql).toContain(departamento.clause);
      expect(params).toEqual([...periodo().params, ...departamento.params, 50]);
      expect(consultaTotal()[1]).toEqual([...periodo().params, ...departamento.params]);
    });

    it('fim no futuro: o período consultado é o fim efetivo (ontem); a resposta traz fim e fimSolicitado', async () => {
      fixarHoje(2026, 9, 25);
      mockar({ dias: listarDias('2026-09-01', '2026-09-24') });

      const res = await chamar(PERIODO);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ inicio: '2026-09-01', fim: '2026-09-24', fimSolicitado: '2026-09-30' });
      const efetivo = periodo('2026-09-01', '2026-09-24');
      expect(execute.mock.calls[0][1]).toEqual(buildPeriodFilter('2026-09-01', '2026-09-24').params);
      expect(consultaLista()[1]).toEqual([...efetivo.params, 50]);
      expect(consultaTotal()[1]).toEqual(efetivo.params);
    });

    it('inicio a partir de hoje retorna 400 { erro } claro, sem consultar o banco', async () => {
      fixarHoje(2026, 9, 25);

      const res = await chamar({ inicio: '2026-09-25', fim: '2026-09-30' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ erro: expect.stringMatching(/fechado/i) });
      expect(execute).not.toHaveBeenCalled();
    });
  });

  describe('validação e erros (as duas rotas)', () => {
    const ROTAS = ['cobertura', 'parados'];

    it.each(ROTAS)('GET /%s sem inicio/fim retorna 400 { erro } sem consultar o banco', async (rota) => {
      const res = await request(app).get(`${BASE}/${rota}`);

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ erro: expect.any(String) });
      expect(execute).not.toHaveBeenCalled();
    });

    it.each(ROTAS)('GET /%s com período inválido (fim anterior ao início) retorna 400', async (rota) => {
      const res = await request(app).get(`${BASE}/${rota}`).query({ inicio: '2026-09-30', fim: '2026-09-01' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ erro: expect.any(String) });
      expect(execute).not.toHaveBeenCalled();
    });

    it.each(ROTAS)('GET /%s: limite inválido (0, negativo, texto, decimal, 501) retorna 400 sem consultar o banco', async (rota) => {
      for (const limite of ['0', '-3', 'abc', '1.5', '501']) {
        const res = await request(app).get(`${BASE}/${rota}`).query({ ...PERIODO, limite });

        expect(res.status).toBe(400);
        expect(res.body).toEqual({ erro: expect.stringMatching(/limite/i) });
      }
      expect(execute).not.toHaveBeenCalled();
    });

    it.each(ROTAS)('GET /%s: limite 500 é aceito', async (rota) => {
      mockar({ totais: { totalItens: 0, valorTotalParado: 0 } });

      const res = await request(app).get(`${BASE}/${rota}`).query({ ...PERIODO, limite: '500' });

      expect(res.status).toBe(200);
      expect(res.body.limite).toBe(500);
    });

    it.each(ROTAS)('GET /%s: nivel sem id, id sem nivel ou nivel inválido retornam 400 sem consultar o banco', async (rota) => {
      const semId = await request(app).get(`${BASE}/${rota}`).query({ ...PERIODO, nivel: 'grupo' });
      const semNivel = await request(app).get(`${BASE}/${rota}`).query({ ...PERIODO, id: '3' });
      const nivelInvalido = await request(app).get(`${BASE}/${rota}`).query({ ...PERIODO, nivel: 'loja', id: '3' });

      for (const res of [semId, semNivel, nivelInvalido]) {
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ erro: expect.any(String) });
      }
      expect(execute).not.toHaveBeenCalled();
    });

    it.each(ROTAS)('GET /%s: falha do banco retorna 500 genérico, sem vazar SQL nem mensagem do MariaDB, logando só o código', async (rota) => {
      execute.mockRejectedValue(
        Object.assign(new Error("Unknown column 'produto.qtestoque' in SELECT * FROM produto"), { code: 'ER_BAD_FIELD_ERROR' })
      );

      const res = await request(app).get(`${BASE}/${rota}`).query(PERIODO);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ erro: 'Erro interno.' });
      expect(JSON.stringify(res.body)).not.toMatch(/qtestoque|SELECT|ER_BAD_FIELD_ERROR/);
      expect(errorSpy).toHaveBeenCalled();
      const registro = errorSpy.mock.calls.map((chamada) => chamada.join(' ')).join(' ');
      expect(registro).toContain('ER_BAD_FIELD_ERROR');
      expect(registro).not.toMatch(/SELECT|FROM produto|Unknown column/i);
    });

    it('não expõe /vencimento (adiado por decisão do usuário): a rota não existe', async () => {
      const res = await request(app).get(`${BASE}/vencimento`).query(PERIODO);

      expect(res.status).toBe(404);
      expect(execute).not.toHaveBeenCalled();
    });
  });
});

describe('estoqueCobertura.controller - erro inesperado (fora do service)', () => {
  let errorSpy;

  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  // Router com o service substituído por um que rejeita com um erro que não é de validação nem o erro
  // interno (esse o próprio service já loga).
  function montarAppComServicoQueFalha(erro) {
    let appComFalha;
    jest.isolateModules(() => {
      const rejeita = () => jest.fn().mockRejectedValue(erro);
      jest.doMock('../../../src/modules/estoque/estoqueCobertura.service', () => ({
        obterCobertura: rejeita(),
        obterProdutosParados: rejeita(),
        ErroInternoEstoqueCobertura: class ErroInternoEstoqueCobertura extends Error {},
      }));
      const router = require('../../../src/modules/estoque/estoqueCobertura.routes');
      appComFalha = express();
      appComFalha.use(BASE, router);
    });
    jest.dontMock('../../../src/modules/estoque/estoqueCobertura.service');
    return appComFalha;
  }

  it.each(['cobertura', 'parados'])(
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
