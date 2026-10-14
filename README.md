# IAHack — IA para Cibersegurança

Assistente de IA no estilo Claude, focado em segurança da informação, com paleta verde, rodando 100% na Cloudflare (Pages + Pages Functions + Workers AI).

**Produção:** https://iahack.pages.dev

## Recursos

- **Chat em streaming** com renderização Markdown, realce de sintaxe e botões de copiar/abrir código.
- **Raciocínio visível**: modelos com etapa de raciocínio mostram o "pensamento" em um bloco recolhível, com tempo gasto.
- **8 especialistas**: IAHack (geral), Blue Team / SOC, AppSec & Code Review, Resposta a Incidentes, Pentest Autorizado, Cloud & Hardening, GRC & Compliance e Mentor & CTF. Cada um tem sugestões próprias na tela inicial.
- **Vários modelos**: Workers AI (gpt-oss-120b, Nemotron 3 120B, Qwen 3.8, Llama 3.3 70B, Gemma 4, Qwen Coder) e, opcionalmente, Claude Opus 5.5 / Sonnet 5.5 / Haiku 5.5.
- **Controle de raciocínio** (Rápido / Equilibrado / Profundo) nos modelos que suportam.
- **Anexos de texto** (logs, código, configs, CSV): clique no clipe, arraste e solte, ou cole textos longos.
- **Painel lateral de código** com numeração de linhas, cópia e download.
- **Histórico local** com busca, agrupamento por data, fixar, renomear, apagar e títulos automáticos.
- **Editar e reenviar** mensagens, **gerar novamente** respostas, **parar** geração (Esc).
- **Kit de ferramentas offline** (roda só no navegador): hash (MD5/SHA) e identificação de hash, codificador (Base64, URL, Hex, HTML, ROT13, binário), inspetor de JWT com análise de segurança, gerador/analisador de senhas, calculadora de sub-redes IPv4, calculadora CVSS 3.1 e conversor de timestamps.
- **Temas escuro e claro**, layout responsivo para celular e instalável como app (PWA).
- **Cabeçalhos de segurança** (CSP restritiva, HSTS, X-Frame-Options etc.) e saída do modelo sanitizada com DOMPurify.

## Estrutura

```
functions/            Pages Functions (backend)
  api/chat.js         POST /api/chat  → streaming SSE
  api/models.js       GET  /api/models → modelos e especialistas disponíveis
  api/title.js        POST /api/title → título automático da conversa
  _lib/catalog.js     catálogo de modelos
  _lib/prompts.js     prompts de sistema e especialistas
  _lib/providers.js   Workers AI e Anthropic (Claude)
src/                  frontend (JS puro, empacotado com esbuild)
public/               arquivos estáticos (ícones, manifest, _headers)
build.mjs             gera dist/
wrangler.toml         configuração do Pages (binding AI)
```

## Desenvolvimento

```bash
npm install
npm run build          # gera dist/
npm run dev            # wrangler pages dev (o binding AI usa a conta remota)
```

## Deploy

```bash
export CLOUDFLARE_API_TOKEN=...      # token com permissão de Pages e Workers AI
export CLOUDFLARE_ACCOUNT_ID=...
npm run deploy                       # build + wrangler pages deploy --branch main
```

## Configuração opcional

Defina no painel da Cloudflare (Pages → iahack → Settings → Variables and Secrets) ou pela CLI:

| Variável | Tipo | Efeito |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | secret | Habilita Claude Opus 5.5, Sonnet 5.5 e Haiku 5.5 |
| `ACCESS_CODE` | secret | Exige um código de acesso para usar a API (protege sua cota) |
| `CF_PAID_PLAN` | texto | `true` libera DeepSeek V4 Pro, Kimi K2.6 e GLM 5.3 (plano Workers Paid) |
| `DEFAULT_MODEL` | texto | Modelo padrão (ex.: `sentinel`, `claude-opus`) |

```bash
npx wrangler pages secret put ANTHROPIC_API_KEY --project-name iahack
npx wrangler pages secret put ACCESS_CODE --project-name iahack
```

Depois de alterar variáveis, faça um novo deploy para que elas entrem em vigor.

## Uso responsável

O IAHack foi feito para defesa, desenvolvimento seguro, educação, CTFs e testes autorizados. O prompt de sistema orienta o modelo a recusar ataques a sistemas sem autorização, criação de malware, roubo de credenciais e afins.
