# DOGFIT — exclusão definitiva (26/08/2026)

Nesta versão, a ação **Excluir** apaga o registro do banco, em vez de apenas escondê-lo.

## Área do cliente
- Nova seção **Contas de clientes** em `/inscricoes-admin`.
- Excluir uma conta remove do D1:
  - `customer_accounts`;
  - `customer_sessions`;
  - `customer_email_verifications`;
  - inscrições de `event_registrations` ligadas ao ID ou e-mail da conta.
- O vínculo `club_members.customer_id` é removido, mas o cadastro independente de associado do Clube não é apagado automaticamente.
- O e-mail fica livre para novo cadastro.
- Contas ainda não verificadas não bloqueiam mais um novo cadastro: o sistema reutiliza a conta pendente, atualiza os dados/senha e envia um novo código.

## Clube
- Excluir associado remove também cupons individuais e utilizações vinculadas.
- Excluir parceiro remove sessões, benefícios, cupons e utilizações ligadas ao parceiro.
- Excluir benefício/cupom remove também os históricos de utilização que dependem desse item.

## R2 / imagens
- Excluir produto remove a imagem correspondente do R2 quando ela foi enviada pelo painel (`/media/...`).
- Trocar a imagem de produto, evento, Home, Clube, Performance ou Passeador remove a imagem anterior do R2.
- A galeria já removia a imagem do R2 e continua fazendo isso.

## Deploy
Não há migration nova nesta correção.

Depois de substituir os arquivos, execute:

```bash
npx wrangler deploy
```

Depois faça `Ctrl + F5` no navegador.
