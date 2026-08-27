# DOGFIT — confirmação de e-mail

A área do cliente agora só libera a conta depois que o endereço de e-mail é confirmado por um código de 6 dígitos.

## O que foi implementado

- Um e-mail só pode criar uma conta (`UNIQUE` no D1).
- Código de confirmação com 6 dígitos.
- Código armazenado apenas como hash no banco.
- Validade de 15 minutos.
- Máximo de 5 tentativas por código.
- Reenvio com intervalo mínimo de 60 segundos.
- Login bloqueado enquanto o e-mail não estiver confirmado.
- Sessões antigas de contas não confirmadas deixam de dar acesso.
- Nome exige nome + sobrenome; telefone exige DDD e quantidade plausível de dígitos; datas futuras/inválidas são rejeitadas.
- Pré-inscrição duplicada para o mesmo evento/e-mail é bloqueada.
- Uma pré-inscrição feita sem login não é mais vinculada automaticamente só porque alguém digitou o e-mail de uma conta existente.

## Serviço de envio

O Worker usa a API HTTP do Resend, sem instalar dependências npm.

1. Crie/acesse uma conta no Resend.
2. Adicione o domínio `dogfitcanicross.com.br`.
3. Adicione no DNS da Cloudflare os registros SPF/DKIM mostrados pelo Resend e aguarde a verificação do domínio.
4. Crie uma API Key no Resend.
5. No terminal, dentro do projeto, salve a chave como Secret do Worker:

```bash
npx wrangler secret put RESEND_API_KEY
```

Cole somente a API Key quando o Wrangler pedir o valor.

O remetente já está configurado no `wrangler.jsonc` como:

```text
DOGFIT CANICROSS <contato@dogfitcanicross.com.br>
```

## Banco D1

Antes do deploy do código, rode a migration 0009 no banco remoto:

```bash
npx wrangler d1 execute dogfit-db --remote --file=./migrations/0009_customer_email_verification.sql
```

Depois publique:

```bash
npx wrangler deploy
```

## Atenção a contas já existentes

A migration não marca contas antigas como confirmadas. Assim, uma conta de cliente criada antes desta atualização precisará confirmar o e-mail no próximo login. Isso é intencional para que, a partir desta versão, a DOGFIT saiba que a pessoa realmente tem acesso ao endereço cadastrado.
