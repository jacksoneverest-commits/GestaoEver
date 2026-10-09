import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import EstadoVazio from '../../../src/components/EstadoVazio/EstadoVazio.jsx';

describe('EstadoVazio', () => {
  it('mostra título e orientação', () => {
    render(<EstadoVazio titulo="Meta não configurada" descricao="Configure a meta para acompanhar." />);

    expect(screen.getByText('Meta não configurada')).toBeInTheDocument();
    expect(screen.getByText('Configure a meta para acompanhar.')).toBeInTheDocument();
  });

  it('funciona só com o título', () => {
    render(<EstadoVazio titulo="Nenhum dado" />);

    expect(screen.getByText('Nenhum dado')).toBeInTheDocument();
  });
});
