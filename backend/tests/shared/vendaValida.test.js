const { JOIN_VENDA_VALIDA, WHERE_VENDA_VALIDA } = require('../../src/shared/vendaValida');

describe('vendaValida', () => {
  it('junta vendacupom a flagvc por Flag e exige flagvc.Venda = 1 e Status = 0', () => {
    expect(JOIN_VENDA_VALIDA).toBe('INNER JOIN flagvc ON flagvc.flag = vendacupom.Flag');
    expect(WHERE_VENDA_VALIDA).toBe('flagvc.Venda = 1 AND vendacupom.Status = 0');
  });
});
