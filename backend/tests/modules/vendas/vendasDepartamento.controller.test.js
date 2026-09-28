jest.mock('../../../src/db/connection', () => ({ getPool: jest.fn() }));

const express = require('express');
const request = require('supertest');
const { getPool } = require('../../../src/db/connection');
const { JOIN_VENDA_VALIDA, WHERE_VENDA_VALIDA } = require('../../../src/shared/vendaValida');
const { buildPeriodFilter, buildDepartmentFilter } = require('../../../src/shared/queryFilters');
const vendasDepartamentoRouter = require('../../../src/modules/vendas/vendasDepartamento.routes');

const ROTA = '/api/vendas/por-departamento';
const PERIODO = { inicio: '2026-09-01', fim: '2026-09-30' };

function montarApp() {
  const app = express();
  app.use('/api/vendas', vendasDepartamentoRouter);
  return app;
}

describe('GET /api/vendas/por-departamento', () => {
  let execute;
  let errorSpy;
  let app;

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

  it('com nivel=setor e id válido retorna vendas agregadas apenas dos produtos daquele setor', async () => {
    // 1ª consulta: top N produtos; 2ª: total do departamento inteiro (fora do top N)
    execute
      .mockResolvedValueOnce([
        [
          { id: 101, nome: 'COCA COLA 2L', faturamento: '750.5000', quantidade: 100 },
          { id: 102, nome: 'GUARANA 2L', faturamento: '249.5000', quantidade: 40.5 },
        ],
        [],
      ])
      .mockResolvedValueOnce([[{ total: '1000.0000' }], []]);

    const res = await request(app).get(ROTA).query({ ...PERIODO, nivel: 'setor', id: '5' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      nivel: 'setor',
      id: 5,
      itens: [
        { id: 101, nome: 'COCA COLA 2L', faturamento: 750.5, quantidade: 100, participacaoPercentual: 75.05 },
        { id: 102, nome: 'GUARANA 2L', faturamento: 249.5, quantidade: 40.5, participacaoPercentual: 24.95 },
      ],
      total: 1000,
    });

    expect(execute).toHaveBeenCalledTimes(2);
    const [{ sql }, params] = execute.mock.calls[0];
    const periodo = buildPeriodFilter(PERIODO.inicio, PERIODO.fim);
    const departamento = buildDepartmentFilter({ nivel: 'setor', id: '5' });
    // a consulta do total aplica exatamente os mesmos filtros (sem limite)
    const [{ sql: sqlTotal }, paramsTotal] = execute.mock.calls[1];
    expect(sqlTotal).toContain(JOIN_VENDA_VALIDA);
    expect(sqlTotal).toContain(WHERE_VENDA_VALIDA);
    expect(sqlTotal).toContain(periodo.clause);
    expect(sqlTotal).toContain(departamento.clause);
    expect(paramsTotal).toEqual([...periodo.params, ...departamento.params]);
    // regra de venda válida (fragmentos compartilhados) + período parametrizado
    expect(sql).toContain(JOIN_VENDA_VALIDA);
    expect(sql).toContain(WHERE_VENDA_VALIDA);
    expect(sql).toContain(periodo.clause);
    // filtro do setor vem de buildDepartmentFilter e o id é parâmetro `?`, nunca concatenado
    expect(departamento.clause).toBe('produto.setor = ?');
    expect(sql).toContain(departamento.clause);
    expect(sql).not.toMatch(/produto\.setor\s*=\s*5/);
    expect(params.slice(0, 2)).toEqual(periodo.params);
    expect(params.slice(2, 3)).toEqual(departamento.params);
    // valor por item (vendaitem.vtotal); vendacupom.valortotal nunca é somado por departamento
    expect(sql).toContain('vendaitem.vtotal');
    expect(sql).not.toMatch(/SUM\(\s*vendacupom\.valortotal/i);
  });

  it('com nivel inválido retorna 400 com mensagem de erro clara', async () => {
    const res = await request(app).get(ROTA).query({ ...PERIODO, nivel: 'loja', id: '5' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: expect.stringMatching(/grupo, setor ou familia/) });
    expect(execute).not.toHaveBeenCalled();
  });

  it('sem nivel retorna 400 { erro }', async () => {
    const res = await request(app).get(ROTA).query(PERIODO);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: expect.any(String) });
    expect(execute).not.toHaveBeenCalled();
  });

  it('sem id agrupa as vendas por departamento do nivel, com departamentos órfãos em "Sem departamento"', async () => {
    execute.mockResolvedValue([
      [
        { id: 3, nome: 'BEBIDAS', faturamento: '900.0000', quantidade: 120 },
        { id: null, nome: 'Sem departamento', faturamento: '100.0000', quantidade: 8 },
      ],
      [],
    ]);

    const res = await request(app).get(ROTA).query({ ...PERIODO, nivel: 'grupo' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      nivel: 'grupo',
      id: null,
      itens: [
        { id: 3, nome: 'BEBIDAS', faturamento: 900, quantidade: 120, participacaoPercentual: 90 },
        { id: null, nome: 'Sem departamento', faturamento: 100, quantidade: 8, participacaoPercentual: 10 },
      ],
      total: 1000,
    });

    // sem id o total é a soma das linhas: uma única consulta
    expect(execute).toHaveBeenCalledTimes(1);
    const [{ sql }, params] = execute.mock.calls[0];
    const periodo = buildPeriodFilter(PERIODO.inicio, PERIODO.fim);
    expect(sql).toContain(JOIN_VENDA_VALIDA);
    expect(sql).toContain(WHERE_VENDA_VALIDA);
    expect(sql).toContain(periodo.clause);
    expect(sql).toMatch(/LEFT JOIN grupo ON grupo\.idGrupo = produto\.grupo/);
    expect(sql).not.toContain('produto.grupo = ?');
    expect(params).toEqual(periodo.params);
  });

  it('sem vendas no período retorna itens vazios e total 0', async () => {
    execute.mockResolvedValue([[], []]);

    const res = await request(app).get(ROTA).query({ ...PERIODO, nivel: 'familia' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ nivel: 'familia', id: null, itens: [], total: 0 });
  });

  it('com id inválido retorna 400', async () => {
    const res = await request(app).get(ROTA).query({ ...PERIODO, nivel: 'setor', id: 'abc' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: expect.any(String) });
    expect(execute).not.toHaveBeenCalled();
  });

  it('com período ausente ou inválido retorna 400', async () => {
    const semPeriodo = await request(app).get(ROTA).query({ nivel: 'grupo' });
    const invalido = await request(app).get(ROTA).query({ inicio: '2026-13-01', fim: '2026-09-30', nivel: 'grupo' });

    expect(semPeriodo.status).toBe(400);
    expect(semPeriodo.body).toEqual({ erro: expect.any(String) });
    expect(invalido.status).toBe(400);
    expect(invalido.body).toEqual({ erro: expect.any(String) });
    expect(execute).not.toHaveBeenCalled();
  });

  it('aplica o limite (padrão 50) apenas no detalhamento por id e rejeita limite inválido', async () => {
    execute.mockResolvedValue([[], []]);

    await request(app).get(ROTA).query({ ...PERIODO, nivel: 'grupo', id: '2' });
    await request(app).get(ROTA).query({ ...PERIODO, nivel: 'grupo', id: '2', limite: '10' });
    const ruim = await request(app).get(ROTA).query({ ...PERIODO, nivel: 'grupo', id: '2', limite: '0' });

    // cada requisição por id faz 2 consultas (itens + total); o limite só vai na dos itens
    expect(execute.mock.calls[0][1].slice(-1)).toEqual([50]);
    expect(execute.mock.calls[2][1].slice(-1)).toEqual([10]);
    expect(ruim.status).toBe(400);
    expect(execute).toHaveBeenCalledTimes(4);
  });

  it('erro do banco retorna 500 genérico sem vazar detalhes internos', async () => {
    execute.mockRejectedValue(
      Object.assign(new Error('Table erp.vendaitem missing'), { code: 'ER_NO_SUCH_TABLE' })
    );

    const res = await request(app).get(ROTA).query({ ...PERIODO, nivel: 'grupo' });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ erro: 'Erro interno.' });
    expect(JSON.stringify(res.body)).not.toMatch(/vendaitem|ER_NO_SUCH_TABLE/);
  });
});
