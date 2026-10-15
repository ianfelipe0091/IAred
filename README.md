# KIRA — IA para Cibersegurança

Assistente de IA no estilo Claude, especialista em segurança da informação, rodando na Cloudflare (Pages + Pages Functions + Workers AI).

**Produção:** https://kira-cb0.pages.dev

## Como funciona

O administrador escolhe a IA que todos os usuários vão usar no **painel administrativo** (`/admin`): cola a **URL da API** e o **token**, e o KIRA reconhece o provedor sozinho.

- **Anthropic (Claude):** `https://api.anthropic.com`. O app usa raciocínio adaptativo, esforço e fallback automático quando o modelo escolhido aceita.
- **Compatíveis com a OpenAI:** OpenAI, OpenRouter, Groq, Google Gemini, DeepSeek, Mistral, xAI, Perplexity, Together, Fireworks, Cerebras, Maritaca e qualquer outra API no formato Chat Completions.
- **Sem configuração:** usa o modelo gratuito (NVIDIA Nemotron 3 120B no Workers AI).

Os usuários não colam chave nenhuma: o token fica só no servidor (KV da Cloudflare) e nunca é enviado ao navegador.

**Cadastro e login dos usuários** (Supabase Auth): quando o admin ativa no painel, só quem tem conta usa o KIRA. A tela inicial passa a ter "Entrar" e "Criar conta" (email e senha), o servidor confere o token de cada mensagem na Supabase e o histórico de conversas fica separado por conta no navegador.

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
  api/model.js        GET  /api/model → modelo ativo (para o app)
  api/auth/config.js  GET  /api/auth/config → URL e chave pública da Supabase (para o login)
  api/title.js        POST /api/title → título automático
  api/admin/*         login, reconhecimento do provedor e configuração da IA
  _lib/prompt.js      prompt de sistema do especialista
  _lib/providers.js   integração com Anthropic, APIs compatíveis com OpenAI e Workers AI
  _lib/detect.js      reconhece o provedor pela URL/token e testa a conexão
  _lib/admin-auth.js  usuário/senha do admin, sessão assinada e limite de tentativas
  _lib/auth.js        login dos usuários: configuração da Supabase e validação do token
src/                  frontend (JS puro, empacotado com esbuild); admin.* é o painel
public/               estáticos (ícones, manifest, _headers)
build.mjs             gera dist/
wrangler.toml         configuração do Pages (bindings AI e CONFIG, SUPABASE_URL)
```

## Desenvolvimento e deploy

```bash
npm install
npm run build

export CLOUDFLARE_API_TOKEN=...      # token com permissão de Pages e Workers AI
export CLOUDFLARE_ACCOUNT_ID=...
npm run deploy                       # build + wrangler pages deploy --branch main
```

## Painel administrativo

Configuração única (com o Wrangler logado na conta da Cloudflare):

```bash
# 1. Armazenamento da configuração (já grava o binding CONFIG no wrangler.toml)
npx wrangler kv namespace create kira-config --binding CONFIG --update-config

# 2. Usuário e senha do admin (senha com no mínimo 10 caracteres)
npx wrangler pages secret put ADMIN_USER --project-name kira
npx wrangler pages secret put ADMIN_PASSWORD --project-name kira

# 3. Publicar
npm run deploy
```

Depois, abra `https://kira-cb0.pages.dev/admin`, entre com o usuário e a senha e preencha:

1. **URL da API** (ex.: `https://api.openai.com/v1`). Em branco, o KIRA tenta reconhecer pelo token.
2. **Token da IA**.
3. **Reconhecer provedor** para listar os modelos, escolher o **modelo** e, se quiser, o nome que os usuários veem.
4. **Testar e salvar**: o painel faz uma pergunta curta à IA e só salva se ela responder.

A mudança chega a todos os usuários em cerca de 1 minuto (tempo de propagação do KV).

### Login dos usuários

Na seção **Cadastro e login dos usuários** do painel, informe a URL do projeto (`https://<projeto>.supabase.co`) e a **chave pública** (publishable `sb_publishable_…` ou anon), que fica na Supabase em Project Settings → API Keys. O painel testa a chave na Supabase e recusa a chave secreta (`sb_secret_…`/`service_role`). **Desligar login** volta a deixar o app aberto.

Na Supabase (Authentication → Sign In / Providers), a confirmação de email vem ligada. Sem um SMTP próprio, o email padrão da Supabase só chega a membros da equipe do projeto: para receber usuários de fora, configure um SMTP (Authentication → Emails → SMTP Settings) ou desligue "Confirm email". Para voltar ao modelo gratuito, use **Remover configuração**.

Segurança do painel: sessão em cookie `HttpOnly`/`SameSite=Strict` assinado com HMAC (8 h), bloqueio por 15 min após 10 tentativas erradas, as rotas de escrita só aceitam requisições do próprio site e o token nunca é devolvido ao navegador (o painel mostra só os 4 últimos caracteres). Trocar o `ADMIN_USER` ou a `ADMIN_PASSWORD` encerra todas as sessões abertas. O usuário não diferencia maiúsculas de minúsculas; a senha, sim.

Enquanto o painel não tiver uma IA configurada, o secret opcional `ANTHROPIC_API_KEY` continua valendo como chave padrão do Claude.

## Uso responsável

A KIRA foi feita para defesa, desenvolvimento seguro, educação, CTFs e testes autorizados. O prompt de sistema orienta o modelo a recusar ataques sem autorização, criação de malware, roubo de credenciais e afins.
