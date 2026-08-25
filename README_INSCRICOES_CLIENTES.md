# Pré-inscrições e Área do Cliente DOGFIT

## O que foi adicionado

- Navegação por abas no celular: Eventos, Clube, Produtos, Performance, Passeador e Galeria.
- Formulário de pré-inscrição no próprio site.
- Confirmação com chave PIX `047.652.591-88` e código único da pré-inscrição.
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

## Notificação automática pelo WhatsApp

O Worker está preparado para enviar uma mensagem automática usando a API oficial do WhatsApp da Meta. Crie e aprove, no WhatsApp Manager, um modelo de utilidade com:

- Nome: `nova_pre_inscricao_dogfit`
- Idioma: Português (Brasil)
- Corpo:

```text
Nova pré-inscrição DOGFIT CANICROSS.
Código: {{1}}
Participante: {{2}}
Evento: {{3}}
Contato: {{4}}
Cão: {{5}}
Quantidade de cães: {{6}}
Sociabilidade: {{7}}
```

Depois configure os dados da Cloud API sem colocá-los no GitHub:

```bash
npx wrangler secret put WHATSAPP_PHONE_NUMBER_ID
npx wrangler secret put WHATSAPP_ACCESS_TOKEN
npx wrangler secret put WHATSAPP_ADMIN_NUMBER
```

Em `WHATSAPP_ADMIN_NUMBER`, informe `5562994431333`. Depois faça um novo deploy com `npx wrangler deploy`.
