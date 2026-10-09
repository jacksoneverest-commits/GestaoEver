jest.mock('child_process', () => ({ spawn: jest.fn() }));
jest.mock('fs', () => ({ ...jest.requireActual('fs'), readFileSync: jest.fn() }));

const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const cacheService = require('../../../src/modules/cache/cache.service');

function filhoFalso() {
  const filho = new EventEmitter();
  filho.unref = jest.fn();
  return filho;
}

describe('cache.service', () => {
  let filho;

  beforeEach(() => {
    cacheService.reiniciarEstado();
    spawn.mockReset();
    fs.readFileSync.mockReset();
    fs.readFileSync.mockImplementation(() => {
      throw new Error('sem arquivo');
    });
    filho = filhoFalso();
    spawn.mockReturnValue(filho);
  });

  it('iniciarAtualizacao dispara a rotina diária em um processo node separado', () => {
    const status = cacheService.iniciarAtualizacao();

    expect(spawn).toHaveBeenCalledTimes(1);
    const [executavel, args] = spawn.mock.calls[0];
    expect(executavel).toBe(process.execPath);
    expect(args).toEqual([path.resolve(__dirname, '../../../src/jobs/agendarJobsDiarios.js')]);
    expect(status.situacao).toBe('rodando');
  });

  it('chamar de novo enquanto roda não dispara um segundo processo', () => {
    cacheService.iniciarAtualizacao();
    const status = cacheService.iniciarAtualizacao();

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(status.situacao).toBe('rodando');
  });

  it('processo que termina com código 0 deixa a situação em ok', () => {
    cacheService.iniciarAtualizacao();
    filho.emit('exit', 0);

    const status = cacheService.obterStatus();
    expect(status.situacao).toBe('ok');
    expect(status.finalizadoEm).toEqual(expect.any(String));
  });

  it('processo que termina com código diferente de 0 deixa a situação em falha', () => {
    cacheService.iniciarAtualizacao();
    filho.emit('exit', 1);

    expect(cacheService.obterStatus().situacao).toBe('falha');
  });

  it('erro ao iniciar o processo deixa a situação em falha e libera nova tentativa', () => {
    cacheService.iniciarAtualizacao();
    filho.emit('error', new Error('ENOENT'));

    expect(cacheService.obterStatus().situacao).toBe('falha');
    cacheService.iniciarAtualizacao();
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('obterStatus sem nenhuma execução devolve ocioso e ultimaAtualizacao nula', () => {
    expect(cacheService.obterStatus()).toEqual({
      situacao: 'ocioso',
      iniciadoEm: null,
      finalizadoEm: null,
      ultimaAtualizacao: null,
    });
  });

  it('obterStatus devolve ultimaAtualizacao a partir da última execução bem-sucedida registrada pela rotina', () => {
    fs.readFileSync.mockReturnValue(JSON.stringify({ ultimaExecucaoOk: '2026-10-08' }));

    expect(cacheService.obterStatus().ultimaAtualizacao).toBe('2026-10-08');
  });
});
