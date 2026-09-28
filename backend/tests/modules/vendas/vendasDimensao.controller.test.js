jest.mock('../../../src/db/connection', () => ({ getPool: jest.fn() }));

const express = require('express');
const request = require('supertest');
const { getPool } = require('../../../src/db/connection');
const { JOIN_VENDA_VALIDA, WHERE_VENDA_VALIDA } = require('../../../src/shared/vendaValida');
const vendasDimensaoRouter = require('../../../src/modules/vendas/vendasDimensao.routes');

const PERIODO = { inicio: '2026-09-01', fim: '2026-09-07' };
const PARAMS_PERIODO = ['2026-09-01 00:00:00', '2026-09-08 00:00:00'];

// Mini-app: o orquestrador é quem monta o router em /api/vendas (e aplica autenticação).
function montarApp() {
  const app = express();
  app.use('/api/vendas', vendasDimensaoRouter);
  return app;
}

function arredondar(valor) {
  return Math.round(valor * 100) / 100;
}

describe('vendasDimensao — /api/vendas/por-hora, /por-dia-semana, /por-forma-pagamento', () => {
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

  it('GET /por-hora retorna 24 buckets (0-23h) com a soma das vendas válidas do período, zerando horas sem venda', async () => {
    // O banco devolve só as horas com venda; decimal do mysql2 chega como string.
    execute.mockResolvedValue([
      [
        { horaDia: 8, faturamento: '1500.5000', quantidadeCupons: 12 },
        { horaDia: 9, faturamento: '820.1250', quantidadeCupons: 7 },
        { horaDia: 23, faturamento: '10.0000', quantidadeCupons: 1 },
      ],
      [],
    ]);

    const res = await request(app).get('/api/vendas/por-hora').query(PERIODO);

    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['porHora']);
    expect(res.body.porHora).toHaveLength(24);
    expect(res.body.porHora.map((b) => b.hora)).toEqual(Array.from({ length: 24 }, (_, i) => i));
    expect(res.body.porHora[8]).toEqual({ hora: 8, faturamento: 1500.5, quantidadeCupons: 12 });
    expect(res.body.porHora[9]).toEqual({ hora: 9, faturamento: 820.13, quantidadeCupons: 7 });
    expect(res.body.porHora[23]).toEqual({ hora: 23, faturamento: 10, quantidadeCupons: 1 });
    expect(res.body.porHora[0]).toEqual({ hora: 0, faturamento: 0, quantidadeCupons: 0 });
    expect(res.body.porHora[15]).toEqual({ hora: 15, faturamento: 0, quantidadeCupons: 0 });
    const soma = arredondar(res.body.porHora.reduce((acc, b) => acc + b.faturamento, 0));
    expect(soma).toBe(2330.63);

    // Regra de venda válida + período parametrizado (nunca concatenado no SQL).
    expect(execute).toHaveBeenCalledTimes(1);
    const [{ sql }, params] = execute.mock.calls[0];
    expect(sql).toContain(JOIN_VENDA_VALIDA);
    expect(sql).toContain(WHERE_VENDA_VALIDA);
    expect(sql).toContain('vendacupom.data >= ? AND vendacupom.data < ?');
    expect(params).toEqual(PARAMS_PERIODO);
    expect(sql).not.toContain('2026-09');
  });

  it('GET /por-forma-pagamento agrupa pelo join vendacupom.formapag = formapag.idFormaPag e ordena por faturamento desc', async () => {
    execute.mockResolvedValue([
      [
        { formaPagamentoId: 1, nome: 'Dinheiro', faturamento: '300.0000', quantidadeCupons: 10 },
        { formaPagamentoId: 14, nome: 'Cartao Debito', faturamento: '900.7500', quantidadeCupons: 20 },
        { formaPagamentoId: null, nome: 'Não informada', faturamento: '50.0000', quantidadeCupons: 2 },
      ],
      [],
    ]);

    const res = await request(app).get('/api/vendas/por-forma-pagamento').query(PERIODO);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      porFormaPagamento: [
        { formaPagamentoId: 14, nome: 'Cartao Debito', faturamento: 900.75, quantidadeCupons: 20 },
        { formaPagamentoId: 1, nome: 'Dinheiro', faturamento: 300, quantidadeCupons: 10 },
        { formaPagamentoId: null, nome: 'Não informada', faturamento: 50, quantidadeCupons: 2 },
      ],
    });

    const [{ sql }, params] = execute.mock.calls[0];
    expect(sql).toMatch(/JOIN formapag ON formapag\.idFormaPag\s*=\s*vendacupom\.formapag/);
    // LEFT JOIN: vendas cuja forma não existe em formapag não perdem faturamento.
    expect(sql).toContain('LEFT JOIN formapag');
    expect(sql).toMatch(/GROUP BY formapag\.idFormaPag/);
    expect(sql).toContain(JOIN_VENDA_VALIDA);
    expect(sql).toContain(WHERE_VENDA_VALIDA);
    expect(sql).toContain('vendacupom.data >= ? AND vendacupom.data < ?');
    expect(params).toEqual(PARAMS_PERIODO);
  });

  it('GET /por-dia-semana retorna 7 buckets (0=domingo..6=sábado) sem depender de lc_time_names e zerando dias sem venda', async () => {
    execute.mockResolvedValue([
      [
        { diaSemana: 0, faturamento: '100.0000', quantidadeCupons: 4 },
        { diaSemana: 6, faturamento: '250.5000', quantidadeCupons: 9 },
      ],
      [],
    ]);

    const res = await request(app).get('/api/vendas/por-dia-semana').query(PERIODO);

    expect(res.status).toBe(200);
    expect(res.body.porDiaSemana).toHaveLength(7);
    expect(res.body.porDiaSemana.map((b) => b.nome)).toEqual([
      'Domingo',
      'Segunda-feira',
      'Terça-feira',
      'Quarta-feira',
      'Quinta-feira',
      'Sexta-feira',
      'Sábado',
    ]);
    expect(res.body.porDiaSemana.map((b) => b.diaSemana)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(res.body.porDiaSemana[0]).toEqual({ diaSemana: 0, nome: 'Domingo', faturamento: 100, quantidadeCupons: 4 });
    expect(res.body.porDiaSemana[3]).toEqual({ diaSemana: 3, nome: 'Quarta-feira', faturamento: 0, quantidadeCupons: 0 });
    expect(res.body.porDiaSemana[6].faturamento).toBe(250.5);

    const [{ sql }, params] = execute.mock.calls[0];
    expect(sql).toContain('DAYOFWEEK(vendacupom.data)');
    expect(sql).not.toMatch(/DAYNAME|lc_time_names/i);
    expect(sql).toContain(JOIN_VENDA_VALIDA);
    expect(sql).toContain(WHERE_VENDA_VALIDA);
    expect(params).toEqual(PARAMS_PERIODO);
  });

  it('retorna 400 { erro } e não consulta o banco quando inicio/fim estão ausentes, malformados ou invertidos', async () => {
    const rotas = ['/api/vendas/por-hora', '/api/vendas/por-dia-semana', '/api/vendas/por-forma-pagamento'];
    const consultasInvalidas = [
      {},
      { inicio: '2026-09-01' },
      { inicio: '01/09/2026', fim: '2026-09-07' },
      { inicio: '2026-02-30', fim: '2026-03-01' },
      { inicio: '2026-09-07', fim: '2026-09-01' },
    ];

    for (const rota of rotas) {
      for (const consulta of consultasInvalidas) {
        const res = await request(app).get(rota).query(consulta);
        expect(res.status).toBe(400);
        expect(Object.keys(res.body)).toEqual(['erro']);
        expect(typeof res.body.erro).toBe('string');
      }
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it('retorna 500 genérico, sem vazar o erro do banco, quando a consulta falha', async () => {
    const erroBruto = new Error('Tabela erp.vendacupom segredo-do-banco');
    erroBruto.code = 'ER_NO_SUCH_TABLE';
    execute.mockRejectedValue(erroBruto);

    for (const rota of ['/por-hora', '/por-dia-semana', '/por-forma-pagamento']) {
      const res = await request(app).get(`/api/vendas${rota}`).query(PERIODO);
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ erro: 'Erro interno.' });
    }
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('segredo-do-banco');
  });
});
