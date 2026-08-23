# Gestão do Clube DOGFIT CANICROSS

Este módulo funciona integrado ao site atual, ao Worker `dogfit-canicross` e ao banco D1 `dogfit-db`.

## O que foi adicionado

- `/club-admin`: painel privado da DOGFIT para associados, parceiros, benefícios, cupons e histórico.
- `/parceiro`: portal limitado das empresas parceiras.
- `/clube/SEU-TOKEN`: carteirinha digital verificável do associado.
- Autenticação individual dos parceiros com e-mail e senha.
- Registro permanente de cada utilização de benefício ou cupom.
- Renovação automática de limites mensais e anuais, sem precisar apagar registros.

## Publicação

1. No terminal do VS Code, dentro do projeto, aplique a nova migração no D1:

   ```bash
   npx wrangler d1 execute dogfit-db --remote --file=./migrations/0007_club_management.sql
   ```

2. Confirme a pergunta do Wrangler digitando `y`, se ela aparecer. Esse comando executa somente a nova estrutura do Clube e não repete as migrações antigas.

3. Envie os arquivos ao GitHub:

   ```bash
   git add .
   git commit -m "Adiciona gestão do Clube, cupons e parceiros"
   git push
   ```

4. Aguarde o deploy automático da Cloudflare finalizar.

5. Abra `https://dogfitcanicross.com.br/club-admin` com o mesmo usuário e senha do painel atual.

## Primeiro uso

1. Cadastre a Dogmania em **Parceiros**, informando um e-mail e uma senha exclusiva.
2. Em **Benefícios**, crie as vantagens permanentes da Dogmania, se houver.
3. Em **Cupons**, crie campanhas como `DOGMANIA5`, defina percentual, validade e limite de uso.
4. Cadastre os associados e abra a carteirinha pelo botão **Carteirinha**.
5. Entregue à Dogmania apenas o endereço `/parceiro`, o e-mail e a senha dela.

O parceiro visualiza somente o primeiro nome e a inicial do sobrenome, código, nome do cão, situação da assinatura e benefícios permitidos para sua empresa. Telefone, e-mail, mensalidade, observações e dados administrativos não são exibidos.
