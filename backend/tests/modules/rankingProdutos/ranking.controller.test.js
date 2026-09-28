jest.mock('../../../src/db/connection', () => ({ getPool: jest.fn() }));

const express = require('express');
const request = require('supertest');
const { getPool } = require('../../../src/db/connection');
const { JOIN_VENDA_VALIDA, WHERE_VENDA_VALIDA } = require('../../../src/shared/vendaValida');
const { buildPeriodFilter, buildDepartmentFilter } = require('../../../src/shared/queryFilters');
const rankingRouter = require('../../../src/modules/rankingProdutos/ranking.routes');

const ROTA = '/api/ranking-produtos';
const PERIODO = { inicio: '2026-09-01', fim: '2026-09-30' };

function montarApp() {
  const app = express();
  app.use('/api/ranking-produtos', rankingRouter);
  return app;
}

describe('GET /api/ranking-produtos', () => {
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

  // Teste crítico 1 (PLAN.md, Task 7.1)
  it('para criterio=vendas retorna os produtos ordenados por quantidade vendida decrescente, respeitando o limite', async () => {
    execute.mockResolvedValue([
      [
        { id: 101, nome: 'COCA COLA 2L', quantidade: 300, faturamento: '1500.0000' },
        { id: 102, nome: 'ARROZ 5KG', quantidade: 120.5, faturamento: '3010.2500' },
        { id: 103, nome: 'FEIJAO 1KG', quantidade: 80, faturamento: '640.0000' },
      ],
      [],
    ]);

    const res = await request(app).get(ROTA).query({ ...PERIODO, criterio: 'vendas', limite: '3' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      criterio: 'vendas',
      limite: 3,
      itens: [
        { posicao: 1, id: 101, nome: 'COCA COLA 2L', quantidade: 300, faturamento: 1500 },
        { posicao: 2, id: 102, nome: 'ARROZ 5KG', quantidade: 120.5, faturamento: 3010.25 },
        { posicao: 3, id: 103, nome: 'FEIJAO 1KG', quantidade: 80, faturamento: 640 },
      ],
    });
    // a ordem devolvida é decrescente em quantidade
    const quantidades = res.body.itens.map((item) => item.quantidade);
    expect(quantidades).toEqual([...quantidades].sort((a, b) => b - a));

    expect(execute).toHaveBeenCalledTimes(1);
    const [{ sql }, params] = execute.mock.calls[0];
    const periodo = buildPeriodFilter(PERIODO.inicio, PERIODO.fim);
    // ordenação por quantidade decrescente feita no banco, com o limite como parâmetro `?`
    expect(sql).toMatch(/ORDER BY quantidade DESC/);
    expect(sql).toMatch(/LIMIT \?\s*$/);
    expect(params).toEqual([...periodo.params, 3]);
    // regra de venda válida + período parametrizado; valor por item (vtotal)
    expect(sql).toContain(JOIN_VENDA_VALIDA);
    expect(sql).toContain(WHERE_VENDA_VALIDA);
    expect(sql).toContain(periodo.clause);
    expect(sql).toContain('vendaitem.vtotal');
    expect(sql).not.toMatch(/SUM\(\s*vendacupom\.valortotal/i);
  });

  // Teste crítico 2 (PLAN.md, Task 7.1)
  it('para criterio fora da lista permitida retorna status 400', async () => {
    const res = await request(app)
      .get(ROTA)
      .query({ ...PERIODO, criterio: 'preco; DROP TABLE produto' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: expect.stringMatching(/vendas, faturamento, margem, crescimento ou queda/) });
    expect(execute).not.toHaveBeenCalled();
  });

  it('sem criterio retorna 400 { erro }', async () => {
    const res = await request(app).get(ROTA).query(PERIODO);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: expect.any(String) });
    expect(execute).not.toHaveBeenCalled();
  });

  it('criterio=faturamento ordena por faturamento decrescente e usa limite padrão 10', async () => {
    execute.mockResolvedValue([[], []]);

    const res = await request(app).get(ROTA).query({ ...PERIODO, criterio: 'faturamento' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ criterio: 'faturamento', limite: 10, itens: [] });
    const [{ sql }, params] = execute.mock.calls[0];
    expect(sql).toMatch(/ORDER BY faturamento DESC/);
    expect(params.slice(-1)).toEqual([10]);
  });

  it('limite inválido (zero, negativo, texto, acima do teto) retorna 400', async () => {
    const respostas = await Promise.all(
      ['0', '-5', 'abc', '1.5', '101'].map((limite) =>
        request(app).get(ROTA).query({ ...PERIODO, criterio: 'vendas', limite })
      )
    );

    respostas.forEach((res) => {
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ erro: expect.any(String) });
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('com período ausente ou inválido retorna 400', async () => {
    const semPeriodo = await request(app).get(ROTA).query({ criterio: 'vendas' });
    const invalido = await request(app).get(ROTA).query({ inicio: '2026-13-01', fim: '2026-09-30', criterio: 'vendas' });

    expect(semPeriodo.status).toBe(400);
    expect(invalido.status).toBe(400);
    expect(invalido.body).toEqual({ erro: expect.any(String) });
    expect(execute).not.toHaveBeenCalled();
  });

  it('com nivel e id aplica o filtro de departamento parametrizado; nivel inválido retorna 400', async () => {
    execute.mockResolvedValue([[], []]);

    const ok = await request(app).get(ROTA).query({ ...PERIODO, criterio: 'vendas', nivel: 'setor', id: '5' });
    const ruim = await request(app).get(ROTA).query({ ...PERIODO, criterio: 'vendas', nivel: 'loja', id: '5' });

    const periodo = buildPeriodFilter(PERIODO.inicio, PERIODO.fim);
    const departamento = buildDepartmentFilter({ nivel: 'setor', id: '5' });
    expect(ok.status).toBe(200);
    const [{ sql }, params] = execute.mock.calls[0];
    expect(sql).toContain(departamento.clause);
    expect(sql).not.toMatch(/produto\.setor\s*=\s*5/);
    expect(params).toEqual([...periodo.params, ...departamento.params, 10]);
    expect(ruim.status).toBe(400);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  // criterio=crescimento|queda (Task 7.4): compara o período com o anterior lendo SÓ o cache
  // (vendas_produto_dia_cache; "dia coberto" = linha sentinela (dia, produto 0) gravada após o fim do dia).
  // Período do teste: 2026-09-01..2026-09-30 (30 dias); anterior de mesma duração: 2026-08-02..2026-08-31.
  // O relógio é fixado em 2026-10-15 (setembro já está inteiro fechado); os testes de "dia fechado"
  // reposicionam o relógio com fixarHoje.
  describe('criterio=crescimento|queda (lê o cache por produto)', () => {
    const ANTERIOR = { inicio: '2026-08-02', fim: '2026-08-31' };

    // Só o Date é falso: supertest/http precisam dos timers reais.
    const NAO_FALSIFICAR = [
      'hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
      'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval',
      'setTimeout', 'clearTimeout',
    ];
    function fixarHoje(ano, mes, dia) {
      jest.useFakeTimers({ now: new Date(ano, mes - 1, dia, 12, 0, 0), doNotFake: NAO_FALSIFICAR });
    }
    beforeEach(() => fixarHoje(2026, 10, 15));
    afterEach(() => jest.useRealTimers());

    function listarDias(inicio, fim) {
      const dias = [];
      for (let ms = Date.parse(inicio); ms <= Date.parse(fim); ms += 86400000) {
        dias.push(new Date(ms).toISOString().slice(0, 10));
      }
      return dias;
    }
    const TODOS_OS_DIAS = [...listarDias(ANTERIOR.inicio, ANTERIOR.fim), ...listarDias(PERIODO.inicio, PERIODO.fim)];

    // Consulta de cobertura = a que lê as sentinelas (`atualizado_em >=`); a outra é o ranking.
    const ehCobertura = (sql) => sql.includes('atualizado_em >=');
    function mockarCache({ dias = TODOS_OS_DIAS, linhas = [] } = {}) {
      execute.mockImplementation(async ({ sql }) => {
        if (ehCobertura(sql)) return [dias.map((dia) => ({ dia })), []];
        return [linhas, []];
      });
    }
    const consultaCobertura = () => execute.mock.calls.find(([{ sql }]) => ehCobertura(sql));
    const consultaRanking = () => execute.mock.calls.find(([{ sql }]) => !ehCobertura(sql));

    // Teste crítico 3 (PLAN.md, Task 7.4)
    it('crescimento ordena por variação positiva e queda por variação negativa, comparando com o período anterior a partir do cache', async () => {
      // o banco já entrega ordenado (ORDER BY variacao DESC / ASC) e filtrado (> 0 / < 0)
      mockarCache({
        linhas: [
          { id: 11, nome: 'ARROZ 5KG', faturamentoAtual: '1500.0000', faturamentoAnterior: '1000.0000', variacao: '500.0000' },
          { id: 12, nome: 'FEIJAO 1KG', faturamentoAtual: '300.0000', faturamentoAnterior: '200.0000', variacao: '100.0000' },
          { id: 13, nome: 'PRODUTO NOVO', faturamentoAtual: '80.0000', faturamentoAnterior: '0.0000', variacao: '80.0000' },
        ],
      });

      const crescimento = await request(app).get(ROTA).query({ ...PERIODO, criterio: 'crescimento', limite: '3' });

      expect(crescimento.status).toBe(200);
      expect(crescimento.body).toEqual({
        criterio: 'crescimento',
        limite: 3,
        inicio: PERIODO.inicio,
        fim: PERIODO.fim,
        fimSolicitado: PERIODO.fim,
        periodoAnterior: ANTERIOR,
        itens: [
          { posicao: 1, id: 11, nome: 'ARROZ 5KG', faturamentoAtual: 1500, faturamentoAnterior: 1000, variacao: 500, variacaoPercentual: 50 },
          { posicao: 2, id: 12, nome: 'FEIJAO 1KG', faturamentoAtual: 300, faturamentoAnterior: 200, variacao: 100, variacaoPercentual: 50 },
          // período anterior sem venda: variação em R$ existe, percentual não
          { posicao: 3, id: 13, nome: 'PRODUTO NOVO', faturamentoAtual: 80, faturamentoAnterior: 0, variacao: 80, variacaoPercentual: null },
        ],
      });
      const variacoes = crescimento.body.itens.map((item) => item.variacao);
      expect(variacoes.every((v) => v > 0)).toBe(true);
      expect(variacoes).toEqual([...variacoes].sort((a, b) => b - a));

      const periodoAtual = buildPeriodFilter(PERIODO.inicio, PERIODO.fim);
      const periodoAnterior = buildPeriodFilter(ANTERIOR.inicio, ANTERIOR.fim);
      const [{ sql: sqlCrescimento }, paramsCrescimento] = consultaRanking();
      // só o cache: nunca as tabelas transacionais
      expect(sqlCrescimento).toContain('FROM vendas_produto_dia_cache');
      expect(sqlCrescimento).not.toMatch(/vendaitem|vendacupom|flagvc/i);
      // a sentinela (produto 0) nunca entra no ranking
      expect(sqlCrescimento).toMatch(/vendas_produto_dia_cache\.produto > 0/);
      // período e período anterior parametrizados (nunca concatenados), variação > 0 ordenada DESC, LIMIT ?
      expect(sqlCrescimento).not.toContain(PERIODO.inicio);
      expect(sqlCrescimento).not.toContain(ANTERIOR.inicio);
      expect(sqlCrescimento).toMatch(/\) > 0\s+ORDER BY variacao DESC, agregados\.id\s+LIMIT \?\s*$/);
      expect(paramsCrescimento).toEqual([
        ...periodoAtual.params,
        ...periodoAnterior.params,
        ...periodoAtual.params,
        ...periodoAnterior.params,
        3,
      ]);

      execute.mockClear();
      mockarCache({
        linhas: [
          { id: 21, nome: 'REFRIGERANTE', faturamentoAtual: '100.0000', faturamentoAnterior: '400.0000', variacao: '-300.0000' },
          { id: 22, nome: 'SUCO', faturamentoAtual: '0.0000', faturamentoAnterior: '50.0000', variacao: '-50.0000' },
        ],
      });

      const queda = await request(app).get(ROTA).query({ ...PERIODO, criterio: 'queda', limite: '2' });

      expect(queda.status).toBe(200);
      expect(queda.body.itens).toEqual([
        { posicao: 1, id: 21, nome: 'REFRIGERANTE', faturamentoAtual: 100, faturamentoAnterior: 400, variacao: -300, variacaoPercentual: -75 },
        { posicao: 2, id: 22, nome: 'SUCO', faturamentoAtual: 0, faturamentoAnterior: 50, variacao: -50, variacaoPercentual: -100 },
      ]);
      const variacoesQueda = queda.body.itens.map((item) => item.variacao);
      expect(variacoesQueda.every((v) => v < 0)).toBe(true);
      expect(variacoesQueda).toEqual([...variacoesQueda].sort((a, b) => a - b));
      const [{ sql: sqlQueda }] = consultaRanking();
      expect(sqlQueda).toContain('FROM vendas_produto_dia_cache');
      expect(sqlQueda).not.toMatch(/vendaitem|vendacupom|flagvc/i);
      expect(sqlQueda).toMatch(/\) < 0\s+ORDER BY variacao ASC, agregados\.id\s+LIMIT \?\s*$/);
    });

    it('sem limite usa o padrão 10; limite inválido e período inválido (ordem ou mais de 366 dias) retornam 400 sem consultar o banco', async () => {
      mockarCache();

      const padrao = await request(app).get(ROTA).query({ ...PERIODO, criterio: 'crescimento' });
      expect(padrao.status).toBe(200);
      expect(padrao.body).toMatchObject({ limite: 10, itens: [] });
      expect(consultaRanking()[1].slice(-1)).toEqual([10]);

      execute.mockClear();
      const limiteRuim = await request(app).get(ROTA).query({ ...PERIODO, criterio: 'queda', limite: '101' });
      const periodoRuim = await request(app).get(ROTA).query({ inicio: '2026-09-30', fim: '2026-09-01', criterio: 'queda' });
      const periodoLongo = await request(app).get(ROTA).query({ inicio: '2025-01-01', fim: '2026-09-01', criterio: 'crescimento' });
      for (const res of [limiteRuim, periodoRuim, periodoLongo]) {
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ erro: expect.any(String) });
      }
      expect(execute).not.toHaveBeenCalled();
    });

    it('com nivel e id aplica o filtro de departamento parametrizado (buildDepartmentFilter) na consulta do ranking', async () => {
      mockarCache();

      const res = await request(app).get(ROTA).query({ ...PERIODO, criterio: 'queda', nivel: 'grupo', id: '7' });

      expect(res.status).toBe(200);
      const periodoAtual = buildPeriodFilter(PERIODO.inicio, PERIODO.fim);
      const periodoAnterior = buildPeriodFilter(ANTERIOR.inicio, ANTERIOR.fim);
      const departamento = buildDepartmentFilter({ nivel: 'grupo', id: '7' });
      const [{ sql }, params] = consultaRanking();
      expect(sql).toContain(departamento.clause);
      expect(params).toEqual([
        ...periodoAtual.params,
        ...periodoAnterior.params,
        ...periodoAtual.params,
        ...periodoAnterior.params,
        ...departamento.params,
        10,
      ]);

      const ruim = await request(app).get(ROTA).query({ ...PERIODO, criterio: 'queda', nivel: 'loja', id: '7' });
      expect(ruim.status).toBe(400);
    });

    it('cache que não cobre todos os dias do período anterior retorna 503 { erro } claro, sem resultado parcial e sem consultar o ranking', async () => {
      // falta o dia 2026-08-15 (período anterior)
      mockarCache({ dias: TODOS_OS_DIAS.filter((dia) => dia !== '2026-08-15') });

      const res = await request(app).get(ROTA).query({ ...PERIODO, criterio: 'crescimento' });

      expect(res.status).toBe(503);
      expect(res.body).toEqual({ erro: expect.stringMatching(/cache/i) });
      expect(res.body).not.toHaveProperty('itens');
      expect(consultaRanking()).toBeUndefined();
    });

    it('cache que não cobre todos os dias do período atual também retorna 503 { erro }', async () => {
      mockarCache({ dias: TODOS_OS_DIAS.filter((dia) => dia !== '2026-09-30') });

      const res = await request(app).get(ROTA).query({ ...PERIODO, criterio: 'queda' });

      expect(res.status).toBe(503);
      expect(res.body).toEqual({ erro: expect.stringMatching(/cache/i) });
      expect(consultaRanking()).toBeUndefined();
    });

    it('a mensagem do 503 traz o comando exato a rodar (com --desde = primeiro dia faltante) e quantos dias faltam', async () => {
      // faltam 3 dias: 2026-08-15 (anterior) e 2026-09-10, 2026-09-11 (atual); o primeiro faltante é 2026-08-15
      mockarCache({ dias: TODOS_OS_DIAS.filter((dia) => !['2026-08-15', '2026-09-10', '2026-09-11'].includes(dia)) });

      const res = await request(app).get(ROTA).query({ ...PERIODO, criterio: 'crescimento' });

      expect(res.status).toBe(503);
      expect(res.body.erro).toContain('npm run job:cache-produtos -- --desde 2026-08-15');
      expect(res.body.erro).toMatch(/faltam 3 dia\(s\)/);
      expect(res.body.erro).toContain('2026-08-15');
      // sem vazar detalhes de banco
      expect(res.body.erro).not.toMatch(/SELECT|vendas_produto_dia_cache|vendas_periodo_cache/);
    });

    it('a cobertura só considera dia coberto a sentinela (produto 0) gravada após o fim do dia, sobre os dois períodos, sem UNION nem vendas_periodo_cache', async () => {
      mockarCache();

      await request(app).get(ROTA).query({ ...PERIODO, criterio: 'crescimento' });

      const periodoAtual = buildPeriodFilter(PERIODO.inicio, PERIODO.fim);
      const periodoAnterior = buildPeriodFilter(ANTERIOR.inicio, ANTERIOR.fim);
      const [{ sql }, params] = consultaCobertura();
      expect(sql).toContain('FROM vendas_produto_dia_cache');
      expect(sql).toMatch(/vendas_produto_dia_cache\.produto = 0/);
      expect(sql).toMatch(/vendas_produto_dia_cache\.atualizado_em >= DATE_ADD\(vendas_produto_dia_cache\.dia, INTERVAL 1 DAY\)/);
      expect(sql).not.toMatch(/UNION|vendas_periodo_cache|quantidade_cupons/);
      expect(sql).not.toMatch(/vendaitem|vendacupom|flagvc/i);
      expect(sql).toContain(buildPeriodFilter(PERIODO.inicio, PERIODO.fim, 'vendas_produto_dia_cache.dia').clause);
      // datas sempre parametrizadas
      expect(sql).not.toContain(PERIODO.inicio);
      expect(params).toEqual([...periodoAtual.params, ...periodoAnterior.params]);
    });

    // Dias futuros / hoje (revisão da Fase 7): hoje nunca é "dia fechado"; o fim efetivo é ONTEM.
    describe('fim efetivo limitado a ontem (último dia fechado)', () => {
      const HOJE = { ano: 2026, mes: 9, dia: 25 }; // ontem = 2026-09-24

      it('mês corrente: fim no futuro vira ontem, a resposta devolve inicio/fim efetivos e fimSolicitado, e o anterior usa a duração efetiva', async () => {
        fixarHoje(HOJE.ano, HOJE.mes, HOJE.dia);
        // efetivo: 2026-09-01..2026-09-24 (24 dias) -> anterior: 2026-08-08..2026-08-31
        const anterior = { inicio: '2026-08-08', fim: '2026-08-31' };
        mockarCache({ dias: [...listarDias(anterior.inicio, anterior.fim), ...listarDias('2026-09-01', '2026-09-24')] });

        const res = await request(app).get(ROTA).query({ ...PERIODO, criterio: 'crescimento' });

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
          inicio: '2026-09-01',
          fim: '2026-09-24',
          fimSolicitado: '2026-09-30',
          periodoAnterior: anterior,
        });
        const atual = buildPeriodFilter('2026-09-01', '2026-09-24');
        const filtroAnterior = buildPeriodFilter(anterior.inicio, anterior.fim);
        expect(consultaCobertura()[1]).toEqual([...atual.params, ...filtroAnterior.params]);
        expect(consultaRanking()[1]).toEqual([
          ...atual.params,
          ...filtroAnterior.params,
          ...atual.params,
          ...filtroAnterior.params,
          10,
        ]);
      });

      it('fim igual a hoje também é limitado a ontem (hoje nunca é dia fechado)', async () => {
        fixarHoje(HOJE.ano, HOJE.mes, HOJE.dia);
        mockarCache({ dias: listarDias('2026-08-01', '2026-09-24') });

        const res = await request(app).get(ROTA).query({ inicio: '2026-09-10', fim: '2026-09-25', criterio: 'queda' });

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ inicio: '2026-09-10', fim: '2026-09-24', fimSolicitado: '2026-09-25' });
        // 15 dias efetivos -> anterior 2026-08-26..2026-09-09
        expect(res.body.periodoAnterior).toEqual({ inicio: '2026-08-26', fim: '2026-09-09' });
      });

      it('período totalmente fechado não é alterado (fim efetivo = fim solicitado)', async () => {
        fixarHoje(HOJE.ano, HOJE.mes, HOJE.dia);
        mockarCache({ dias: listarDias('2026-08-01', '2026-09-24') });

        const res = await request(app).get(ROTA).query({ inicio: '2026-09-01', fim: '2026-09-24', criterio: 'crescimento' });

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ fim: '2026-09-24', fimSolicitado: '2026-09-24' });
      });

      it('inicio a partir de hoje (nenhum dia fechado no intervalo) retorna 400 { erro } claro, sem consultar o banco', async () => {
        fixarHoje(HOJE.ano, HOJE.mes, HOJE.dia);
        mockarCache();

        const emHoje = await request(app).get(ROTA).query({ inicio: '2026-09-25', fim: '2026-09-25', criterio: 'crescimento' });
        const futuro = await request(app).get(ROTA).query({ inicio: '2026-10-01', fim: '2026-10-31', criterio: 'queda' });

        for (const res of [emHoje, futuro]) {
          expect(res.status).toBe(400);
          expect(res.body).toEqual({ erro: expect.stringMatching(/fechado/i) });
          expect(res.body.erro).toContain('2026-09-24');
        }
        expect(execute).not.toHaveBeenCalled();
      });

      it('inicio = ontem com fim no futuro resulta em período de 1 dia (ontem), sem erro', async () => {
        fixarHoje(HOJE.ano, HOJE.mes, HOJE.dia);
        mockarCache({ dias: ['2026-09-23', '2026-09-24'] });

        const res = await request(app).get(ROTA).query({ inicio: '2026-09-24', fim: '2026-09-30', criterio: 'crescimento' });

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
          inicio: '2026-09-24',
          fim: '2026-09-24',
          fimSolicitado: '2026-09-30',
          periodoAnterior: { inicio: '2026-09-23', fim: '2026-09-23' },
        });
      });

      it('com o mês corrente coberto até ontem não há 503 permanente (o dia de hoje não é exigido do cache)', async () => {
        fixarHoje(HOJE.ano, HOJE.mes, HOJE.dia);
        // cache tem tudo até ontem; hoje (2026-09-25) e o resto do mês não têm sentinela
        mockarCache({ dias: listarDias('2026-07-01', '2026-09-24') });

        const res = await request(app).get(ROTA).query({ ...PERIODO, criterio: 'crescimento' });

        expect(res.status).toBe(200);
      });

      it('"hoje" segue o calendário do servidor (dia de negócio), virando o dia à meia-noite', async () => {
        jest.useFakeTimers({ now: new Date(2026, 8, 25, 23, 59, 0), doNotFake: NAO_FALSIFICAR });
        mockarCache({ dias: listarDias('2026-08-01', '2026-09-24') });
        const antes = await request(app).get(ROTA).query({ ...PERIODO, criterio: 'crescimento' });

        jest.setSystemTime(new Date(2026, 8, 26, 0, 1, 0));
        mockarCache({ dias: listarDias('2026-08-01', '2026-09-25') });
        const depois = await request(app).get(ROTA).query({ ...PERIODO, criterio: 'crescimento' });

        expect(antes.body.fim).toBe('2026-09-24');
        expect(depois.body.fim).toBe('2026-09-25');
      });
    });

    it.each(['crescimento', 'queda'])('erro do banco em criterio=%s retorna 500 genérico sem vazar detalhes', async (criterio) => {
      execute.mockRejectedValue(
        Object.assign(new Error("Table 'erp.vendas_produto_dia_cache' doesn't exist"), { code: 'ER_NO_SUCH_TABLE' })
      );

      const res = await request(app).get(ROTA).query({ ...PERIODO, criterio });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ erro: 'Erro interno.' });
      expect(JSON.stringify(res.body)).not.toMatch(/vendas_produto_dia_cache|ER_NO_SUCH_TABLE/);
      expect(errorSpy).toHaveBeenCalled();
    });

    it('erro do banco na consulta do ranking (cobertura ok) também retorna 500 genérico', async () => {
      execute.mockImplementation(async ({ sql }) => {
        if (ehCobertura(sql)) return [TODOS_OS_DIAS.map((dia) => ({ dia })), []];
        throw Object.assign(new Error('Lock wait timeout SELECT ...'), { code: 'ER_LOCK_WAIT_TIMEOUT' });
      });

      const res = await request(app).get(ROTA).query({ ...PERIODO, criterio: 'crescimento' });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ erro: 'Erro interno.' });
    });
  });

  describe('criterio=margem (CMV = vendaitem.pcusto)', () => {
    it('ordena por lucro (R$) decrescente e devolve custoTotal, lucro, margemPercentual e semCusto por item', async () => {
      execute.mockResolvedValue([
        [
          { id: 101, nome: 'COCA COLA 2L', quantidade: 300, faturamento: '1500.0000', custoTotal: '1000.0000', lucro: '500.0000', margemPercentual: '33.333333', semCusto: 0 },
          { id: 102, nome: 'ARROZ 5KG', quantidade: 120.5, faturamento: '3010.2500', custoTotal: '2710.2500', lucro: '300.0000', margemPercentual: '9.966', semCusto: 0 },
        ],
        [],
      ]);

      const res = await request(app).get(ROTA).query({ ...PERIODO, criterio: 'margem', limite: '2' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        criterio: 'margem',
        limite: 2,
        itens: [
          { posicao: 1, id: 101, nome: 'COCA COLA 2L', quantidade: 300, faturamento: 1500, custoTotal: 1000, lucro: 500, margemPercentual: 33.33, semCusto: false },
          { posicao: 2, id: 102, nome: 'ARROZ 5KG', quantidade: 120.5, faturamento: 3010.25, custoTotal: 2710.25, lucro: 300, margemPercentual: 9.97, semCusto: false },
        ],
      });
      const lucros = res.body.itens.map((item) => item.lucro);
      expect(lucros).toEqual([...lucros].sort((a, b) => b - a));
    });

    it('usa vendaitem.pcusto, JOIN/WHERE de venda válida, período parametrizado, ORDER BY lucro DESC (padrão) e LIMIT ?', async () => {
      execute.mockResolvedValue([[], []]);

      const res = await request(app).get(ROTA).query({ ...PERIODO, criterio: 'margem', nivel: 'setor', id: '5' });

      expect(res.status).toBe(200);
      expect(execute).toHaveBeenCalledTimes(1);
      const [{ sql }, params] = execute.mock.calls[0];
      const periodo = buildPeriodFilter(PERIODO.inicio, PERIODO.fim);
      const departamento = buildDepartmentFilter({ nivel: 'setor', id: '5' });
      expect(sql).toContain(JOIN_VENDA_VALIDA);
      expect(sql).toContain(WHERE_VENDA_VALIDA);
      expect(sql).toContain(periodo.clause);
      expect(sql).toContain(departamento.clause);
      // CMV gravado no item; faturamento e custo por item (nunca vendacupom.valortotal)
      expect(sql).toMatch(/SUM\(\s*vendaitem\.qt\s*\*\s*vendaitem\.pcusto/i);
      expect(sql).toContain('vendaitem.vtotal');
      expect(sql).not.toMatch(/valortotal/i);
      // agrupa só por produto (não por pcusto) e ordena por lucro decrescente com desempate por id
      expect(sql).toMatch(/GROUP BY produto\.idProduto, produto\.descricao\s+ORDER BY/);
      expect(sql).not.toMatch(/GROUP BY[^]*pcusto[^]*ORDER BY/);
      expect(sql).toContain('ORDER BY MAX(vendaitem.pcusto IS NULL), lucro DESC, produto.idProduto');
      expect(sql).toMatch(/LIMIT \?\s*$/);
      // divisão por zero protegida no SQL
      expect(sql).toMatch(/NULLIF\(/i);
      expect(params).toEqual([...periodo.params, ...departamento.params, 10]);
    });

    it('não usa COALESCE(pcusto, 0) e detecta custo ausente só por pcusto IS NULL (pcusto = 0 não é nulo)', async () => {
      execute.mockResolvedValue([[], []]);

      await request(app).get(ROTA).query({ ...PERIODO, criterio: 'margem' });

      const [{ sql }] = execute.mock.calls[0];
      expect(sql).not.toMatch(/COALESCE\(\s*vendaitem\.pcusto/i);
      expect(sql).toMatch(/vendaitem\.pcusto IS NULL/i);
      expect(sql).toMatch(/AS semCusto/);
      expect(sql).not.toMatch(/pcusto\s*=\s*0/);
    });

    it('com semCusto=true zera custoTotal, lucro e margemPercentual (null), mantendo faturamento e quantidade', async () => {
      execute.mockResolvedValue([
        [{ id: 401, nome: 'SEM CUSTO', quantidade: 10, faturamento: '200.0000', custoTotal: '50.0000', lucro: '150.0000', margemPercentual: '75.0000', semCusto: 1 }],
        [],
      ]);

      const res = await request(app).get(ROTA).query({ ...PERIODO, criterio: 'margem' });

      expect(res.status).toBe(200);
      expect(res.body.itens).toEqual([
        { posicao: 1, id: 401, nome: 'SEM CUSTO', quantidade: 10, faturamento: 200, custoTotal: null, lucro: null, margemPercentual: null, semCusto: true },
      ]);
    });

    it('com faturamento zero e custo cadastrado não divide por zero: margemPercentual 0, sem erro', async () => {
      execute.mockResolvedValue([
        [{ id: 201, nome: 'BRINDE', quantidade: 5, faturamento: '0.0000', custoTotal: '0.0000', lucro: '0.0000', margemPercentual: null, semCusto: 0 }],
        [],
      ]);

      const res = await request(app).get(ROTA).query({ ...PERIODO, criterio: 'margem' });

      expect(res.status).toBe(200);
      expect(res.body.itens).toEqual([
        { posicao: 1, id: 201, nome: 'BRINDE', quantidade: 5, faturamento: 0, custoTotal: 0, lucro: 0, margemPercentual: 0, semCusto: false },
      ]);
    });

    it('lucro negativo (venda abaixo do custo) é preservado', async () => {
      execute.mockResolvedValue([
        [{ id: 301, nome: 'OFERTA', quantidade: 10, faturamento: '80.0000', custoTotal: '100.0000', lucro: '-20.0000', margemPercentual: '-25.0000', semCusto: 0 }],
        [],
      ]);

      const res = await request(app).get(ROTA).query({ ...PERIODO, criterio: 'margem' });

      expect(res.status).toBe(200);
      expect(res.body.itens[0]).toMatchObject({ lucro: -20, custoTotal: 100, margemPercentual: -25, semCusto: false });
    });

    it('ordenarPor=margemPercentual muda o ORDER BY para margemPercentual DESC, com desempate por id', async () => {
      execute.mockResolvedValue([[], []]);

      const res = await request(app).get(ROTA).query({ ...PERIODO, criterio: 'margem', ordenarPor: 'margemPercentual' });

      expect(res.status).toBe(200);
      const [{ sql }, params] = execute.mock.calls[0];
      expect(sql).toMatch(/ORDER BY MAX\(vendaitem\.pcusto IS NULL\), margemPercentual DESC, produto\.idProduto\s+LIMIT \?/);
      expect(sql).not.toMatch(/ORDER BY[^]*lucro DESC/);
      // ordenarPor nunca vira parâmetro nem é interpolado além da whitelist
      expect(params).toEqual([...buildPeriodFilter(PERIODO.inicio, PERIODO.fim).params, 10]);
    });

    it('ordenarPor=lucro explícito equivale ao padrão (ORDER BY lucro DESC)', async () => {
      execute.mockResolvedValue([[], []]);

      const res = await request(app).get(ROTA).query({ ...PERIODO, criterio: 'margem', ordenarPor: 'lucro' });

      expect(res.status).toBe(200);
      const [{ sql }] = execute.mock.calls[0];
      expect(sql).toContain('ORDER BY MAX(vendaitem.pcusto IS NULL), lucro DESC, produto.idProduto');
    });

    it('ordenarPor fora da whitelist retorna 400 { erro } sem consultar o banco', async () => {
      const valores = ['preco', 'lucro; DROP TABLE produto', 'LUCRO', '', 'lucro,margemPercentual'];
      const respostas = await Promise.all(
        valores.map((ordenarPor) => request(app).get(ROTA).query({ ...PERIODO, criterio: 'margem', ordenarPor }))
      );
      const emArray = await request(app).get(
        `${ROTA}?inicio=2026-09-01&fim=2026-09-30&criterio=margem&ordenarPor=lucro&ordenarPor=margemPercentual`
      );

      [...respostas, emArray].forEach((res) => {
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ erro: expect.stringMatching(/ordenarPor/) });
      });
      expect(execute).not.toHaveBeenCalled();
    });

    it.each(['lucro', 'margemPercentual'])(
      'ordenarPor=%s coloca produtos sem valor (semCusto) no FINAL: ORDER BY MAX(pcusto IS NULL) antes da coluna',
      async (ordenarPor) => {
        execute.mockResolvedValue([[], []]);

        await request(app).get(ROTA).query({ ...PERIODO, criterio: 'margem', ordenarPor });

        const [{ sql }] = execute.mock.calls[0];
        expect(sql).toContain(`ORDER BY MAX(vendaitem.pcusto IS NULL), ${ordenarPor} DESC, produto.idProduto`);
        // lucro/margem já saem NULL do SQL quando algum item do produto não tem pcusto
        expect(sql).toMatch(/IF\(MAX\(vendaitem\.pcusto IS NULL\) = 1, NULL,/);
      }
    );

    // Regressão (MariaDB 10.1, ER_ILLEGAL_REFERENCE / errno 1247): alias que aponta para função de
    // agregação só é aceito SOZINHO no ORDER BY, nunca dentro de expressão.
    it.each(['lucro', 'margemPercentual'])(
      'ordenarPor=%s: o ORDER BY nunca usa alias de agregação (lucro/margemPercentual/custoTotal) dentro de expressão',
      async (ordenarPor) => {
        execute.mockResolvedValue([[], []]);

        await request(app).get(ROTA).query({ ...PERIODO, criterio: 'margem', ordenarPor });

        const [{ sql }] = execute.mock.calls[0];
        const orderBy = sql.match(/ORDER BY([^]*?)\s+LIMIT \?/)[1];
        const itens = orderBy.split(',').map((item) => item.trim());
        const aliases = ['lucro', 'margemPercentual', 'custoTotal'];
        expect(aliases.some((alias) => new RegExp(`\\b${alias}\\b`).test(orderBy))).toBe(true);
        itens.forEach((item) => {
          aliases.forEach((alias) => {
            if (new RegExp(`\\b${alias}\\b`).test(item)) {
              // item isolado: o alias, com no máximo a direção (ASC/DESC)
              expect(item).toMatch(new RegExp(`^${alias}(\\s+(ASC|DESC))?$`));
            }
          });
        });
      }
    );

    it('a ordem devolvida pelo banco é preservada: produtos semCusto aparecem no fim da lista, não somem', async () => {
      execute.mockResolvedValue([
        [
          { id: 1, nome: 'A', quantidade: 1, faturamento: '100.0000', custoTotal: '60.0000', lucro: '40.0000', margemPercentual: '40.0000', semCusto: 0 },
          { id: 2, nome: 'B', quantidade: 1, faturamento: '900.0000', custoTotal: null, lucro: null, margemPercentual: null, semCusto: 1 },
        ],
        [],
      ]);

      const res = await request(app).get(ROTA).query({ ...PERIODO, criterio: 'margem' });

      expect(res.body.itens.map((item) => [item.id, item.semCusto])).toEqual([[1, false], [2, true]]);
    });

    it('erro do banco retorna 500 genérico', async () => {
      execute.mockRejectedValue(Object.assign(new Error('Unknown column pcusto'), { code: 'ER_BAD_FIELD_ERROR' }));

      const res = await request(app).get(ROTA).query({ ...PERIODO, criterio: 'margem' });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ erro: 'Erro interno.' });
      expect(JSON.stringify(res.body)).not.toMatch(/pcusto|ER_BAD_FIELD_ERROR/);
    });
  });

  it('ordenarPor só se aplica a criterio=margem: nos outros critérios é ignorado (não gera 400 nem altera o ORDER BY)', async () => {
    execute.mockResolvedValue([[], []]);

    const res = await request(app).get(ROTA).query({ ...PERIODO, criterio: 'vendas', ordenarPor: 'qualquer' });

    expect(res.status).toBe(200);
    const [{ sql }] = execute.mock.calls[0];
    expect(sql).toMatch(/ORDER BY quantidade DESC/);
    expect(sql).not.toMatch(/qualquer/);
  });

  it('erro do banco retorna 500 genérico sem vazar detalhes internos', async () => {
    execute.mockRejectedValue(
      Object.assign(new Error('Table erp.vendaitem missing'), { code: 'ER_NO_SUCH_TABLE' })
    );

    const res = await request(app).get(ROTA).query({ ...PERIODO, criterio: 'vendas' });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ erro: 'Erro interno.' });
    expect(JSON.stringify(res.body)).not.toMatch(/vendaitem|ER_NO_SUCH_TABLE/);
  });
});

describe('ranking.controller - erro inesperado (fora do service)', () => {
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
      jest.doMock('../../../src/modules/rankingProdutos/ranking.service', () => ({
        obterRanking: jest.fn().mockRejectedValue(erro),
        CRITERIOS_VALIDOS: ['vendas'],
        ErroCacheIncompleto: class ErroCacheIncompleto extends Error {},
        ErroInternoRanking: class ErroInternoRanking extends Error {},
      }));
      const router = require('../../../src/modules/rankingProdutos/ranking.routes');
      appComFalha = express();
      appComFalha.use('/api/ranking-produtos', router);
    });
    jest.dontMock('../../../src/modules/rankingProdutos/ranking.service');
    return appComFalha;
  }

  it('erro inesperado responde 500 genérico e loga só o nome e o código do erro (nunca mensagem, pilha ou SQL)', async () => {
    const erro = Object.assign(new TypeError('Cannot read properties of undefined SELECT * FROM vendaitem segredo'), {
      code: 'ERR_INESPERADO',
    });
    const appComFalha = montarAppComServicoQueFalha(erro);

    const res = await request(appComFalha).get(ROTA).query({ ...PERIODO, criterio: 'vendas' });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ erro: 'Erro interno.' });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const registro = errorSpy.mock.calls[0].join(' ');
    expect(registro).toContain('TypeError');
    expect(registro).toContain('ERR_INESPERADO');
    expect(registro).not.toMatch(/SELECT|segredo|vendaitem|Cannot read/i);
  });
});
