# IAHack — IA para Cibersegurança

Assistente de IA no estilo Claude, especialista em segurança da informação, rodando na Cloudflare (Pages + Pages Functions + Workers AI).

**Produção:** https://iahack.pages.dev

## Como funciona

- **Sem chave:** usa o modelo gratuito (NVIDIA Nemotron 3 120B no Workers AI).
- **Com chave da Anthropic:** em **Configurações → Chave da API**, cole sua chave (`sk-ant-...`). O app valida a chave e passa a usar o **Claude Opus 5.5** com raciocínio adaptativo.

A chave fica salva apenas no navegador (localStorage) e é enviada à função `/api/chat` somente para gerar as respostas; ela não é registrada nem armazenada no servidor.

Também é possível definir uma chave padrão para todos os visitantes com o secret `ANTHROPIC_API_KEY` do projeto (a chave colada no navegador tem prioridade).

## Recursos

- Chat em streaming com Markdown, realce de sintaxe e botão de copiar código.
- Raciocínio do modelo visível em um bloco recolhível.
- Histórico local de conversas com títulos automáticos.
- Editar mensagem, gerar novamente e parar a resposta (Esc).
- Visual de produto de IA: orb animado como "presença" da IA, composer flutuante com anel em gradiente enquanto a resposta é gerada e sugestões iniciais.
- Barra lateral recolhível (Ctrl+B), nova conversa (Ctrl+K), botão de voltar ao fim da conversa.
- Tema claro/escuro automático (segue o sistema) e layout para celular.
- Cabeçalhos de segurança (CSP restritiva, HSTS, X-Frame-Options) e saída sanitizada com DOMPurify.

## Estrutura

```
functions/
  api/chat.js         POST /api/chat  → streaming SSE (Claude ou modelo gratuito)
  api/key.js          GET/POST /api/key → modelo ativo / valida a chave colada
  api/title.js        POST /api/title → título automático
  _lib/prompt.js      prompt de sistema do especialista
  _lib/providers.js   integração com Anthropic e Workers AI
src/                  frontend (JS puro, empacotado com esbuild)
public/               estáticos (ícones, manifest, _headers)
build.mjs             gera dist/
wrangler.toml         configuração do Pages (binding AI)
```

## Desenvolvimento e deploy

```bash
npm install
npm run build

export CLOUDFLARE_API_TOKEN=...      # token com permissão de Pages e Workers AI
export CLOUDFLARE_ACCOUNT_ID=...
npm run deploy                       # build + wrangler pages deploy --branch main
```

Chave padrão opcional para todos os visitantes:

```bash
npx wrangler pages secret put ANTHROPIC_API_KEY --project-name iahack
```

## Uso responsável

O IAHack foi feito para defesa, desenvolvimento seguro, educação, CTFs e testes autorizados. O prompt de sistema orienta o modelo a recusar ataques sem autorização, criação de malware, roubo de credenciais e afins.
