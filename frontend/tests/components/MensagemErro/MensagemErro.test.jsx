import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import MensagemErro from '../../../src/components/MensagemErro/MensagemErro.jsx';

describe('MensagemErro', () => {
  it('erro genérico aparece em um alerta com a mensagem do servidor', () => {
    render(<MensagemErro prefixo="tela" erro={{ tipo: 'generico', mensagem: 'Falha ao consultar.' }} />);

    const alerta = screen.getByRole('alert');
    expect(alerta).toHaveTextContent('Falha ao consultar.');
    expect(alerta).toHaveClass('tela__erro');
  });

  it('tipo "nao-preparado" mostra o texto amigável e, em segundo plano, a mensagem do servidor, em um alerta', () => {
    render(<MensagemErro prefixo="tela" erro={{ tipo: 'nao-preparado', mensagem: 'Execute o job.' }} />);

    const alerta = screen.getByRole('alert');
    expect(alerta).toHaveTextContent('Dados desse período ainda não foram preparados');
    expect(alerta).toHaveTextContent('Execute o job.');
    expect(alerta).toHaveClass('tela__aviso', 'tela__aviso--atencao');
  });

  it('tipo "indisponivel" mostra "Ainda indisponível" como status (não como alerta)', () => {
    render(<MensagemErro prefixo="tela" erro={{ tipo: 'indisponivel', mensagem: 'Em breve.' }} />);

    expect(screen.getByRole('status')).toHaveTextContent('Ainda indisponível');
    expect(screen.getByText('Em breve.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
