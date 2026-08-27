# Atualização: Minha Conta e exclusões administrativas

Esta atualização não exige nova migração do banco D1.

## O que mudou

- `/cliente` agora exibe somente entrada e criação de conta.
- Após entrar ou criar conta, o cliente é enviado para `/minha-conta`.
- `/minha-conta` é uma página separada com dados pessoais, inscrições, situação no Clube, carteirinha e credenciados.
- Cliente sem sessão que tentar abrir `/minha-conta` volta automaticamente para `/cliente`.
- Foram adicionadas exclusões com confirmação para associados, parceiros, benefícios, cupons, utilizações e pré-inscrições.
- Produtos e fotos da galeria já possuíam exclusão e foram mantidos.

## Publicação

Extraia o pacote na raiz do projeto `dogfit-canicross`, aceitando substituir os arquivos. Depois execute:

```bash
git add .
git commit -m "Separa conta do cliente e adiciona exclusoes administrativas"
git push
npx wrangler deploy
```

## Testes rápidos

1. Abra `/cliente`, entre e confirme o redirecionamento para `/minha-conta`.
2. Saia da conta e tente abrir `/minha-conta`; o site deve voltar para `/cliente`.
3. Em `/club-admin`, teste excluir um registro criado apenas para teste.
4. Em `/inscricoes-admin`, abra uma inscrição de teste e use `EXCLUIR INSCRIÇÃO`.

As exclusões são permanentes e sempre exibem uma confirmação antes de prosseguir.
