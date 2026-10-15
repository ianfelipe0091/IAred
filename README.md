# KIRA — IA para Cibersegurança

Assistente de IA no estilo Claude, especialista em segurança da informação, rodando na Cloudflare (Pages + Pages Functions + Workers AI).

**Produção:** https://kira-cb0.pages.dev

## Como funciona

No **painel administrativo** (`/admin`) você conecta um ou mais **modelos de IA**. Cada modelo é uma conexão própria: URL da API + token + modelo, e o KIRA reconhece o provedor sozinho (Anthropic/Claude, OpenAI, OpenRouter, Google Gemini, DeepSeek, Mistral, Groq e qualquer API no formato da Anthropic ou da OpenAI). Você marca um como padrão; o usuário escolhe entre os modelos no app. Sem nenhum modelo configurado, o KIRA usa um modelo gratuito de reserva (Cloudflare Workers AI), sem mostrar esse nome.

Os usuários não colam chave nenhuma: os tokens ficam só no servidor (KV da Cloudflare) e nunca vão para o navegador.

**Instruções:** você escreve instruções que vão para o modelo em todas as conversas: um texto para todos os modelos e, se quiser, um texto próprio para cada modelo (um não altera o outro). A instrução do administrador tem prioridade sobre o estilo padrão da KIRA; as regras de uso responsável do prompt padrão continuam valendo e não podem ser desligadas por instrução. O painel mostra o texto exato enviado ao modelo.

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

Na página **Modelos** do painel, adicione um ou mais modelos (URL + token + modelo; há atalhos para OpenRouter, Anthropic, OpenAI, Gemini e Groq). O painel reconhece o provedor, lista os modelos, testa o escolhido e só então salva. Marque o padrão com **Tornar padrão**, altere com o lápis e remova com a lixeira. Na edição, mudar só o nome salva direto; mudar URL, token ou modelo faz o painel testar de novo antes de salvar. Deixe o token em branco para manter o salvo (se trocar a URL, cole o token de novo). O modelo editado continua padrão e continua recebendo as instruções marcadas para ele.

Na página **Instruções**, escolha a aba **Todos os modelos** (vale para todos, inclusive os adicionados depois) ou a aba de um modelo (texto só dele, enviado junto com o de todos os modelos e com prioridade sobre ele em caso de conflito). Cada aba tem o seu texto; escreva (sem limite de caracteres; o painel mostra o tamanho estimado em tokens, porque instruções longas ocupam o contexto do modelo e encarecem cada mensagem) e use **Ver o que é enviado ao modelo** para conferir o prompt completo. A instrução tem prioridade sobre o estilo padrão; o uso responsável prevalece sempre.

### Login dos usuários

Na seção **Cadastro e login dos usuários** do painel, informe a URL do projeto (`https://<projeto>.supabase.co`) e a **chave pública** (publishable `sb_publishable_…` ou anon), que fica na Supabase em Project Settings → API Keys. O painel testa a chave na Supabase e recusa a chave secreta (`sb_secret_…`/`service_role`). **Desligar login** volta a deixar o app aberto.

A tela de login tem **Esqueci minha senha**: a Supabase manda um link que volta para o app em modo "Definir nova senha". Para os links de email (confirmar conta e recuperar senha) voltarem ao app, em Authentication → URL Configuration o **Site URL** precisa ser `https://kira-cb0.pages.dev`.

Na Supabase (Authentication → Sign In / Providers), a confirmação de email vem ligada. Sem um SMTP próprio, o email padrão da Supabase só chega a membros da equipe do projeto: para receber usuários de fora, configure um SMTP (Authentication → Emails → SMTP Settings) ou desligue "Confirm email". Para voltar ao modelo gratuito, use **Remover configuração**.

### Banco de dados (histórico na nuvem)

Com o login ativo, a página **Banco de dados** do painel mostra um SQL para rodar uma vez no SQL Editor da Supabase (há um botão que abre o editor do projeto e outro que copia o SQL). Depois clique em **Verificar**. Rodar o SQL de novo não apaga dados.

Com o banco ativo, funciona como nos assistentes grandes:

- **Conversas na conta:** cada usuário vê as próprias conversas em qualquer aparelho. As conversas que estavam só no navegador vão para a conta no primeiro acesso.
- **Contexto no servidor:** o navegador manda só a mensagem nova; o servidor remonta o histórico. Quando a conversa passa do que cabe no modelo, o começo vira um resumo (gerado pelo próprio modelo e guardado na conversa) e só as mensagens recentes vão inteiras.
- **Personalização:** em Configurações, cada usuário diz como quer ser chamado e o que a KIRA deve saber sobre ele. Isso vale para todas as conversas dele, com prioridade só sobre o estilo padrão (nunca sobre o uso responsável nem sobre as instruções do administrador).
- **Editar, gerar de novo e parar** ficam iguais no banco: parar guarda o que já veio, marcado como "Resposta interrompida".
- **Limites de uso:** na página **Limites de uso**, mensagens por usuário por hora e por dia (padrão 30/h e 150/dia; 0 = sem limite). Quem passa do limite vê a hora em que pode voltar.

Segurança: só o servidor do KIRA grava no banco. As políticas (Row Level Security) exigem o cabeçalho `x-kira-server` com a chave do servidor, e o banco guarda só o SHA-256 dela. O navegador consegue apenas ler os próprios dados, então ninguém forja respostas da IA no histórico (que voltam ao modelo como contexto) nem grava fora dos limites. Respostas importadas do navegador voltam ao modelo como texto citado do usuário, nunca como fala da IA. A chave fica no KV (`db-key`) ou no secret opcional `KIRA_DB_KEY`.

Sem login ou sem o banco, o histórico continua só no navegador, como antes.

Segurança do painel: sessão em cookie `HttpOnly`/`SameSite=Strict` assinado com HMAC (8 h), bloqueio por 15 min após 10 tentativas erradas, as rotas de escrita só aceitam requisições do próprio site e o token nunca é devolvido ao navegador (o painel mostra só os 4 últimos caracteres). Trocar o `ADMIN_USER` ou a `ADMIN_PASSWORD` encerra todas as sessões abertas. O usuário não diferencia maiúsculas de minúsculas; a senha, sim.

Enquanto o painel não tiver uma IA configurada, o secret opcional `ANTHROPIC_API_KEY` continua valendo como chave padrão do Claude.

## Uso responsável

A KIRA foi feita para defesa, desenvolvimento seguro, educação, CTFs e testes autorizados. O prompt de sistema orienta o modelo a recusar ataques sem autorização, criação de malware, roubo de credenciais e afins.
