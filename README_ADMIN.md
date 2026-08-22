# Módulo Admin — DOGFIT CANICROSS

Este pacote adiciona uma área administrativa ao site em HTML/CSS/JavaScript.

## O que já funciona

### Localmente com Live Server
Abra `admin.html`.

No modo local, o painel usa `localStorage`, então você consegue:
- cadastrar produtos;
- editar produtos;
- mudar preços;
- apagar produtos;
- selecionar fotos;
- editar o próximo evento;
- adicionar/remover fotos da galeria;
- alterar textos principais da Home.

Para a Home ler esses dados localmente, copie `js/site-data.js` para seu projeto e adicione:

```html
<script src="js/site-data.js"></script>
<script src="js/script.js"></script>
```

Use `site-data.js` antes do seu `script.js`.

## Publicação na Cloudflare

Na versão publicada:
- D1 guarda produtos e textos;
- R2 guarda imagens;
- Pages Functions funcionam como API;
- Cloudflare Access deve proteger `/admin*` e `/api/admin/*`.

### 1. Instalar Wrangler

```powershell
npm install -D wrangler
npx wrangler login
```

### 2. Criar o banco D1

```powershell
npx wrangler d1 create dogfit-db
```

Copie o `database_id` retornado e coloque em `wrangler.jsonc`.

Renomeie:

`wrangler.jsonc.example` → `wrangler.jsonc`

### 3. Criar o bucket R2

```powershell
npx wrangler r2 bucket create dogfit-media
```

### 4. Criar as tabelas

```powershell
npx wrangler d1 execute dogfit-db --remote --file="./migrations/0001_init.sql"
```

### 5. Testar Pages Functions localmente

Em vez de Live Server, para testar a API Cloudflare local:

```powershell
npx wrangler pages dev .
```

### 6. Segurança

NÃO coloque senha dentro de `admin.js`.

No Cloudflare Zero Trust / Access, proteja:
- `dogfitcanicross.com.br/admin*`
- `dogfitcanicross.com.br/api/admin/*`

Permita somente o e-mail do administrador.

## Estrutura dos arquivos

```text
admin.html
css/
  admin.css
js/
  admin.js
  site-data.js
functions/
  _lib/http.js
  api/products.js
  api/content.js
  api/admin/content.js
  api/admin/upload.js
  api/admin/products/index.js
  api/admin/products/[id].js
  api/admin/gallery/index.js
  api/admin/gallery/[id].js
  media/[key].js
migrations/
  0001_init.sql
wrangler.jsonc.example
```

## Observação importante

No modo Live Server, imagens ficam salvas como Data URL no `localStorage`. Isso é apenas para prototipação. Na versão publicada, os arquivos vão para o R2.
