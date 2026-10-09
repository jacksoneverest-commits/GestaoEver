import { describe, it, expect, vi, afterEach } from 'vitest';
import { gerarCsv, baixarCsv } from '../../src/utils/csv.js';

describe('gerarCsv', () => {
  it('gera BOM UTF-8, cabeçalho e linhas separados por ponto e vírgula', () => {
    const csv = gerarCsv(['Hora', 'Faturamento'], [['08h', 1234.5], ['09h', 10]]);
    expect(csv).toBe('﻿Hora;Faturamento\r\n08h;1234,5\r\n09h;10');
  });

  it('escapa ponto e vírgula, aspas e quebras de linha entre aspas', () => {
    const csv = gerarCsv(['Nome'], [['Pão; "francês"'], ['linha\nnova']]);
    expect(csv).toBe('﻿Nome\r\n"Pão; ""francês"""\r\n"linha\nnova"');
  });

  it('neutraliza fórmulas de planilha em textos que começam com = + - @', () => {
    const csv = gerarCsv(['Nome'], [['=SOMA(A1)'], ['@x'], ['+1'], ['-1']]);
    expect(csv).toBe("﻿Nome\r\n'=SOMA(A1)\r\n'@x\r\n'+1\r\n'-1");
  });

  it('não altera números negativos e trata nulos como vazio', () => {
    const csv = gerarCsv(['A', 'B'], [[-5.25, null], [undefined, 0]]);
    expect(csv).toBe('﻿A;B\r\n-5,25;\r\n;0');
  });

  it('neutraliza fórmula precedida de espaço ou quebra de linha', () => {
    const csv = gerarCsv(['Nome'], [[' =1+1'], ['\t@x'], ['\n=1']]);
    expect(csv).toBe('﻿Nome\r\n\' =1+1\r\n\'\t@x\r\n"\'\n=1"');
  });
});

describe('baixarCsv', () => {
  afterEach(() => vi.restoreAllMocks());

  it('cria um Blob, baixa com o nome do arquivo, remove o link e libera a URL', () => {
    const criar = vi.fn(() => 'blob:teste');
    const revogar = vi.fn();
    URL.createObjectURL = criar;
    URL.revokeObjectURL = revogar;
    let link;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function clique() {
      link = this;
      expect(document.body.contains(this)).toBe(true);
    });

    baixarCsv('vendas.csv', 'a;b');

    const blob = criar.mock.calls[0][0];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toContain('text/csv');
    expect(link.download).toBe('vendas.csv');
    expect(link.href).toContain('blob:teste');
    expect(document.body.contains(link)).toBe(false);
    expect(revogar).toHaveBeenCalledWith('blob:teste');
  });
});
