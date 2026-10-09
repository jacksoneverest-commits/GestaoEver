import { useEffect, useRef, useState } from 'react';
import Icon from '../Icon/Icon.jsx';
import { iniciarAtualizacao, obterStatusAtualizacao } from '../../services/cacheService.js';
import { formatDate } from '../../utils/format.js';
import './AtualizarDados.css';

const INTERVALO_POLLING_MS = 3000;

// Botão da topbar que dispara a atualização das tabelas de cache (mesma rotina do job das 01:00) e acompanha
// o andamento por polling. `onConcluido` é chamado quando a rotina termina com sucesso (a tela recarrega os dados).
function AtualizarDados({ onConcluido }) {
  const [rodando, setRodando] = useState(false);
  const [ultimaAtualizacao, setUltimaAtualizacao] = useState(null);
  const [resultado, setResultado] = useState(null); // null | 'ok' | 'falha' | { erro }
  const onConcluidoRef = useRef(onConcluido);
  onConcluidoRef.current = onConcluido;

  function tratarStatus(status) {
    setUltimaAtualizacao(status.ultimaAtualizacao);
    if (status.situacao === 'rodando') {
      setRodando(true);
      return;
    }
    setRodando(false);
  }

  // Ao abrir: mostra a data da última atualização e retoma o acompanhamento se já houver uma rodando.
  useEffect(() => {
    let cancelado = false;
    obterStatusAtualizacao()
      .then((status) => {
        if (!cancelado) tratarStatus(status);
      })
      .catch(() => {
        // Sem o status o botão continua utilizável; o erro aparece se o clique falhar.
      });
    return () => {
      cancelado = true;
    };
  }, []);

  useEffect(() => {
    if (!rodando) return undefined;
    let cancelado = false;
    const intervalo = setInterval(async () => {
      try {
        const status = await obterStatusAtualizacao();
        if (cancelado || status.situacao === 'rodando') return;
        setUltimaAtualizacao(status.ultimaAtualizacao);
        setRodando(false);
        if (status.situacao === 'ok') {
          setResultado('ok');
          if (onConcluidoRef.current) onConcluidoRef.current();
        } else {
          setResultado('falha');
        }
      } catch (erro) {
        if (cancelado) return;
        setRodando(false);
        setResultado({ erro: erro.message });
      }
    }, INTERVALO_POLLING_MS);
    return () => {
      cancelado = true;
      clearInterval(intervalo);
    };
  }, [rodando]);

  async function atualizar() {
    setResultado(null);
    setRodando(true);
    try {
      const status = await iniciarAtualizacao();
      setUltimaAtualizacao(status.ultimaAtualizacao);
    } catch (erro) {
      setRodando(false);
      setResultado({ erro: erro.message });
    }
  }

  return (
    <div className="atualizar-dados">
      {ultimaAtualizacao && (
        <span className="atualizar-dados__ultima">Atualizado em {formatDate(ultimaAtualizacao)}</span>
      )}
      <button type="button" className="atualizar-dados__botao" onClick={atualizar} disabled={rodando}>
        <Icon nome="atualizar" className={rodando ? 'atualizar-dados__icone--girando' : undefined} />
        <span className="atualizar-dados__rotulo">{rodando ? 'Atualizando…' : 'Atualizar dados'}</span>
      </button>
      {resultado === 'ok' && (
        <p role="status" className="atualizar-dados__mensagem atualizar-dados__mensagem--ok">Dados atualizados.</p>
      )}
      {resultado === 'falha' && (
        <p role="alert" className="atualizar-dados__mensagem atualizar-dados__mensagem--erro">
          Falha ao atualizar os dados. Veja o log em backend/estado-jobs.
        </p>
      )}
      {resultado && resultado.erro && (
        <p role="alert" className="atualizar-dados__mensagem atualizar-dados__mensagem--erro">{resultado.erro}</p>
      )}
    </div>
  );
}

export default AtualizarDados;
