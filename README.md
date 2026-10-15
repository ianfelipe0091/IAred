# KIRA — IA para Cibersegurança

Assistente de IA no estilo Claude, especialista em segurança da informação, rodando na Cloudflare (Pages + Pages Functions + Workers AI).

**Produção:** https://kira-cb0.pages.dev

## Como funciona

No **painel administrativo** (`/admin`) você conecta um ou mais **modelos de IA**. Cada modelo é uma conexão própria: URL da API + token + modelo, e o KIRA reconhece o provedor sozinho (Anthropic/Claude, OpenAI, OpenRouter, Google Gemini, DeepSeek, Mistral, Groq e qualquer API no formato da Anthropic ou da OpenAI). Você marca um como padrão; o usuário escolhe entre os modelos no app. Sem nenhum modelo configurado, o KIRA usa um modelo gratuito de reserva (Cloudflare Workers AI), sem mostrar esse nome.

Os usuários não colam chave nenhuma: os tokens ficam só no servidor (KV da Cloudflare) e nunca vão para o navegador.

**Instruções:** você escreve instruções que vão para o modelo em todas as conversas, podendo valer para todos os modelos ou só para alguns. A instrução do administrador tem prioridade sobre o estilo padrão da KIRA; as regras de uso responsável do prompt padrão continuam valendo e não podem ser desligadas por instrução. O painel mostra o texto exato enviado ao modelo.

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

### Modelos e instruções

Na página **Modelos** do painel, adicione um ou mais modelos (URL + token + modelo; há atalhos para OpenRouter, Anthropic, OpenAI, Gemini e Groq). O painel reconhece o provedor, lista os modelos, testa o escolhido e só então salva. Marque o padrão com **Tornar padrão** e remova com a lixeira.

Na página **Instruções**, escolha se valem para **todos os modelos** ou **modelos específicos**, escreva o texto (até 8.000 caracteres) e use **Ver o que é enviado ao modelo** para conferir o prompt completo. A instrução tem prioridade sobre o estilo padrão; o uso responsável prevalece sempre.

### Login dos usuários

Na seção **Cadastro e login dos usuários** do painel, informe a URL do projeto (`https://<projeto>.supabase.co`) e a **chave pública** (publishable `sb_publishable_…` ou anon), que fica na Supabase em Project Settings → API Keys. O painel testa a chave na Supabase e recusa a chave secreta (`sb_secret_…`/`service_role`). **Desligar login** volta a deixar o app aberto.

Na Supabase (Authentication → Sign In / Providers), a confirmação de email vem ligada. Sem um SMTP próprio, o email padrão da Supabase só chega a membros da equipe do projeto: para receber usuários de fora, configure um SMTP (Authentication → Emails → SMTP Settings) ou desligue "Confirm email". Para voltar ao modelo gratuito, use **Remover configuração**.

Segurança do painel: sessão em cookie `HttpOnly`/`SameSite=Strict` assinado com HMAC (8 h), bloqueio por 15 min após 10 tentativas erradas, as rotas de escrita só aceitam requisições do próprio site e o token nunca é devolvido ao navegador (o painel mostra só os 4 últimos caracteres). Trocar o `ADMIN_USER` ou a `ADMIN_PASSWORD` encerra todas as sessões abertas. O usuário não diferencia maiúsculas de minúsculas; a senha, sim.

Enquanto o painel não tiver uma IA configurada, o secret opcional `ANTHROPIC_API_KEY` continua valendo como chave padrão do Claude.

## Uso responsável

A KIRA foi feita para defesa, desenvolvimento seguro, educação, CTFs e testes autorizados. O prompt de sistema orienta o modelo a recusar ataques sem autorização, criação de malware, roubo de credenciais e afins.
