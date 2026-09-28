jest.mock('../../../src/db/connection', () => ({ getPool: jest.fn() }));

const express = require('express');
const request = require('supertest');
const { getPool } = require('../../../src/db/connection');
const { JOIN_VENDA_VALIDA, WHERE_VENDA_VALIDA } = require('../../../src/shared/vendaValida');
const { buildPeriodFilter } = require('../../../src/shared/queryFilters');
const { TIMEOUT_CONSULTA_MS } = require('../../../src/shared/timeoutConsulta');
const curvaAbcRouter = require('../../../src/modules/curvaAbc/curvaAbc.routes');

const ROTA = '/api/curva-abc';
const PERIODO = { inicio: '2026-09-01', fim: '2026-09-30' };

function montarApp() {
  const app = express();
  app.use('/api/curva-abc', curvaAbcRouter);
  return app;
}

// Linha de venda como o mysql2 devolve (DECIMAL como string, flag como 0/1).
function venda(id, nome, faturamento, lucro = faturamento, semCusto = 0) {
  return { id, nome, faturamento: String(faturamento), lucro: String(lucro), semCusto };
}

function estoque(id, nome, valorEstoque) {
  return { id, nome, valorEstoque: String(valorEstoque) };
}

describe('GET /api/curva-abc', () => {
  let execute;
  let errorSpy;
  let app;

  // Responde pela forma do SQL: a consulta de vendas parte de vendacupom; a de estoque parte de produto.
  function mockBanco({ vendas = [], estoques = [] } = {}) {
    execute.mockImplementation(async ({ sql }) => [/FROM vendacupom/.test(sql) ? vendas : estoques, []]);
  }

  function consultaDeVendas() {
    return execute.mock.calls.find(([{ sql }]) => /FROM vendacupom/.test(sql));
  }

  function consultaDeEstoque() {
    return execute.mock.calls.find(([{ sql }]) => !/FROM vendacupom/.test(sql));
  }

  beforeEach(() => {
    execute = jest.fn();
    getPool.mockReturnValue({ execute });
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    app = montarApp();
  });

  afterEach(() => {
    errorSpy.mockRestore();
    getPool.mockReset();
  });

  // Teste crítico 1 (PLAN.md, Task 9.1)
  it('classifica como "A" em venda os itens dos primeiros 80% do faturamento acumulado (B até 95%, C o restante)', async () => {
    mockBanco({
      vendas: [
        venda(1, 'BEBIDAS', 500),
        venda(2, 'MERCEARIA', 300),
        venda(3, 'LIMPEZA', 100),
        venda(4, 'HORTIFRUTI', 50),
        venda(5, 'PADARIA', 30),
        venda(6, 'AÇOUGUE', 20),
      ],
    });

    const res = await request(app).get(ROTA).query({ ...PERIODO, agrupador: 'grupo' });

    expect(res.status).toBe(200);
    expect(res.body.totalItens).toBe(6);
    expect(res.body.itens.map((item) => [item.id, item.classificacaoVenda])).toEqual([
      [1, 'A'],
      [2, 'A'],
      [3, 'B'],
      [4, 'B'],
      [5, 'C'],
      [6, 'C'],
    ]);
    expect(res.body.itens.map((item) => item.participacaoVenda)).toEqual([50, 30, 10, 5, 3, 2]);
    expect(res.body.itens.map((item) => item.acumuladoVenda)).toEqual([50, 80, 90, 95, 98, 100]);
  });

  // Teste crítico 2 (PLAN.md, Task 9.1)
  it('não quebra quando o item não tem estoque nem vendas no período (200, sem erro 500)', async () => {
    mockBanco({ vendas: [venda(9, 'SEM MOVIMENTO', 0, 0)], estoques: [estoque(9, 'SEM MOVIMENTO', 0)] });

    const res = await request(app).get(ROTA).query({ ...PERIODO, agrupador: 'grupo' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      agrupador: 'grupo',
      inicio: PERIODO.inicio,
      fim: PERIODO.fim,
      limite: 100,
      totalItens: 0,
      itens: [],
    });
  });

  // Teste crítico 3 (PLAN.md, Task 9.1)
  it('para agrupador fora da lista permitida retorna status 400', async () => {
    const res = await request(app)
      .get(ROTA)
      .query({ ...PERIODO, agrupador: 'produto; DROP TABLE produto' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: expect.stringMatching(/produto, grupo, setor, familia, marca, cliente/) });
    expect(execute).not.toHaveBeenCalled();
  });

  // Teste crítico 4 (PLAN.md, Task 9.1)
  it('com agrupador=cliente mostra o cliente 0 como "Venda consumidor" e não classifica o estoque (null)', async () => {
    mockBanco({
      vendas: [venda(0, null, 700, 200), venda(7, 'MARIA DA SILVA', 300, 100)],
      estoques: [estoque(1, 'NAO DEVE SER CONSULTADO', 999)],
    });

    const res = await request(app).get(ROTA).query({ ...PERIODO, agrupador: 'cliente' });

    expect(res.status).toBe(200);
    expect(res.body.itens[0]).toMatchObject({
      id: 0,
      nome: 'Venda consumidor',
      faturamento: 700,
      valorEstoque: null,
      classificacaoEstoque: null,
      classificacaoVenda: 'A',
    });
    expect(res.body.itens[1]).toMatchObject({ id: 7, nome: 'MARIA DA SILVA', valorEstoque: null, classificacaoEstoque: null });
    // estoque não se aplica a cliente: nenhuma consulta de estoque
    expect(execute).toHaveBeenCalledTimes(1);
    const [{ sql }] = consultaDeVendas();
    expect(sql).toContain('clifor.cod = vendacupom.cliente');
    expect(sql).toContain('clifor.nome');
    // só o nome do cliente é lido de clifor (dados pessoais nunca)
    expect(sql.match(/clifor\.\w+/g).filter((coluna) => !['clifor.cod', 'clifor.nome'].includes(coluna))).toEqual([]);
  });

  it('sem agrupador retorna 400', async () => {
    const res = await request(app).get(ROTA).query(PERIODO);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: expect.any(String) });
    expect(execute).not.toHaveBeenCalled();
  });

  describe('agrupador=fornecedor (Task 9.2: curva de compras)', () => {
    const FORNECEDOR = { ...PERIODO, agrupador: 'fornecedor' };

    function compra(id, nome, valorCompras) {
      return { id, nome, valorCompras: String(valorCompras) };
    }

    function mockCompras(linhas = []) {
      execute.mockImplementation(async () => [linhas, []]);
    }

    // Teste crítico 1 (PLAN.md, Task 9.2)
    it('soma compranota.TotalNota por fornecedor (só ES = E e Status = 1, período parametrizado) e as classes A/B/C seguem o acumulado', async () => {
      // fora de ordem de propósito: o service ordena por valorCompras decrescente
      mockCompras([
        compra(6, 'FORN F', 20),
        compra(1, 'FORN A', 500),
        compra(4, 'FORN D', 50),
        compra(2, 'FORN B', 300),
        compra(5, 'FORN E', 30),
        compra(3, 'FORN C', 100),
      ]);

      const res = await request(app).get(ROTA).query(FORNECEDOR);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        agrupador: 'fornecedor',
        inicio: PERIODO.inicio,
        fim: PERIODO.fim,
        limite: 100,
        totalItens: 6,
      });
      expect(res.body.itens.map((item) => [item.id, item.valorCompras, item.classificacaoCompra])).toEqual([
        [1, 500, 'A'],
        [2, 300, 'A'],
        [3, 100, 'B'],
        [4, 50, 'B'],
        [5, 30, 'C'],
        [6, 20, 'C'],
      ]);
      expect(res.body.itens.map((item) => item.participacaoCompra)).toEqual([50, 30, 10, 5, 3, 2]);
      expect(res.body.itens.map((item) => item.acumuladoCompra)).toEqual([50, 80, 90, 95, 98, 100]);
      expect(res.body.itens[0].nome).toBe('FORN A');

      expect(execute).toHaveBeenCalledTimes(1);
      const periodo = buildPeriodFilter(PERIODO.inicio, PERIODO.fim, 'compranota.data');
      const [opcoes, params] = execute.mock.calls[0];
      expect(opcoes.timeout).toBe(TIMEOUT_CONSULTA_MS);
      expect(opcoes.sql).toMatch(/SUM\(compranota\.TotalNota\) AS valorCompras/);
      expect(opcoes.sql).toContain('FROM compranota');
      expect(opcoes.sql).toContain('compranota.fornecedor = clifor.cod');
      expect(opcoes.sql).toContain('compranota.Status = 1');
      expect(opcoes.sql).toContain("compranota.ES = 'E'");
      expect(opcoes.sql).toContain(periodo.clause);
      expect(opcoes.sql).toMatch(/GROUP BY compranota\.fornecedor/);
      expect(opcoes.sql).not.toContain(PERIODO.inicio);
      expect(params).toEqual(periodo.params);
    });

    // Teste crítico 2 (PLAN.md, Task 9.2)
    it('com id retorna status 400 com mensagem clara, sem consultar o banco', async () => {
      const res = await request(app).get(ROTA).query({ ...FORNECEDOR, id: '7' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ erro: 'Escolher um fornecedor específico não é suportado nesta curva.' });
      expect(execute).not.toHaveBeenCalled();
    });

    it('não acessa compraitem, vendaitem nem vendacupom e só lê clifor.cod e clifor.nome', async () => {
      mockCompras([compra(1, 'FORN A', 100)]);

      await request(app).get(ROTA).query(FORNECEDOR);

      const [{ sql }] = execute.mock.calls[0];
      expect(sql).not.toMatch(/compraitem|vendaitem|vendacupom/i);
      const colunasClifor = sql.match(/clifor\.\w+/g);
      expect(colunasClifor.filter((coluna) => !['clifor.cod', 'clifor.nome'].includes(coluna))).toEqual([]);
    });

    it('os itens não trazem campos de venda, margem nem estoque', async () => {
      mockCompras([compra(1, 'FORN A', 100)]);

      const res = await request(app).get(ROTA).query(FORNECEDOR);

      expect(Object.keys(res.body.itens[0]).sort()).toEqual(
        ['acumuladoCompra', 'classificacaoCompra', 'id', 'nome', 'participacaoCompra', 'valorCompras'].sort()
      );
    });

    it('aplica o limite DEPOIS de classificar: totalItens é o total antes do corte e as classes vêm do universo inteiro', async () => {
      mockCompras([compra(3, 'C', 200), compra(1, 'A', 500), compra(2, 'B', 300), compra(4, 'D', 200)]);

      const res = await request(app).get(ROTA).query({ ...FORNECEDOR, limite: '2' });

      expect(res.body.limite).toBe(2);
      expect(res.body.totalItens).toBe(4);
      expect(res.body.itens.map((item) => item.id)).toEqual([1, 2]);
      // participação e acumulado sobre o total de 1200, não sobre os 800 exibidos
      expect(res.body.itens.map((item) => item.participacaoCompra)).toEqual([41.67, 25]);
      expect(res.body.itens.map((item) => item.acumuladoCompra)).toEqual([41.67, 66.67]);
      expect(res.body.itens.map((item) => item.classificacaoCompra)).toEqual(['A', 'A']);
    });

    it('desempata valores iguais por id crescente', async () => {
      mockCompras([compra(9, 'Z', 100), compra(2, 'Y', 100)]);

      const res = await request(app).get(ROTA).query(FORNECEDOR);

      expect(res.body.itens.map((item) => item.id)).toEqual([2, 9]);
    });

    it('usa LEFT JOIN em clifor (fornecedor sem registro vira "Sem nome") e só inclui valorCompras > 0, contando só essas linhas em totalItens', async () => {
      // o HAVING do SQL já descarta valor <= 0; o service também, para que o universo seja igual ao da 9.1
      mockCompras([compra(1, null, 100), compra(2, 'ESTORNO', -10), compra(3, '  ', 0), compra(4, 'FORN D', 50), compra(0, null, 25)]);

      const res = await request(app).get(ROTA).query(FORNECEDOR);

      const [{ sql }] = execute.mock.calls[0];
      expect(sql).toMatch(/LEFT JOIN clifor ON compranota\.fornecedor = clifor\.cod/);
      expect(sql).not.toMatch(/INNER JOIN/);
      expect(sql).toMatch(/HAVING SUM\(compranota\.TotalNota\) > 0/);
      expect(sql).toMatch(/MAX\(clifor\.nome\) AS nome/);
      expect(res.status).toBe(200);
      expect(res.body.totalItens).toBe(3);
      expect(res.body.itens.map((item) => [item.id, item.nome])).toEqual([
        [1, 'Sem nome'],
        [4, 'FORN D'],
        [0, 'Sem nome'],
      ]);
    });

    it('sem compras no período responde 200 com lista vazia', async () => {
      mockCompras([]);

      const res = await request(app).get(ROTA).query(FORNECEDOR);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ...FORNECEDOR, limite: 100, totalItens: 0, itens: [] });
    });

    it('período inválido retorna 400 sem consultar o banco', async () => {
      const res = await request(app)
        .get(ROTA)
        .query({ agrupador: 'fornecedor', inicio: '2026-09-10', fim: '2026-09-01' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ erro: expect.any(String) });
      expect(execute).not.toHaveBeenCalled();
    });

    it('erro do banco retorna 500 genérico, sem vazar SQL nem mensagem do MariaDB', async () => {
      execute.mockRejectedValue(
        Object.assign(new Error("Table 'compranota' doesn't exist"), {
          code: 'ER_NO_SUCH_TABLE',
          sql: 'SELECT ... FROM compranota',
        })
      );

      const res = await request(app).get(ROTA).query(FORNECEDOR);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ erro: 'Erro interno.' });
      expect(JSON.stringify(res.body)).not.toMatch(/SELECT|compranota|ER_NO_SUCH_TABLE/i);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0].join(' ')).toContain('ER_NO_SUCH_TABLE');
      expect(errorSpy.mock.calls[0].join(' ')).not.toMatch(/SELECT|compranota/i);
    });
  });

  it('inicio e fim são obrigatórios e validados (400)', async () => {
    const respostas = await Promise.all([
      request(app).get(ROTA).query({ agrupador: 'produto' }),
      request(app).get(ROTA).query({ agrupador: 'produto', inicio: '2026-09-01' }),
      request(app).get(ROTA).query({ agrupador: 'produto', inicio: '2026-09-10', fim: '2026-09-01' }),
      request(app).get(ROTA).query({ agrupador: 'produto', inicio: '01/09/2026', fim: '30/09/2026' }),
    ]);

    respostas.forEach((res) => {
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ erro: expect.any(String) });
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('id inválido (zero, negativo, texto, decimal) retorna 400', async () => {
    const respostas = await Promise.all(
      ['0', '-3', 'abc', '1.5', '1; DROP TABLE produto'].map((id) =>
        request(app).get(ROTA).query({ ...PERIODO, agrupador: 'grupo', id })
      )
    );

    respostas.forEach((res) => {
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ erro: expect.any(String) });
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('limite inválido (zero, negativo, texto, decimal, acima de 1000) retorna 400', async () => {
    const respostas = await Promise.all(
      ['0', '-5', 'abc', '1.5', '1001'].map((limite) =>
        request(app).get(ROTA).query({ ...PERIODO, agrupador: 'grupo', limite })
      )
    );

    respostas.forEach((res) => {
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ erro: expect.any(String) });
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('aplica o limite DEPOIS de classificar: totalItens é o total antes do corte e as classes vêm do universo inteiro', async () => {
    mockBanco({ vendas: [venda(1, 'A1', 500), venda(2, 'A2', 300), venda(3, 'A3', 200)] });

    const res = await request(app).get(ROTA).query({ ...PERIODO, agrupador: 'grupo', limite: '2' });

    expect(res.status).toBe(200);
    expect(res.body.limite).toBe(2);
    expect(res.body.totalItens).toBe(3);
    expect(res.body.itens).toHaveLength(2);
    // participação e acumulado calculados sobre o total de 1000 (e não sobre os 800 exibidos)
    expect(res.body.itens.map((item) => item.participacaoVenda)).toEqual([50, 30]);
    expect(res.body.itens.map((item) => item.acumuladoVenda)).toEqual([50, 80]);
    expect(res.body.itens.map((item) => item.classificacaoVenda)).toEqual(['A', 'A']);
  });

  it('a linha que cruza os 80% acumulados ainda é "A"', async () => {
    mockBanco({ vendas: [venda(1, 'GRANDE', 700), venda(2, 'CRUZA', 200), venda(3, 'PEQUENO', 100)] });

    const res = await request(app).get(ROTA).query({ ...PERIODO, agrupador: 'setor' });

    // acumulado antes da 2ª linha = 70% (< 80%): A, mesmo somando 90% depois dela; 3ª começa em 90% (< 95%): B
    expect(res.body.itens.map((item) => item.classificacaoVenda)).toEqual(['A', 'A', 'B']);
  });

  it('acumulado exatamente em 80% e 95% já pertence à classe seguinte (B e C)', async () => {
    mockBanco({
      vendas: [venda(1, 'X1', 50), venda(2, 'X2', 30), venda(3, 'X3', 10), venda(4, 'X4', 5), venda(5, 'X5', 3), venda(6, 'X6', 2)],
    });

    const res = await request(app).get(ROTA).query({ ...PERIODO, agrupador: 'familia' });

    // antes de X3 o acumulado é 80% (não < 80%): B; antes de X5 é 95% (não < 95%): C
    expect(res.body.itens.map((item) => item.classificacaoVenda)).toEqual(['A', 'A', 'B', 'B', 'C', 'C']);
  });

  it('classifica margem e estoque de forma independente da venda, cada uma ordenada pela própria métrica', async () => {
    mockBanco({
      vendas: [venda(1, 'VENDE MUITO', 500, 10), venda(2, 'LUCRA MUITO', 300, 200)],
      estoques: [estoque(1, 'VENDE MUITO', 100), estoque(2, 'LUCRA MUITO', 900)],
    });

    const res = await request(app).get(ROTA).query({ ...PERIODO, agrupador: 'grupo' });

    const [vendeMuito, lucraMuito] = res.body.itens;
    // margem: 200 de 210 (95,2%) -> LUCRA MUITO é A e VENDE MUITO começa em 95,2% (C);
    // estoque: 900 de 1000 -> LUCRA MUITO é A e VENDE MUITO começa em 90% (B)
    expect(vendeMuito).toMatchObject({ id: 1, classificacaoVenda: 'A', classificacaoMargem: 'C', classificacaoEstoque: 'B' });
    expect(lucraMuito).toMatchObject({ id: 2, classificacaoVenda: 'A', classificacaoMargem: 'A', classificacaoEstoque: 'A' });
    expect(vendeMuito.valorEstoque).toBe(100);
    expect(lucraMuito.lucro).toBe(200);
  });

  it('métricas menores ou iguais a zero (ou sem valor) são "C" e não entram na participação', async () => {
    mockBanco({
      vendas: [venda(1, 'NORMAL', 400, 100), venda(2, 'PREJUIZO', 100, -50)],
      estoques: [estoque(3, 'SO ESTOQUE', 500)],
    });

    const res = await request(app).get(ROTA).query({ ...PERIODO, agrupador: 'grupo' });

    const porId = Object.fromEntries(res.body.itens.map((item) => [item.id, item]));
    // só estoque: sem venda, C em venda e margem, participação 0
    expect(porId[3]).toMatchObject({
      faturamento: 0,
      lucro: 0,
      valorEstoque: 500,
      participacaoVenda: 0,
      classificacaoVenda: 'C',
      classificacaoMargem: 'C',
      classificacaoEstoque: 'A',
    });
    // lucro negativo: C em margem; a participação de margem só considera lucros positivos
    expect(porId[2]).toMatchObject({ lucro: -50, classificacaoMargem: 'C', classificacaoEstoque: 'C', valorEstoque: 0 });
    expect(porId[1]).toMatchObject({ classificacaoMargem: 'A' });
    // itens ordenados por faturamento decrescente (empate: valorEstoque decrescente)
    expect(res.body.itens.map((item) => item.id)).toEqual([1, 2, 3]);
  });

  it('ordena os itens por faturamento decrescente, desempatando por valorEstoque decrescente e id', async () => {
    mockBanco({
      vendas: [venda(5, 'B', 100), venda(1, 'A', 300), venda(4, 'C', 100), venda(3, 'D', 100)],
      estoques: [estoque(4, 'C', 50), estoque(3, 'D', 10), estoque(5, 'B', 10)],
    });

    const res = await request(app).get(ROTA).query({ ...PERIODO, agrupador: 'marca' });

    expect(res.body.itens.map((item) => item.id)).toEqual([1, 4, 3, 5]);
  });

  it('semCusto é true quando algum item vendido da linha tem pcusto nulo', async () => {
    mockBanco({
      vendas: [venda(1, 'COM CUSTO', 300, 100, 0), venda(2, 'SEM CUSTO', 200, 40, 1)],
    });

    const res = await request(app).get(ROTA).query({ ...PERIODO, agrupador: 'grupo' });

    expect(res.body.itens.map((item) => [item.id, item.semCusto])).toEqual([
      [1, false],
      [2, true],
    ]);
    const [{ sql }] = consultaDeVendas();
    // só itens COM pcusto entram no lucro (pcusto = 0 é custo válido) e a flag vem de pcusto IS NULL
    expect(sql).toMatch(/IF\(vendaitem\.pcusto IS NULL, 0, vendaitem\.vtotal - vendaitem\.qt \* vendaitem\.pcusto\)/);
    expect(sql).toMatch(/MAX\(vendaitem\.pcusto IS NULL\) AS semCusto/);
  });

  it('itens só com estoque (sem venda no período) entram no universo e linhas com venda e estoque são unidas por id', async () => {
    mockBanco({
      vendas: [venda(1, 'VENDIDO', 400, 100)],
      estoques: [estoque(1, 'VENDIDO', 250), estoque(2, 'PARADO', 750)],
    });

    const res = await request(app).get(ROTA).query({ ...PERIODO, agrupador: 'setor' });

    expect(res.body.totalItens).toBe(2);
    expect(res.body.itens).toEqual([
      expect.objectContaining({ id: 1, nome: 'VENDIDO', faturamento: 400, valorEstoque: 250, semCusto: false }),
      expect.objectContaining({ id: 2, nome: 'PARADO', faturamento: 0, lucro: 0, valorEstoque: 750, semCusto: false }),
    ]);
  });

  it('com id, as linhas são os PRODUTOS do item: filtro parametrizado em vendas e estoque e id na resposta', async () => {
    mockBanco({
      vendas: [venda(101, 'COCA COLA 2L', 600, 150)],
      estoques: [estoque(101, 'COCA COLA 2L', 80), estoque(102, 'GUARANA 2L', 20)],
    });

    const res = await request(app).get(ROTA).query({ ...PERIODO, agrupador: 'grupo', id: '5' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ agrupador: 'grupo', id: 5, totalItens: 2 });
    expect(res.body.itens.map((item) => item.id)).toEqual([101, 102]);

    const periodo = buildPeriodFilter(PERIODO.inicio, PERIODO.fim);
    const [{ sql: sqlVendas }, paramsVendas] = consultaDeVendas();
    expect(sqlVendas).toContain('produto.grupo = ?');
    expect(sqlVendas).toContain('GROUP BY vendaitem.produto');
    expect(paramsVendas).toEqual([...periodo.params, 5]);
    const [{ sql: sqlEstoque }, paramsEstoque] = consultaDeEstoque();
    expect(sqlEstoque).toContain('produto.grupo = ?');
    expect(sqlEstoque).toContain('GROUP BY produto.idProduto');
    expect(paramsEstoque).toEqual([5]);
  });

  it('com agrupador=cliente e id, as linhas são os produtos comprados por aquele cliente (estoque continua null)', async () => {
    mockBanco({ vendas: [venda(101, 'COCA COLA 2L', 90, 20)] });

    const res = await request(app).get(ROTA).query({ ...PERIODO, agrupador: 'cliente', id: '7' });

    expect(res.status).toBe(200);
    expect(res.body.itens).toEqual([
      expect.objectContaining({ id: 101, nome: 'COCA COLA 2L', valorEstoque: null, classificacaoEstoque: null }),
    ]);
    const periodo = buildPeriodFilter(PERIODO.inicio, PERIODO.fim);
    const [{ sql }, params] = consultaDeVendas();
    expect(sql).toContain('vendacupom.cliente = ?');
    expect(params).toEqual([...periodo.params, 7]);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('agrupador=produto com id restringe a um único produto', async () => {
    mockBanco({ vendas: [venda(101, 'COCA COLA 2L', 90, 20)], estoques: [estoque(101, 'COCA COLA 2L', 30)] });

    const res = await request(app).get(ROTA).query({ ...PERIODO, agrupador: 'produto', id: '101' });

    expect(res.status).toBe(200);
    expect(res.body.itens).toHaveLength(1);
    const [{ sql }, params] = consultaDeVendas();
    expect(sql).toContain('produto.idProduto = ?');
    expect(params.slice(-1)).toEqual([101]);
  });

  it.each([
    ['produto', 'vendaitem.produto AS id', 'produto.idProduto AS id'],
    ['grupo', 'COALESCE(produto.grupo, 0) AS id', 'COALESCE(produto.grupo, 0) AS id'],
    ['setor', 'COALESCE(produto.setor, 0) AS id', 'COALESCE(produto.setor, 0) AS id'],
    ['familia', 'COALESCE(produto.familia, 0) AS id', 'COALESCE(produto.familia, 0) AS id'],
    ['marca', 'COALESCE(produto.marca, 0) AS id', 'COALESCE(produto.marca, 0) AS id'],
  ])('agrupador=%s usa a coluna fixa da whitelist nas consultas de vendas e estoque', async (agrupador, chaveVendas, chaveEstoque) => {
    mockBanco();

    const res = await request(app).get(ROTA).query({ ...PERIODO, agrupador });

    expect(res.status).toBe(200);
    expect(consultaDeVendas()[0].sql).toContain(chaveVendas);
    expect(consultaDeEstoque()[0].sql).toContain(chaveEstoque);
  });

  it.each([
    ['grupo', 'grupo.idGrupo', 'grupo.Descricao'],
    ['setor', 'setor.idSetor', 'setor.Descricao'],
    ['familia', 'familia.idFamilia', 'familia.Descricao'],
    ['marca', 'marca.idMarca', 'marca.descricao'],
  ])('agrupador=%s busca o nome na tabela de descrição correta', async (agrupador, chave, descricao) => {
    mockBanco();

    await request(app).get(ROTA).query({ ...PERIODO, agrupador });

    const [{ sql }] = consultaDeVendas();
    expect(sql).toContain(chave);
    expect(sql).toContain(descricao);
  });

  it('itens da dimensão sem descrição recebem o nome "Sem <dimensão>"', async () => {
    mockBanco({ vendas: [venda(0, null, 100, 10)], estoques: [estoque(0, null, 5)] });

    const res = await request(app).get(ROTA).query({ ...PERIODO, agrupador: 'grupo' });

    expect(res.body.itens[0]).toMatchObject({ id: 0, nome: 'Sem grupo' });
  });

  it('as consultas são parametrizadas, com JOIN/WHERE de venda válida, período, valor líquido do item e timeout', async () => {
    mockBanco();

    await request(app).get(ROTA).query({ ...PERIODO, agrupador: 'grupo' });

    const periodo = buildPeriodFilter(PERIODO.inicio, PERIODO.fim);
    const [opcoes, params] = consultaDeVendas();
    expect(opcoes.timeout).toBe(TIMEOUT_CONSULTA_MS);
    expect(opcoes.sql).toContain(JOIN_VENDA_VALIDA);
    expect(opcoes.sql).toContain(WHERE_VENDA_VALIDA);
    expect(opcoes.sql).toContain(periodo.clause);
    expect(opcoes.sql).toContain('vendaitem.vtotal');
    expect(opcoes.sql).not.toMatch(/valortotal/i);
    expect(opcoes.sql).not.toContain(PERIODO.inicio);
    expect(params).toEqual(periodo.params);
  });

  it('o valor em estoque usa qtestoque × precocusto com estoque negativo contado como 0 e sem depender do período', async () => {
    mockBanco();

    await request(app).get(ROTA).query({ ...PERIODO, agrupador: 'grupo' });

    const [{ sql, timeout }, params] = consultaDeEstoque();
    expect(timeout).toBe(TIMEOUT_CONSULTA_MS);
    expect(sql).toContain('GREATEST(COALESCE(produto.qtestoque, 0), 0) * COALESCE(produto.precocusto, 0)');
    expect(sql).not.toContain('vendacupom');
    expect(sql).not.toContain('vendaitem');
    expect(params).toEqual([]);
  });

  // Teste crítico 3 (PLAN.md, Task 9.3)
  it('o valor de estoque da curva ignora produtos com situacao = B e as vendas deles continuam contando', async () => {
    // Produto 5 está bloqueado: vendeu no período, mas a consulta de estoque (que exclui bloqueados) não o devolve.
    // Produto 6 está ativo, com venda e estoque.
    mockBanco({
      vendas: [venda(5, 'BLOQUEADO COM VENDA', 300, 100), venda(6, 'ATIVO', 100, 30)],
      estoques: [estoque(6, 'ATIVO', 250)],
    });

    const res = await request(app).get(ROTA).query({ ...PERIODO, agrupador: 'produto' });

    expect(res.status).toBe(200);
    const bloqueado = res.body.itens.find((item) => item.id === 5);
    const ativo = res.body.itens.find((item) => item.id === 6);
    expect(bloqueado.faturamento).toBeGreaterThan(0);
    expect(bloqueado).toMatchObject({ faturamento: 300, valorEstoque: 0, classificacaoEstoque: 'C' });
    expect(ativo).toMatchObject({ faturamento: 100, valorEstoque: 250, classificacaoEstoque: 'A' });

    // a consulta de estoque exclui bloqueados (tolerante à redação: COALESCE, parênteses, <> ou !=) ...
    const [{ sql: sqlEstoque }] = consultaDeEstoque();
    expect(sqlEstoque).toMatch(/situacao[^A-Za-z]*(<>|!=)[^A-Za-z]*'B'/);
    // ... sem perder produto com situacao NULL (NULL <> 'B' daria NULL e sumiria do estoque em silêncio)
    expect(sqlEstoque).toMatch(/COALESCE\(\s*produto\.situacao\s*,\s*''\s*\)/);
    // vendas (histórico) não filtram por situação do produto
    const [{ sql: sqlVendas }] = consultaDeVendas();
    expect(sqlVendas).not.toMatch(/situacao/i);
  });

  it('a exclusão de produtos bloqueados no estoque combina com o filtro do id, sem novos parâmetros', async () => {
    mockBanco();

    await request(app).get(ROTA).query({ ...PERIODO, agrupador: 'setor', id: '4' });

    const [{ sql }, params] = consultaDeEstoque();
    expect(sql).toMatch(/WHERE[\s\S]*situacao[^A-Za-z]*(<>|!=)[^A-Za-z]*'B'[\s\S]*AND produto\.setor = \?/);
    expect(params).toEqual([4]);
  });

  it('agrupa o cliente por vendacupom.cliente: cliente 0 é "Venda consumidor" e cliente com código sem registro em clifor é um item próprio "Sem nome"', async () => {
    mockBanco({
      vendas: [venda(0, null, 500, 100), venda(55, null, 300, 60), venda(7, 'MARIA DA SILVA', 200, 40)],
    });

    const res = await request(app).get(ROTA).query({ ...PERIODO, agrupador: 'cliente' });

    expect(res.body.itens.map((item) => [item.id, item.nome])).toEqual([
      [0, 'Venda consumidor'],
      [55, 'Sem nome'],
      [7, 'MARIA DA SILVA'],
    ]);
    const [{ sql }] = consultaDeVendas();
    expect(sql).toContain('COALESCE(vendacupom.cliente, 0) AS id');
    expect(sql).toContain('GROUP BY COALESCE(vendacupom.cliente, 0)');
    expect(sql).toContain('MAX(clifor.nome) AS nome');
    expect(sql).toContain('LEFT JOIN clifor ON clifor.cod = vendacupom.cliente');
    // agrupar por clifor.cod fundiria o cliente 0 com os códigos sem registro
    expect(sql).not.toMatch(/COALESCE\(clifor\.cod/);
  });

  it('exporta AGRUPADORES_DE_VENDA com as dimensões de venda (sem fornecedor, que é a curva de compras)', () => {
    const { AGRUPADORES_DE_VENDA, AGRUPADORES_VALIDOS } = require('../../../src/modules/curvaAbc/curvaAbc.service');

    expect(AGRUPADORES_DE_VENDA).toEqual(['produto', 'grupo', 'setor', 'familia', 'marca', 'cliente']);
    expect(AGRUPADORES_VALIDOS).toBeUndefined();
  });

  it('erro do banco retorna 500 genérico, sem vazar SQL nem mensagem do MariaDB, e loga só o código', async () => {
    execute.mockRejectedValue(
      Object.assign(new Error("You have an error in your SQL syntax near 'FROM vendacupom'"), {
        code: 'ER_PARSE_ERROR',
        sqlMessage: 'segredo: tabela vendacupom',
        sql: 'SELECT ... FROM vendacupom',
      })
    );

    const res = await request(app).get(ROTA).query({ ...PERIODO, agrupador: 'grupo' });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ erro: 'Erro interno.' });
    expect(JSON.stringify(res.body)).not.toMatch(/SELECT|vendacupom|ER_PARSE_ERROR|segredo/i);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0].join(' ')).toContain('ER_PARSE_ERROR');
    expect(errorSpy.mock.calls[0].join(' ')).not.toMatch(/SELECT|segredo/i);
  });
});

describe('GET /api/curva-abc/itens (Task 9.3)', () => {
  const ITENS = `${ROTA}/itens`;
  let execute;
  let errorSpy;
  let app;

  // Responde pela forma do SQL: COUNT(*) devolve o total; a outra consulta devolve as linhas.
  function mockBanco({ linhas = [], total = linhas.length } = {}) {
    execute.mockImplementation(async ({ sql }) => [/COUNT\(\*\)/.test(sql) ? [{ total: String(total) }] : linhas, []]);
  }

  function consultaContagem() {
    return execute.mock.calls.find(([{ sql }]) => /COUNT\(\*\)/.test(sql));
  }

  function consultaLista() {
    return execute.mock.calls.find(([{ sql }]) => !/COUNT\(\*\)/.test(sql));
  }

  beforeEach(() => {
    execute = jest.fn();
    getPool.mockReturnValue({ execute });
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    app = montarApp();
  });

  afterEach(() => {
    errorSpy.mockRestore();
    getPool.mockReset();
  });

  // Teste crítico 1 (PLAN.md, Task 9.3)
  it('lista os cadastros da dimensão em ordem alfabética (grupo/setor/familia/marca/cliente) e, para produto, só situacao = A e exige busca de ao menos 2 caracteres', async () => {
    const fontes = [
      ['grupo', 'grupo', 'grupo.idGrupo', 'grupo.Descricao'],
      ['setor', 'setor', 'setor.idSetor', 'setor.Descricao'],
      ['familia', 'familia', 'familia.idFamilia', 'familia.Descricao'],
      ['marca', 'marca', 'marca.idMarca', 'marca.descricao'],
      ['cliente', 'clifor', 'clifor.cod', 'clifor.nome'],
    ];
    for (const [agrupador, tabela, chave, nome] of fontes) {
      execute.mockReset();
      mockBanco({ linhas: [{ id: 2, nome: 'ALFA' }, { id: 1, nome: 'BETA' }] });

      const res = await request(app).get(ITENS).query({ agrupador });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        agrupador,
        limite: 5000,
        totalItens: 2,
        itens: [{ id: 2, nome: 'ALFA' }, { id: 1, nome: 'BETA' }],
      });
      const [{ sql, timeout }] = consultaLista();
      expect(timeout).toBe(TIMEOUT_CONSULTA_MS);
      expect(sql).toContain(`${chave} AS id`);
      expect(sql).toContain(`${nome} AS nome`);
      expect(sql).toContain(`FROM ${tabela}`);
      expect(sql).toContain(`ORDER BY ${nome}, ${chave}`);
    }

    // produto: sem busca (ou com menos de 2 caracteres) é 400 e não consulta o banco
    execute.mockReset();
    mockBanco({ linhas: [{ id: 10, nome: 'ARROZ 5KG' }] });
    const semBusca = await request(app).get(ITENS).query({ agrupador: 'produto' });
    const umCaractere = await request(app).get(ITENS).query({ agrupador: 'produto', busca: 'a' });
    expect(semBusca.status).toBe(400);
    expect(umCaractere.status).toBe(400);
    expect(execute).not.toHaveBeenCalled();

    const comBusca = await request(app).get(ITENS).query({ agrupador: 'produto', busca: 'ar' });
    expect(comBusca.status).toBe(200);
    expect(comBusca.body).toEqual({
      agrupador: 'produto',
      busca: 'ar',
      limite: 50,
      totalItens: 1,
      itens: [{ id: 10, nome: 'ARROZ 5KG' }],
    });
    const [{ sql }] = consultaLista();
    expect(sql).toContain('produto.idProduto AS id');
    expect(sql).toContain('produto.descricao AS nome');
    expect(sql).toContain("produto.situacao = 'A'");
    expect(sql).toContain('ORDER BY produto.descricao, produto.idProduto');
  });

  // Teste crítico 2 (PLAN.md, Task 9.3)
  it('agrupador=fornecedor (ou inválido/ausente) retorna 400 com mensagem clara, sem consultar o banco', async () => {
    const fornecedor = await request(app).get(ITENS).query({ agrupador: 'fornecedor' });
    const invalido = await request(app).get(ITENS).query({ agrupador: 'grupo; DROP TABLE grupo' });
    const ausente = await request(app).get(ITENS);

    expect(fornecedor.status).toBe(400);
    expect(fornecedor.body).toEqual({ erro: 'Fornecedor não tem seleção de item.' });
    expect(invalido.status).toBe(400);
    expect(invalido.body).toEqual({ erro: expect.stringMatching(/grupo, setor, familia, marca, cliente ou produto/) });
    expect(ausente.status).toBe(400);
    expect(ausente.body).toEqual({ erro: expect.stringMatching(/grupo, setor, familia, marca, cliente ou produto/) });
    expect(execute).not.toHaveBeenCalled();
  });

  it('busca filtra por trecho do nome com LIKE parametrizado, escapando %, _ e a barra invertida', async () => {
    mockBanco({ linhas: [{ id: 1, nome: 'A%_B' }] });

    const res = await request(app).get(ITENS).query({ agrupador: 'grupo', busca: ' a%_b\\c ' });

    expect(res.status).toBe(200);
    expect(res.body.busca).toBe('a%_b\\c');
    const [{ sql: sqlLista }, paramsLista] = consultaLista();
    const [{ sql: sqlContagem }, paramsContagem] = consultaContagem();
    expect(sqlLista).toContain('WHERE grupo.Descricao LIKE ?');
    expect(sqlContagem).toContain('WHERE grupo.Descricao LIKE ?');
    expect(sqlLista).not.toContain('a%_b');
    expect(paramsContagem).toEqual(['%a\\%\\_b\\\\c%']);
    expect(paramsLista).toEqual(['%a\\%\\_b\\\\c%', 5000]);
  });

  // Teste crítico 4 (PLAN.md, Task 9.3)
  it('busca com várias palavras casa os itens cujo nome contém TODAS as palavras, em qualquer ordem (ex.: "arroz 5kg" encontra "ARROZ PILECCO SUPER ECCO 5KG T1"); máx. 6 palavras e 100 caracteres de busca (acima disso, 400)', async () => {
    mockBanco({ linhas: [{ id: 10, nome: 'ARROZ PILECCO SUPER ECCO 5KG T1' }] });

    const res = await request(app).get(ITENS).query({ agrupador: 'produto', busca: '5kg arroz' });

    expect(res.status).toBe(200);
    expect(res.body.itens).toEqual([{ id: 10, nome: 'ARROZ PILECCO SUPER ECCO 5KG T1' }]);
    const [{ sql: sqlLista }, paramsLista] = consultaLista();
    const [{ sql: sqlContagem }, paramsContagem] = consultaContagem();
    // um LIKE parametrizado por palavra, unidos por AND, na lista e no COUNT (nunca um LIKE com o texto inteiro)
    [sqlLista, sqlContagem].forEach((sql) => {
      expect(sql).toContain("WHERE produto.situacao = 'A' AND produto.descricao LIKE ? AND produto.descricao LIKE ?");
      expect(sql.match(/LIKE \?/g)).toHaveLength(2);
      expect(sql).not.toMatch(/5kg|arroz/);
    });
    expect(paramsContagem).toEqual(['%5kg%', '%arroz%']);
    expect(paramsLista).toEqual(['%5kg%', '%arroz%', 50]);

    // limites: 6 palavras e 100 caracteres passam; 7 palavras e 101 caracteres são 400 sem consultar o banco
    const seisPalavras = await request(app).get(ITENS).query({ agrupador: 'grupo', busca: 'a b c d e f' });
    const cemCaracteres = await request(app).get(ITENS).query({ agrupador: 'grupo', busca: 'a'.repeat(100) });
    expect(seisPalavras.status).toBe(200);
    expect(cemCaracteres.status).toBe(200);
    execute.mockClear();
    const setePalavras = await request(app).get(ITENS).query({ agrupador: 'grupo', busca: 'a b c d e f g' });
    const cemEUm = await request(app).get(ITENS).query({ agrupador: 'grupo', busca: 'a'.repeat(101) });
    expect(setePalavras.status).toBe(400);
    expect(cemEUm.status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });

  it('busca de uma palavra só gera um único LIKE, como antes', async () => {
    mockBanco({ linhas: [] });

    await request(app).get(ITENS).query({ agrupador: 'setor', busca: 'frios' });

    [consultaLista(), consultaContagem()].forEach(([{ sql }]) => {
      expect(sql).toContain('WHERE setor.Descricao LIKE ?');
      expect(sql.match(/LIKE \?/g)).toHaveLength(1);
    });
    expect(consultaContagem()[1]).toEqual(['%frios%']);
    expect(consultaLista()[1]).toEqual(['%frios%', 5000]);
  });

  it('espaços múltiplos e nas pontas entre as palavras são ignorados (sem palavras vazias)', async () => {
    mockBanco({ linhas: [] });

    const res = await request(app).get(ITENS).query({ agrupador: 'marca', busca: '  arroz \t  pilecco   5kg  ' });

    expect(res.status).toBe(200);
    expect(res.body.busca).toBe('arroz \t  pilecco   5kg');
    expect(consultaContagem()[1]).toEqual(['%arroz%', '%pilecco%', '%5kg%']);
    expect(consultaLista()[1]).toEqual(['%arroz%', '%pilecco%', '%5kg%', 5000]);
    expect(consultaLista()[0].sql.match(/LIKE \?/g)).toHaveLength(3);
  });

  it('escapa %, _ e a barra invertida dentro de cada palavra', async () => {
    mockBanco({ linhas: [] });

    await request(app).get(ITENS).query({ agrupador: 'grupo', busca: '10%_off c\\d' });

    expect(consultaContagem()[1]).toEqual(['%10\\%\\_off%', '%c\\\\d%']);
    expect(consultaLista()[1]).toEqual(['%10\\%\\_off%', '%c\\\\d%', 5000]);
    expect(consultaLista()[0].sql).not.toContain('10%');
  });

  it('mais de 6 palavras retorna 400 com mensagem clara, sem consultar o banco', async () => {
    const res = await request(app).get(ITENS).query({ agrupador: 'grupo', busca: 'a b c d e f g' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: expect.stringMatching(/6 palavras/) });
    expect(execute).not.toHaveBeenCalled();
  });

  it('busca com mais de 100 caracteres retorna 400 com mensagem clara, sem consultar o banco', async () => {
    const res = await request(app).get(ITENS).query({ agrupador: 'produto', busca: `arroz ${'x'.repeat(96)}` });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: expect.stringMatching(/100 caracteres/) });
    expect(execute).not.toHaveBeenCalled();
  });

  it('produto com busca de 1 caractere ou só espaços retorna 400', async () => {
    const umCaractere = await request(app).get(ITENS).query({ agrupador: 'produto', busca: ' a ' });
    const soEspacos = await request(app).get(ITENS).query({ agrupador: 'produto', busca: '     ' });

    expect(umCaractere.status).toBe(400);
    expect(umCaractere.body).toEqual({ erro: expect.stringMatching(/pelo menos 2 caracteres/) });
    expect(soEspacos.status).toBe(400);
    expect(soEspacos.body).toEqual({ erro: expect.stringMatching(/pelo menos 2 caracteres/) });
    expect(execute).not.toHaveBeenCalled();
  });

  it('dimensão sem produto com busca só de espaços é tratada como sem filtro', async () => {
    mockBanco({ linhas: [] });

    const res = await request(app).get(ITENS).query({ agrupador: 'familia', busca: ' \t  ' });

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('busca');
    expect(consultaLista()[0].sql).not.toMatch(/WHERE|LIKE/);
    expect(consultaContagem()[0].sql).not.toMatch(/WHERE|LIKE/);
  });

  it('com várias palavras os placeholders seguem a ordem: filtro fixo, um por palavra, LIMIT por último (cliente)', async () => {
    mockBanco({ linhas: [] });

    await request(app).get(ITENS).query({ agrupador: 'cliente', busca: 'maria silva', limite: '10' });

    const [{ sql: sqlLista }, paramsLista] = consultaLista();
    const [{ sql: sqlContagem }, paramsContagem] = consultaContagem();
    expect(sqlLista).toMatch(
      /WHERE clifor\.tipo = 1 AND clifor\.nome LIKE \? AND clifor\.nome LIKE \?\nORDER BY clifor\.nome, clifor\.cod\nLIMIT \?$/
    );
    expect(sqlContagem).toMatch(/WHERE clifor\.tipo = 1 AND clifor\.nome LIKE \? AND clifor\.nome LIKE \?$/);
    expect(paramsContagem).toEqual(['%maria%', '%silva%']);
    expect(paramsLista).toEqual(['%maria%', '%silva%', 10]);
  });

  it('sem busca a resposta não traz o campo busca e a consulta não tem WHERE (cadastros de departamento)', async () => {
    mockBanco({ linhas: [] });

    const res = await request(app).get(ITENS).query({ agrupador: 'marca', busca: '   ' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ agrupador: 'marca', limite: 5000, totalItens: 0, itens: [] });
    const [{ sql }, params] = consultaLista();
    expect(sql).not.toMatch(/WHERE/);
    expect(params).toEqual([5000]);
  });

  it('busca repetida (array) retorna 400', async () => {
    const res = await request(app).get(`${ITENS}?agrupador=grupo&busca=a&busca=b`);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: expect.any(String) });
    expect(execute).not.toHaveBeenCalled();
  });

  it('o limite tem padrão e máximo por dimensão: 5000 (departamentos/cliente) e 50/200 (produto)', async () => {
    mockBanco({ linhas: [] });

    const padraoGrupo = await request(app).get(ITENS).query({ agrupador: 'grupo' });
    const maximoCliente = await request(app).get(ITENS).query({ agrupador: 'cliente', limite: '5000' });
    const acimaCliente = await request(app).get(ITENS).query({ agrupador: 'cliente', limite: '5001' });
    const padraoProduto = await request(app).get(ITENS).query({ agrupador: 'produto', busca: 'ar' });
    const maximoProduto = await request(app).get(ITENS).query({ agrupador: 'produto', busca: 'ar', limite: '200' });
    const acimaProduto = await request(app).get(ITENS).query({ agrupador: 'produto', busca: 'ar', limite: '201' });
    const menorQueUm = await request(app).get(ITENS).query({ agrupador: 'grupo', limite: '0' });
    const naoInteiro = await request(app).get(ITENS).query({ agrupador: 'grupo', limite: '1.5' });

    expect(padraoGrupo.body.limite).toBe(5000);
    expect(maximoCliente.body.limite).toBe(5000);
    expect(acimaCliente.status).toBe(400);
    expect(padraoProduto.body.limite).toBe(50);
    expect(maximoProduto.body.limite).toBe(200);
    expect(acimaProduto.status).toBe(400);
    expect(menorQueUm.status).toBe(400);
    expect(naoInteiro.status).toBe(400);
    [acimaCliente, acimaProduto, menorQueUm, naoInteiro].forEach((res) => {
      expect(res.body).toEqual({ erro: expect.stringMatching(/Limite inválido/) });
    });
    // LIMIT parametrizado: o limite é o último parâmetro da consulta de lista
    const limites = execute.mock.calls
      .filter(([{ sql }]) => !/COUNT\(\*\)/.test(sql))
      .map(([{ sql }, params]) => [/LIMIT \?/.test(sql), params[params.length - 1]]);
    expect(limites).toEqual([
      [true, 5000],
      [true, 5000],
      [true, 50],
      [true, 200],
    ]);
  });

  it('totalItens é o total que casa antes do limite', async () => {
    mockBanco({ linhas: [{ id: 1, nome: 'A' }, { id: 2, nome: 'B' }], total: 137 });

    const res = await request(app).get(ITENS).query({ agrupador: 'setor', limite: '2' });

    expect(res.body.totalItens).toBe(137);
    expect(res.body.itens).toHaveLength(2);
    expect(res.body.limite).toBe(2);
  });

  it('cliente lê só clifor.cod e clifor.nome, apenas com tipo = 1', async () => {
    mockBanco({ linhas: [{ id: 7, nome: 'MARIA DA SILVA' }] });

    await request(app).get(ITENS).query({ agrupador: 'cliente', busca: 'mar' });

    [consultaLista(), consultaContagem()].forEach(([{ sql }]) => {
      expect(sql).toContain('clifor.tipo = 1');
      expect(sql).toContain('clifor.nome LIKE ?');
      const colunas = sql
        .match(/clifor\.\w+/g)
        .filter((coluna) => !['clifor.cod', 'clifor.nome', 'clifor.tipo'].includes(coluna));
      expect(colunas).toEqual([]);
    });
    expect(consultaLista()[0].sql).toMatch(/WHERE clifor\.tipo = 1 AND clifor\.nome LIKE \?/);
  });

  it('itens sem nome recebem "Sem nome" (ou "Sem descrição" em produto)', async () => {
    mockBanco({ linhas: [{ id: 1, nome: null }, { id: 2, nome: '   ' }] });

    const grupo = await request(app).get(ITENS).query({ agrupador: 'grupo' });
    const produto = await request(app).get(ITENS).query({ agrupador: 'produto', busca: 'ab' });

    expect(grupo.body.itens).toEqual([{ id: 1, nome: 'Sem nome' }, { id: 2, nome: 'Sem nome' }]);
    expect(produto.body.itens).toEqual([{ id: 1, nome: 'Sem descrição' }, { id: 2, nome: 'Sem descrição' }]);
  });

  it('erro do banco retorna 500 genérico, sem vazar SQL nem mensagem do MariaDB, e loga só o código', async () => {
    execute.mockRejectedValue(
      Object.assign(new Error("Table 'erp.clifor' doesn't exist"), {
        code: 'ER_NO_SUCH_TABLE',
        sqlMessage: 'segredo: tabela clifor',
        sql: 'SELECT clifor.cod FROM clifor',
      })
    );

    const res = await request(app).get(ITENS).query({ agrupador: 'cliente' });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ erro: 'Erro interno.' });
    expect(JSON.stringify(res.body)).not.toMatch(/SELECT|clifor|ER_NO_SUCH_TABLE|segredo/i);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0].join(' ')).toContain('ER_NO_SUCH_TABLE');
    expect(errorSpy.mock.calls[0].join(' ')).not.toMatch(/SELECT|segredo|doesn't exist/i);
  });
});

describe('curvaAbc.controller - erro inesperado (fora do service)', () => {
  let errorSpy;

  // Monta o router com o service substituído por um que rejeita com `erro` (erro que não é de validação
  // nem um erro interno já logado pelo service).
  function montarAppComServicoQueFalha(erro) {
    let appComFalha;
    jest.isolateModules(() => {
      jest.doMock('../../../src/modules/curvaAbc/curvaAbc.service', () => ({
        obterCurvaAbc: jest.fn().mockRejectedValue(erro),
        ErroInternoCurvaAbc: class ErroInternoCurvaAbc extends Error {},
      }));
      jest.doMock('../../../src/modules/curvaAbc/curvaAbcItens.service', () => ({
        obterItensDimensao: jest.fn().mockRejectedValue(erro),
      }));
      const router = require('../../../src/modules/curvaAbc/curvaAbc.routes');
      appComFalha = express();
      appComFalha.use('/api/curva-abc', router);
    });
    jest.dontMock('../../../src/modules/curvaAbc/curvaAbc.service');
    jest.dontMock('../../../src/modules/curvaAbc/curvaAbcItens.service');
    return appComFalha;
  }

  const erroInesperado = () =>
    Object.assign(new TypeError('Cannot read properties of undefined SELECT * FROM vendacupom segredo'), {
      code: 'ERR_INESPERADO',
    });

  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  function verificarLogSeguro(res) {
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ erro: 'Erro interno.' });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const registro = errorSpy.mock.calls[0].join(' ');
    expect(registro).toContain('TypeError');
    expect(registro).toContain('ERR_INESPERADO');
    expect(registro).not.toMatch(/SELECT|segredo|vendacupom|Cannot read/i);
  }

  it('GET /api/curva-abc: erro inesperado responde 500 genérico e loga só o nome e o código do erro', async () => {
    const appComFalha = montarAppComServicoQueFalha(erroInesperado());

    const res = await request(appComFalha).get(ROTA).query({ ...PERIODO, agrupador: 'grupo' });

    verificarLogSeguro(res);
  });

  it('GET /api/curva-abc/itens: erro inesperado responde 500 genérico e loga só o nome e o código do erro', async () => {
    const appComFalha = montarAppComServicoQueFalha(erroInesperado());

    const res = await request(appComFalha).get(`${ROTA}/itens`).query({ agrupador: 'grupo' });

    verificarLogSeguro(res);
  });
});
