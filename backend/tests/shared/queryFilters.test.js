const {
  buildPeriodFilter,
  buildDepartmentFilter,
  ErroValidacao,
  DIAS_MAXIMOS_PERIODO,
} = require('../../src/shared/queryFilters');

describe('buildPeriodFilter', () => {
  it('retorna cláusula SQL parametrizada para um intervalo de datas válido', () => {
    const { clause, params } = buildPeriodFilter('2026-01-01', '2026-01-31');

    expect(clause).toBe('vendacupom.data >= ? AND vendacupom.data < ?');
    // fim inclusivo: limite superior é o início do dia seguinte
    expect(params).toEqual(['2026-01-01 00:00:00', '2026-02-01 00:00:00']);
  });

  it('calcula o dia seguinte em UTC na virada de ano e em ano bissexto', () => {
    expect(buildPeriodFilter('2025-12-30', '2025-12-31').params[1]).toBe('2026-01-01 00:00:00');
    expect(buildPeriodFilter('2024-02-28', '2024-02-29').params[1]).toBe('2024-03-01 00:00:00');
  });

  it('aceita intervalo de um único dia (início igual ao fim)', () => {
    const { params } = buildPeriodFilter('2026-03-10', '2026-03-10');
    expect(params).toEqual(['2026-03-10 00:00:00', '2026-03-11 00:00:00']);
  });

  it('usa a coluna informada quando fornecida', () => {
    const { clause } = buildPeriodFilter('2026-01-01', '2026-01-31', 'c.data');
    expect(clause).toBe('c.data >= ? AND c.data < ?');
  });

  it('rejeita coluna com conteúdo que não seja identificador SQL simples', () => {
    expect(() => buildPeriodFilter('2026-01-01', '2026-01-31', 'data; DROP TABLE x')).toThrow(ErroValidacao);
  });

  it('rejeita data inexistente no calendário ou em formato diferente de YYYY-MM-DD', () => {
    expect(() => buildPeriodFilter('2026-02-30', '2026-03-01')).toThrow(ErroValidacao);
    expect(() => buildPeriodFilter('01/01/2026', '2026-01-31')).toThrow(ErroValidacao);
    expect(() => buildPeriodFilter(undefined, '2026-01-31')).toThrow(ErroValidacao);
  });

  it('rejeita data final anterior à data inicial', () => {
    expect(() => buildPeriodFilter('2026-02-01', '2026-01-31')).toThrow(/anterior/);
  });

  it('aceita período de exatamente 366 dias (inclusivos) e rejeita 367 com ErroValidacao 400', () => {
    expect(DIAS_MAXIMOS_PERIODO).toBe(366);
    // 2026 não é bissexto: 01/01/2026..01/01/2027 = 366 dias inclusivos
    expect(() => buildPeriodFilter('2026-01-01', '2027-01-01')).not.toThrow();
    // ano bissexto completo = 366 dias
    expect(() => buildPeriodFilter('2024-01-01', '2024-12-31')).not.toThrow();

    for (const [inicio, fim] of [
      ['2026-01-01', '2027-01-02'], // 367 dias
      ['2024-01-01', '2025-01-01'], // 367 dias (ano bissexto + 1)
      ['2020-01-01', '2026-01-01'], // vários anos
    ]) {
      try {
        buildPeriodFilter(inicio, fim);
        throw new Error('deveria ter lançado');
      } catch (erro) {
        expect(erro).toBeInstanceOf(ErroValidacao);
        expect(erro.status).toBe(400);
        expect(erro.message).toBe('O período máximo permitido é de 366 dias.');
      }
    }
  });

  it('marca o erro de validação com status 400', () => {
    try {
      buildPeriodFilter('xx', 'yy');
      throw new Error('deveria ter lançado');
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroValidacao);
      expect(erro.status).toBe(400);
    }
  });
});

describe('buildDepartmentFilter', () => {
  it('lança erro para nivel fora de grupo/setor/familia', () => {
    expect(() => buildDepartmentFilter({ nivel: 'marca', id: 1 })).toThrow(ErroValidacao);
    expect(() => buildDepartmentFilter({ nivel: 'grupo; DROP TABLE produto', id: 1 })).toThrow(ErroValidacao);
    expect(() => buildDepartmentFilter({ id: 1 })).toThrow(ErroValidacao);
    expect(() => buildDepartmentFilter()).toThrow(ErroValidacao);
  });

  it.each([
    ['grupo', 'produto.grupo = ?'],
    ['setor', 'produto.setor = ?'],
    ['familia', 'produto.familia = ?'],
  ])('gera cláusula parametrizada para o nível %s', (nivel, esperado) => {
    const { clause, params } = buildDepartmentFilter({ nivel, id: 7 });
    expect(clause).toBe(esperado);
    expect(params).toEqual([7]);
  });

  it('aceita id numérico em texto (query string) e converte para inteiro', () => {
    expect(buildDepartmentFilter({ nivel: 'grupo', id: '12' }).params).toEqual([12]);
  });

  it('rejeita id ausente, não numérico, decimal ou não positivo', () => {
    for (const id of [undefined, null, '', 'abc', '1 OR 1=1', 1.5, 0, -3]) {
      expect(() => buildDepartmentFilter({ nivel: 'setor', id })).toThrow(ErroValidacao);
    }
  });

  it('usa o alias de tabela informado e rejeita alias inválido', () => {
    expect(buildDepartmentFilter({ nivel: 'familia', id: 3 }, 'p').clause).toBe('p.familia = ?');
    expect(() => buildDepartmentFilter({ nivel: 'familia', id: 3 }, 'p; --')).toThrow(ErroValidacao);
  });
});
