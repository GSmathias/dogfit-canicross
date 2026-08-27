# Pré-inscrição com criação de conta integrada

Fluxo atualizado:

1. Cliente clica em **Fazer pré-inscrição**.
2. Preenche os dados apenas uma vez.
3. Se não estiver logado, o mesmo formulário cria/reinicia a conta DOGFIT.
4. O código de 6 dígitos é digitado dentro do próprio modal da pré-inscrição.
5. Ao confirmar o e-mail, a sessão é criada automaticamente.
6. A pré-inscrição é concluída e o cliente segue para o Mercado Pago.
7. Se já possuir uma conta confirmada, a senha informada no mesmo formulário faz o login sem redirecionar para a Área do Cliente.
8. Se já estiver logado, a senha nem é solicitada e os dados da conta são preenchidos automaticamente.

## Segurança

A API `/api/events/register` agora exige uma sessão de cliente com e-mail confirmado. Portanto, não é possível contornar a confirmação de e-mail chamando a API diretamente.

Não há migration nova.
