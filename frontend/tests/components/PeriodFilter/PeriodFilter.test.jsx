import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import PeriodFilter from '../../../src/components/PeriodFilter/PeriodFilter.jsx';

function preencher(rotulo, valor) {
  fireEvent.change(screen.getByLabelText(rotulo), { target: { value: valor } });
}

describe('PeriodFilter', () => {
  it('dispara onChange com as datas corretas ao selecionar um intervalo válido', () => {
    const onChange = vi.fn();
    render(<PeriodFilter onChange={onChange} />);

    preencher('Data inicial', '2026-03-01');
    preencher('Data final', '2026-03-31');

    expect(onChange).toHaveBeenLastCalledWith({ startDate: '2026-03-01', endDate: '2026-03-31' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('exibe erro de validação e não dispara onChange quando a data final é anterior à inicial', () => {
    const onChange = vi.fn();
    render(<PeriodFilter onChange={onChange} />);

    preencher('Data inicial', '2026-03-10');
    preencher('Data final', '2026-03-05');

    expect(screen.getByRole('alert')).toHaveTextContent(
      'A data final não pode ser anterior à data inicial.',
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it('remove o erro e dispara onChange ao corrigir a data final', () => {
    const onChange = vi.fn();
    render(<PeriodFilter onChange={onChange} />);

    preencher('Data inicial', '2026-03-10');
    preencher('Data final', '2026-03-05');
    preencher('Data final', '2026-03-12');

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ startDate: '2026-03-10', endDate: '2026-03-12' });
  });

  it('não dispara onChange enquanto apenas uma das datas está preenchida', () => {
    const onChange = vi.fn();
    render(<PeriodFilter onChange={onChange} />);

    preencher('Data inicial', '2026-03-10');

    expect(onChange).not.toHaveBeenCalled();
  });

  it('exibe as datas iniciais recebidas por props', () => {
    render(<PeriodFilter startDate="2026-01-01" endDate="2026-01-31" onChange={() => {}} />);

    expect(screen.getByLabelText('Data inicial')).toHaveValue('2026-01-01');
    expect(screen.getByLabelText('Data final')).toHaveValue('2026-01-31');
  });
});
