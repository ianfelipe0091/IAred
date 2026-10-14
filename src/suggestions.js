// Sugestões da tela inicial, por especialista.
const REVIEW_SNIPPET = [
  "Revise este endpoint Flask e aponte as vulnerabilidades com a correção:",
  "",
  "```python",
  '@app.route("/user")',
  "def user():",
  '    uid = request.args.get("id")',
  '    cur.execute(f"SELECT * FROM users WHERE id = {uid}")',
  "    return jsonify(cur.fetchall())",
  "```",
].join("\n");

const S = {
  owasp: { icon: "bug", title: "OWASP Top 10 na prática", prompt: "Explique o OWASP Top 10 (2021) com um exemplo de código vulnerável e a correção para cada item." },
  hardening: { icon: "lock", title: "Hardening de Ubuntu", prompt: "Crie um checklist de hardening para um servidor Ubuntu 24.04 exposto à internet, com os comandos e o motivo de cada controle." },
  ransomware: { icon: "siren", title: "Playbook de ransomware", prompt: "Monte um playbook de resposta a incidente de ransomware para uma empresa de 100 funcionários, com as primeiras 24 horas detalhadas." },
  sigma: { icon: "radar", title: "Regra Sigma", prompt: "Escreva uma regra Sigma para detectar criação suspeita de tarefas agendadas no Windows, com explicação dos campos e possíveis falsos positivos." },
  review: { icon: "code", title: "Code review de segurança", prompt: REVIEW_SNIPPET },
  kerberoast: { icon: "shield", title: "Detectar Kerberoasting", prompt: "Explique o que é Kerberoasting, como detectar no Active Directory (eventos e consultas KQL) e como mitigar." },
  mfa: { icon: "key", title: "MFA resistente a phishing", prompt: "Como implantar MFA resistente a phishing (FIDO2/passkeys) em uma empresa que usa Microsoft 365? Quero um plano em fases." },
  lgpd: { icon: "scale", title: "LGPD + ISO 27001", prompt: "Quais controles da ISO 27001 e requisitos da LGPD uma startup de 30 pessoas deve priorizar nos primeiros 6 meses?" },
  study: { icon: "cap", title: "Plano de estudos", prompt: "Crie um plano de estudos de 3 meses para começar em cibersegurança, com laboratórios práticos gratuitos e metas semanais." },
  headers: { icon: "terminal", title: "Cabeçalhos HTTP seguros", prompt: "Configure cabeçalhos de segurança HTTP (CSP, HSTS, X-Frame-Options, etc.) em um Nginx e explique cada um." },
  kql: { icon: "search", title: "Caçar logins anômalos", prompt: "Escreva consultas KQL para o Microsoft Sentinel que identifiquem logins anômalos: viagem impossível, muitos países e falhas seguidas de sucesso." },
  phishing: { icon: "warn", title: "Analisar e-mail suspeito", prompt: "Quais passos devo seguir para analisar com segurança um e-mail suspeito de phishing (cabeçalhos, links, anexos) e o que reportar?" },
  scope: { icon: "target", title: "Escopo de pentest", prompt: "Monte um modelo de escopo e regras de engajamento para um pentest web autorizado, incluindo itens fora de escopo e contatos de emergência." },
  report: { icon: "file", title: "Relatório de pentest", prompt: "Crie um modelo de relatório de pentest com sumário executivo, metodologia, achados com CVSS e plano de remediação." },
  wstg: { icon: "bug", title: "Checklist OWASP WSTG", prompt: "Resuma a metodologia OWASP WSTG em um checklist prático para testar autenticação e gerenciamento de sessão em um app autorizado." },
  aws: { icon: "cloud", title: "IAM na AWS", prompt: "Revise boas práticas de IAM na AWS: privilégio mínimo, SCPs, chaves de acesso e detecção de configurações perigosas." },
  k8s: { icon: "network", title: "Kubernetes seguro", prompt: "Quais são os controles essenciais para proteger um cluster Kubernetes em produção? Inclua exemplos de PodSecurity e NetworkPolicy." },
  terraform: { icon: "code", title: "Terraform seguro", prompt: "Como evitar segredos e más configurações em Terraform? Sugira ferramentas de análise e um pipeline de CI." },
  policy: { icon: "file", title: "Política de senhas", prompt: "Escreva uma política de senhas e autenticação alinhada ao NIST SP 800-63B, pronta para aprovação da diretoria." },
  risk: { icon: "gauge", title: "Matriz de risco", prompt: "Monte uma matriz de riscos de segurança da informação para um e-commerce, com probabilidade, impacto e tratamento." },
  vendor: { icon: "scale", title: "Avaliar fornecedor", prompt: "Crie um questionário de avaliação de segurança de fornecedores SaaS com as perguntas mais importantes." },
  ctf: { icon: "target", title: "Começar em CTF", prompt: "Nunca joguei CTF. Explique as categorias (web, crypto, forense, pwn, reversing) e por onde começar com dicas progressivas." },
  crypto: { icon: "lock", title: "Criptografia sem mistério", prompt: "Explique a diferença entre hash, criptografia simétrica, assimétrica e assinatura digital, com exemplos do dia a dia." },
  timeline: { icon: "siren", title: "Linha do tempo forense", prompt: "Como construir uma linha do tempo forense de um host Windows comprometido? Quais artefatos coletar e em que ordem?" },
  triage: { icon: "radar", title: "Triagem de alerta", prompt: "Recebi um alerta de PowerShell codificado em um endpoint. Qual o passo a passo de triagem para confirmar ou descartar o incidente?" },
};

export const SUGGESTIONS = {
  geral: [S.owasp, S.hardening, S.ransomware, S.review],
  blueteam: [S.sigma, S.kql, S.triage, S.phishing],
  appsec: [S.review, S.owasp, S.headers, S.mfa],
  dfir: [S.ransomware, S.timeline, S.triage, S.phishing],
  pentest: [S.scope, S.wstg, S.report, S.kerberoast],
  cloud: [S.aws, S.k8s, S.terraform, S.hardening],
  grc: [S.lgpd, S.policy, S.risk, S.vendor],
  mentor: [S.study, S.ctf, S.crypto, S.kerberoast],
};

export const AGENT_META = {
  geral: { icon: "shield", hint: "Generalista em segurança" },
  blueteam: { icon: "radar", hint: "Detecção, SIEM e logs" },
  appsec: { icon: "code", hint: "Código seguro e OWASP" },
  dfir: { icon: "siren", hint: "Incidentes e forense" },
  pentest: { icon: "target", hint: "Testes com escopo e contrato" },
  cloud: { icon: "cloud", hint: "Infra, cloud e hardening" },
  grc: { icon: "scale", hint: "LGPD, ISO 27001, NIST" },
  mentor: { icon: "cap", hint: "Aprender e treinar CTF" },
};
