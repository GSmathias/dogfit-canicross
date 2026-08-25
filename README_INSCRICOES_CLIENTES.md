# Pré-inscrições e Área do Cliente DOGFIT

## O que foi adicionado

- Navegação por abas no celular: Eventos, Clube, Produtos, Performance, Passeador e Galeria.
- Formulário de pré-inscrição no próprio site.
- Redirecionamento ao Checkout Pro do Mercado Pago com código único da pré-inscrição.
- `/cliente`: página exclusiva para cadastro e login.
- `/minha-conta`: dados salvos, histórico, carteirinha e rede credenciada após o login.
- `/inscricoes-admin`: painel privado para confirmar PIX, cancelar e exportar inscrições.
- Informações públicas dos parceiros (categoria, telefone, endereço, Instagram e descrição).

## Publicação

Dentro da pasta do projeto, execute primeiro a nova migração:

```bash
npx wrangler d1 execute dogfit-db --remote --file=./migrations/0008_event_registration_clients.sql
```

Depois publique no GitHub:

```bash
git add .
git commit -m "Adiciona pre-inscricoes e area do cliente"
git push
```

Após o deploy, confira:

- `https://dogfitcanicross.com.br/#eventos`
- `https://dogfitcanicross.com.br/cliente`
- `https://dogfitcanicross.com.br/minha-conta`
- `https://dogfitcanicross.com.br/inscricoes-admin`
- `https://dogfitcanicross.com.br/club-admin` (complete os dados públicos dos parceiros)

O vínculo com o Clube é automático quando o e-mail da conta do cliente é igual ao e-mail do associado.

## Pagamento pelo Mercado Pago

Depois de salvar a pré-inscrição, o Worker cria uma preferência do Checkout Pro com o valor do próximo evento cadastrado no painel. O cliente é enviado ao Mercado Pago e, quando o pagamento é aprovado, retorna automaticamente para o WhatsApp `5562994431333` com o código da inscrição.

O webhook também confirma o pagamento no painel `/inscricoes-admin`.

Obtenha o **Access Token de produção** em Mercado Pago > Suas integrações > Credenciais de produção. Não coloque o token no GitHub. Configure-o diretamente na Cloudflare:

```bash
npx wrangler secret put MERCADOPAGO_ACCESS_TOKEN
```

Cole o token quando o terminal solicitar e faça um novo deploy:

```bash
npx wrangler deploy
```

Antes de testar, confirme no painel administrativo que o valor do próximo evento está preenchido, por exemplo `35,00`.
