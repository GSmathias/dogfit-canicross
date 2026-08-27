# DOGFIT CANICROSS — Cupons de indicação de pet shops

Implementação criada sobre a versão do projeto de 27/08/2026, preservando o sistema de cupons de benefício do Clube (`club_coupons`).

## Arquitetura reaproveitada

- `club_partners`: cadastro e autenticação dos parceiros.
- `event_registrations`: pré-inscrições de eventos.
- `customer_accounts`: vínculo de cliente verificado.
- Mercado Pago existente: preferência, retorno e webhook.
- `club_members`: associação ao Clube DOGFIT.
- Admin existente em `/club-admin` e portal de parceiro em `/parceiro`.

## Estruturas novas

A migration `0010_petshop_referrals.sql` cria:

- `partner_referral_settings`: código, desconto, comissões, validade, limite e regra de acúmulo por parceiro.
- `partner_referrals`: histórico imutável das indicações e snapshots financeiros.

Os valores monetários da nova estrutura são armazenados em centavos. Percentuais são armazenados em basis points (bps), evitando erros de ponto flutuante nos cálculos financeiros.

## Regras padrão

- Desconto do cliente: 5%.
- Comissão por evento pago: R$ 5,00.
- Comissão da primeira mensalidade do Clube: R$ 10,00.
- Comissão de produto: 10% do valor efetivamente pago.
- Limite: 1 uso por cliente, comparando conta, e-mail e telefone.
- Acúmulo com outro desconto: desativado por padrão.
- Comissão é liberada somente com pagamento aprovado.
- Cancelamento/reembolso/chargeback cancela a comissão.
- Parceiros com histórico não são apagados; são desativados.

## Fluxo do evento

1. Cliente abre a pré-inscrição ou `/pre-inscricao?ref=CODIGO`.
2. O campo de indicação é preenchido automaticamente quando há `ref`.
3. `/api/referrals/validate` consulta o D1 e calcula o desconto no Worker.
4. `/api/events/register` valida novamente o código no servidor.
5. A inscrição e a indicação são gravadas como pendentes.
6. O Mercado Pago recebe somente o valor final calculado no servidor.
7. O webhook consulta o pagamento na API do Mercado Pago.
8. Pagamento aprovado libera uma única comissão.
9. Webhook duplicado não cria outra indicação/comissão.
10. Reembolso, chargeback ou cancelamento cancela a comissão.

## Clube e produtos

O projeto atual não possui checkout público para mensalidade do Clube nem carrinho/checkout de produtos. Por isso:

- o formulário administrativo de associado aceita o cupom de indicação e libera a comissão quando a primeira mensalidade é marcada como paga;
- vendas de Clube/produto também podem ser lançadas manualmente em `Indicações de pet shops`, usando a mesma rotina central de pagamento/comissão;
- quando existir checkout de Clube/produto, ele poderá chamar a mesma biblioteca `functions/_lib/referrals.js`.

## Testes executados antes da entrega

- migrations 0001 → 0010 aplicadas em sequência em SQLite limpo;
- código válido e case-insensitive;
- código inválido, desativado e vencido;
- regra de não acumular descontos e regra permitindo acúmulo;
- cálculo de 5% em centavos;
- pagamento pendente sem comissão;
- pagamento aprovado liberando uma única comissão;
- processamento repetido do mesmo pagamento sem duplicidade;
- aprovado não regride para pendente por webhook fora de ordem;
- reembolso cancela comissão e não é reaberto por webhook antigo de aprovação;
- limite por e-mail/telefone;
- comissão de produto em bps sobre valor pago;
- isolamento do portal de parceiro;
- rota administrativa sem autenticação retorna 401;
- fluxo completo evento → Mercado Pago mockado → confirmação administrativa → comissão → marcar paga → cancelamento;
- parceiro com histórico é desativado, não excluído;
- sintaxe de todos os arquivos JavaScript validada.

A inspeção visual final em celular deve ser feita no navegador após o deploy, pois o ambiente de testes automatizados não reproduz o navegador real. Foram adicionadas regras responsivas específicas para a nova interface.

## Aplicação no D1 remoto

Antes da migration, é recomendado exportar um backup:

```bash
npx wrangler d1 export dogfit-db --remote --output=./backup-dogfit-before-indicacoes.sql
```

Aplicar somente a nova migration:

```bash
npx wrangler d1 execute dogfit-db --remote --file=./migrations/0010_petshop_referrals.sql
```

Confirmar as tabelas:

```bash
npx wrangler d1 execute dogfit-db --remote --command "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('partner_referral_settings','partner_referrals') ORDER BY name;"
```

## Teste local

Se o D1 local já contém as migrations anteriores:

```bash
npx wrangler d1 execute dogfit-db --local --file=./migrations/0010_petshop_referrals.sql
```

Depois:

```bash
npx wrangler dev
```

Abra a URL local e teste `/pre-inscricao?ref=CODIGO`.

## Deploy

Somente quando autorizado:

```bash
npx wrangler deploy
```
