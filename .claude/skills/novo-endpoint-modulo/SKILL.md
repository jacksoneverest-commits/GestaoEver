---
name: novo-endpoint-modulo
description: Use ao criar um novo endpoint de API para um dos módulos de dados do GestãoEverSoftPlus (vendas, ranking-produtos, curva-abc, rentabilidade, estoque, auth) — por exemplo "criar endpoint de X", "implementar rota GET /api/<modulo>/...", "adicionar consulta de Y para o módulo Z". Faz o scaffold de controller + service + teste seguindo a convenção REST /api/<modulo> do CLAUDE.md, reaproveita os filtros compartilhados de período/departamento e aplica automaticamente a regra de venda válida (flagvc.Venda=1, vendacupom.status=0) definida no SPEC.md, sem precisar repetir essas regras a cada task do PLAN.md.
---

# Novo endpoint de módulo

## Quando usar
Dispare esta skill sempre que a tarefa for criar (ou estender) um endpoint de leitura de dados para um dos módulos definidos em `SPEC.md` → seção **Módulos**:

- `auth` — Autenticação/Usuários
- `vendas` — Vendas e Faturamento
- `ranking-produtos` — Ranking de Produtos
- `curva-abc` — Curva ABC
- `rentabilidade` — Rentabilidade
- `estoque` — Estoque Inteligente

Isso cobre a maioria das tasks de backend do `PLAN.md` (ex: Task 5.1, 5.2, 5.3, 7.1, 7.2, 9.1, 11.1, 11.2, 13.1, 13.2).

## Pré-requisitos (assumidos já existentes)
- `backend/src/db/connection.js` — pool de conexão MariaDB (PLAN.md, Fase 2)
- `backend/src/shared/queryFilters.js` — exporta `buildPeriodFilter(dataInicio, dataFim)` e `buildDepartmentFilter({ nivel, id })` (PLAN.md, Fase 4)

Se esses arquivos ainda não existirem, pare e sinalize que as Fases 2 e 4 do PLAN.md precisam ser feitas antes — não recrie esses utilitários dentro da task do endpoint.

## Regras obrigatórias (de SPEC.md e CLAUDE.md — não negociáveis)

1. **Venda só é válida se `flagvc.Venda = 1` (join `vendacupom.Flag = flagvc.flag`) e `vendacupom.status = 0`.** Todo endpoint que agrega dados de venda (`vendacupom`/`vendaitem`) precisa desse filtro no `WHERE`. `status = 5` é cancelada e nunca deve ser somado como venda válida.
2. **`vendacupom.valortotal` já é valor líquido** — nunca aplicar desconto/imposto de novo em cima dele.
3. **Joins do domínio:** `vendacupom.idcupom = vendaitem.idcupom`; `vendaitem.produto = produto.idproduto`; `produto` liga a `setor`, `grupo` e `familia` (departamentos); forma de pagamento via `vendacupom.formapag = formapag.idFormaPag`; clientes em `clifor`.
4. **Toda consulta é filtrável por período** — use `buildPeriodFilter`, nunca monte a cláusula de data manualmente dentro do controller.
5. **Toda visão por departamento** deve aceitar `nivel` (`grupo` | `setor` | `familia`) + `id`, via `buildDepartmentFilter` — nunca hardcode um único nível.
6. **Comparativos entre períodos usam a tabela de cache/histórico** (`vendas_periodo_cache`, `compras_periodo_cache`), nunca uma varredura direta das tabelas transacionais completas para montar comparativo com período anterior.
7. **TDD primeiro:** escreva pelo menos 2 testes críticos (um caminho válido, um caso de erro/edge case) em `backend/tests/<modulo>/...` antes de escrever o código do controller/service — espelhando a regra do PLAN.md.
8. **Nomenclatura:** arquivos em `backend/src/modules/<modulo>/<nome>.controller.js` e `<nome>.service.js` (lowerCamelCase); rotas REST em `/api/<modulo>/<recurso>`.

## Passo a passo

1. Identifique o módulo, o path REST e o formato de resposta a partir da task do `PLAN.md` (campo "Output").
2. Escreva os testes primeiro em `backend/tests/<modulo>/<nome>.controller.test.js`, cobrindo:
   - um cenário com dados válidos retornando o resultado esperado
   - um cenário de erro (parâmetro inválido, ou vendas que devem ser excluídas pela regra do flag/status)
3. Implemente o `service` (`backend/src/modules/<modulo>/<nome>.service.js`) com a query SQL, usando `buildPeriodFilter`/`buildDepartmentFilter` e o filtro `flagvc.Venda = 1 AND vendacupom.status = 0` quando aplicável.
4. Implemente o `controller` (`backend/src/modules/<modulo>/<nome>.controller.js`) que valida os parâmetros de entrada, chama o service e formata a resposta.
5. Registre a rota no roteador do módulo (ou em `backend/src/app.js` se o módulo ainda não tiver um router próprio).
6. Rode `npm test` em `backend/` e confirme que os testes passam antes de considerar a task concluída.

## Exemplo de input
```
Implemente o endpoint de faturamento do módulo de vendas
(Task 5.1 do PLAN.md): GET /api/vendas/faturamento?inicio&fim
```

## Exemplo de output esperado

`backend/tests/vendas/faturamento.controller.test.js`
```js
const request = require('supertest');
const createApp = require('../../src/app');

describe('GET /api/vendas/faturamento', () => {
  it('soma apenas vendas válidas (flag=1, status=0) no período informado', async () => {
    const app = createApp();
    const response = await request(app)
      .get('/api/vendas/faturamento')
      .query({ inicio: '2026-09-01', fim: '2026-09-30' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        faturamento: expect.any(Number),
        ticketMedio: expect.any(Number),
        quantidadeCupons: expect.any(Number),
      })
    );
  });

  it('retorna 400 quando "inicio" ou "fim" estão ausentes', async () => {
    const app = createApp();
    const response = await request(app).get('/api/vendas/faturamento');

    expect(response.status).toBe(400);
  });
});
```

`backend/src/modules/vendas/faturamento.service.js`
```js
const pool = require('../../db/connection');
const { buildPeriodFilter } = require('../../shared/queryFilters');

async function getFaturamento(dataInicio, dataFim) {
  const periodo = buildPeriodFilter(dataInicio, dataFim);

  const [rows] = await pool.query(
    `SELECT
       SUM(vc.valortotal) AS faturamento,
       COUNT(*) AS quantidadeCupons,
       SUM(vc.valortotal) / COUNT(*) AS ticketMedio
     FROM vendacupom vc
     INNER JOIN flagvc f ON f.flag = vc.Flag
     WHERE vc.venda = 1
       AND vc.status = 0
       AND f.Venda = 1
       AND ${periodo.clause}`,
    periodo.params
  );

  return rows[0];
}

module.exports = { getFaturamento };
```

`backend/src/modules/vendas/faturamento.controller.js`
```js
const { getFaturamento } = require('./faturamento.service');

async function faturamentoHandler(req, res) {
  const { inicio, fim } = req.query;

  if (!inicio || !fim) {
    return res.status(400).json({ erro: 'Parâmetros "inicio" e "fim" são obrigatórios' });
  }

  const resultado = await getFaturamento(inicio, fim);
  res.status(200).json(resultado);
}

module.exports = { faturamentoHandler };
```

## Quando NÃO usar esta skill
- Para telas/componentes de **frontend** — isso é escopo de uma skill de tela de dashboard, não desta.
- Para endpoints que **escrevem** dados de negócio ainda fora de escopo do SPEC.md (ex: edição de preço pelo gestor) — esses nem devem ser implementados nesta fase (ver "Nunca fazer" do CLAUDE.md).
- Para a criação dos próprios utilitários compartilhados (`queryFilters.js`, `connection.js`) ou das migrations das tabelas de cache — isso é o escopo das Fases 2 e 4 do PLAN.md, não desta skill.
- Para revisar/auditar código já escrito em busca de violação das regras de negócio — use uma skill de revisão dedicada, não esta (esta skill é para *criar* o endpoint, não para *revisar* um já existente).
- Para funcionalidades listadas em "Fora do escopo" no SPEC.md (central de alertas, previsão de vendas, promoções inteligentes, etc.) — pare e confirme com o usuário antes de implementar.
