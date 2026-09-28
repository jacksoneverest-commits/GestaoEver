import { describe, expect, it } from 'vitest';
import { classificarErro } from '../../src/utils/erroApi.js';

const erroHttp = (status, mensagem) => Object.assign(new Error(mensagem), { status });

describe('classificarErro', () => {
  it('status 503 vira o tipo "nao-preparado" mantendo a mensagem do servidor', () => {
    expect(classificarErro(erroHttp(503, 'Rode o job'), 'padrão')).toEqual({ tipo: 'nao-preparado', mensagem: 'Rode o job' });
  });

  it('status 501 vira o tipo "indisponivel"', () => {
    expect(classificarErro(erroHttp(501, 'Ainda não'), 'padrão')).toEqual({ tipo: 'indisponivel', mensagem: 'Ainda não' });
  });

  it('qualquer outro erro vira "generico" com a mensagem do erro', () => {
    expect(classificarErro(erroHttp(500, 'Falhou'), 'padrão')).toEqual({ tipo: 'generico', mensagem: 'Falhou' });
  });

  it('sem mensagem (ou sem erro) usa a mensagem padrão informada por quem chama', () => {
    expect(classificarErro(new Error(''), 'Erro ao carregar X.')).toEqual({ tipo: 'generico', mensagem: 'Erro ao carregar X.' });
    expect(classificarErro(undefined, 'Erro ao carregar X.')).toEqual({ tipo: 'generico', mensagem: 'Erro ao carregar X.' });
  });
});
