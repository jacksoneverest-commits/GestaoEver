import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import CampoQuantidade from '../../../src/components/CampoQuantidade/CampoQuantidade.jsx';

const props = { prefixo: 'tela', maximo: 100, sugestoes: [10, 50, 100, 500], valor: '10', onChange: () => {} };

describe('CampoQuantidade', () => {
  it('renderiza um campo numérico rotulado com min/max e chama onChange com o texto digitado', () => {
    const onChange = vi.fn();
    render(<CampoQuantidade {...props} onChange={onChange} />);

    const campo = screen.getByLabelText('Quantidade de itens');
    expect(campo).toHaveValue(10);
    expect(campo).toHaveAttribute('type', 'number');
    expect(campo).toHaveAttribute('min', '1');
    expect(campo).toHaveAttribute('max', '100');
    expect(campo).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    fireEvent.change(campo, { target: { value: '25' } });
    expect(onChange).toHaveBeenCalledWith('25');
  });

  it('só oferece sugestões dentro do máximo', () => {
    const { container } = render(<CampoQuantidade {...props} />);

    const valores = Array.from(container.querySelectorAll('datalist option')).map((o) => o.getAttribute('value'));
    expect(valores).toEqual(['10', '50', '100']);
  });

  it('com erro sinaliza aria-invalid e associa o alerta ao campo via aria-describedby', () => {
    render(<CampoQuantidade {...props} erro />);

    const campo = screen.getByLabelText('Quantidade de itens');
    const alerta = screen.getByRole('alert');
    expect(alerta).toHaveTextContent('Informe um número inteiro de 1 a 100.');
    expect(campo).toHaveAttribute('aria-invalid', 'true');
    expect(campo.getAttribute('aria-describedby')).toBe(alerta.id);
    expect(campo).toHaveClass('tela__input--invalido');
  });
});
