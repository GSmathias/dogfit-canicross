# Correção — registro de uso de benefícios

Atualização de 26/08/2026.

## O que foi corrigido

- O painel administrativo agora carrega os benefícios/cupons disponíveis especificamente para o associado selecionado.
- Benefícios vencidos, ainda não iniciados ou com limite já esgotado deixam de ser oferecidos para registro.
- O contador mensal/anual é consultado no banco antes da seleção.
- O limite de uso também é validado dentro do próprio `INSERT`, evitando registros simultâneos acima do limite.
- Benefícios do tipo item (ex.: camisa) e benefícios gratuitos podem ser registrados sem exigir valor de compra.
- O botão de confirmar é bloqueado durante o envio para evitar duplo clique e duplicidade.
- O portal do parceiro recebeu a mesma proteção contra envio duplicado.
- Mensagens de erro de associado inativo, vencido ou com pagamento pendente ficaram mais específicas.

## Banco de dados

Nenhuma migration nova é necessária para esta correção.
