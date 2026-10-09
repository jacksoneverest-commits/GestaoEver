const { decidirDesde, hojeLocalIso, somarDias, lerDesdeArgv } = require('../../src/jobs/agendarJobsDiarios');

describe('agendarJobsDiarios - lerDesdeArgv', () => {
  it('sem --desde devolve null (a rotina decide sozinha)', () => {
    expect(lerDesdeArgv([])).toBeNull();
  });

  it('--desde AAAA-MM-DD devolve a data informada', () => {
    expect(lerDesdeArgv(['--desde', '2025-01-01'])).toBe('2025-01-01');
  });

  it('--desde com formato inválido lança erro (nunca repassa texto livre aos jobs)', () => {
    expect(() => lerDesdeArgv(['--desde', '01/01/2025'])).toThrow();
    expect(() => lerDesdeArgv(['--desde'])).toThrow();
  });
});

describe('agendarJobsDiarios - decidirDesde (lógica pura, sem banco nem processos)', () => {
  it('nunca rodou com sucesso (estado ausente) -> pede --desde de 30 dias atrás', () => {
    expect(decidirDesde(null, '2026-09-27')).toBe(somarDias('2026-09-27', -30));
  });

  it('estado sem ultimaExecucaoOk (ex.: só tentativas com falha) -> pede --desde de 30 dias atrás', () => {
    expect(decidirDesde({ ultimaExecucaoTentativa: '2026-09-26', ultimaExecucaoOk: null }, '2026-09-27')).toBe(
      somarDias('2026-09-27', -30)
    );
  });

  it('rodou com sucesso ontem (1 dia parado) -> não pede --desde (recálculo normal basta)', () => {
    expect(decidirDesde({ ultimaExecucaoOk: '2026-09-26' }, '2026-09-27')).toBeNull();
  });

  it('ficou 2 dias ou mais sem rodar com sucesso -> pede --desde de 30 dias atrás', () => {
    expect(decidirDesde({ ultimaExecucaoOk: '2026-09-24' }, '2026-09-27')).toBe(somarDias('2026-09-27', -30));
  });

  it('rodou com sucesso hoje mesmo (0 dias parado) -> não pede --desde', () => {
    expect(decidirDesde({ ultimaExecucaoOk: '2026-09-27' }, '2026-09-27')).toBeNull();
  });
});

describe('agendarJobsDiarios - hojeLocalIso e somarDias', () => {
  it('hojeLocalIso formata a data local como AAAA-MM-DD', () => {
    expect(hojeLocalIso(new Date(2026, 8, 27, 23, 59))).toBe('2026-09-27');
  });

  it('somarDias soma corretamente atravessando a virada de mês/ano', () => {
    expect(somarDias('2026-01-01', -1)).toBe('2025-12-31');
    expect(somarDias('2026-09-27', -30)).toBe('2026-08-28');
  });
});
