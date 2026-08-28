# DOGFIT CANICROSS — Módulo CONSIGNADOS

Implementação incremental sobre a estrutura existente da DOGFIT.

## Reaproveitado
- `club_partners`: parceiros/pet shops existentes.
- `partner_referral_settings`: apenas leitura do cupom de indicação do parceiro; não é misturado com comissão de consignação.
- `products`: catálogo de produtos existente.
- Basic Auth administrativo já usado pelo Worker.

## Criado
- `migrations/0011_consignments.sql`
- `consignados-admin.html`
- `css/consignados-admin.css`
- `js/consignados-admin.js`
- `functions/api/consignments.js`

## Banco
A migration 0011 adiciona configurações de consignação a `club_partners` e cria:
- `consignments`: cabeçalhos das remessas.
- `consignment_items`: itens/snapshots de cada remessa.
- `consignment_movements`: fonte de verdade do estoque e histórico (ENVIADO, VENDA, REPOSICAO, DEVOLUCAO, AJUSTE, ESTORNO_VENDA).
- `consignment_settlements`: fechamentos e pagamentos de comissão.

Valores financeiros novos são armazenados em centavos. Percentuais são armazenados em basis points (30% = 3000).

## Regras principais
- Estoque atual = soma de `stock_delta` das movimentações.
- Venda calcula comissão e líquido no Worker.
- Venda/devolução/ajuste negativo não permitem estoque abaixo de zero.
- Estorno de venda preserva o registro original e cria uma movimentação inversa.
- Venda vinculada a fechamento pendente deve ter o fechamento cancelado antes do estorno.
- Fechamento pago não pode ser apagado/cancelado pelo painel.
- Produto ou parceiro com histórico de consignação é inativado, não excluído definitivamente.
- Produto sem tamanho/variação é suportado usando variação vazia.
- Alertas respeitam parceiro ativo, consignação habilitada e mínimo configurado.

## Ordem segura de publicação
1. Manter o backup do D1 feito antes da migration.
2. Substituir os arquivos do hotfix no projeto local.
3. Aplicar somente a migration 0011 no D1 remoto.
4. Confirmar as novas tabelas/colunas.
5. `git status`, commit e push.
6. Deploy com Wrangler.
7. Testar remessa → venda → reposição → devolução → fechamento → pagamento.
