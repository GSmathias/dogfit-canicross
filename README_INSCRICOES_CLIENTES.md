# Pré-inscrições e Área do Cliente DOGFIT

## O que foi adicionado

- Navegação por abas no celular: Eventos, Clube, Produtos, Performance, Passeador e Galeria.
- Formulário de pré-inscrição no próprio site.
- Confirmação com chave PIX `047.652.591-88` e código único da pré-inscrição.
- `/cliente`: conta do cliente, dados salvos, histórico, carteirinha e rede credenciada.
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
- `https://dogfitcanicross.com.br/inscricoes-admin`
- `https://dogfitcanicross.com.br/club-admin` (complete os dados públicos dos parceiros)

O vínculo com o Clube é automático quando o e-mail da conta do cliente é igual ao e-mail do associado.
