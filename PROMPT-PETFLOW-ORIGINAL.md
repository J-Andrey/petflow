# Prompt mestre — modernização profissional do PetFlow original

Atue como arquiteto de software, desenvolvedor full stack sênior, especialista em PostgreSQL, segurança, pagamentos, LGPD, logística e sistemas para pet shops. Trabalhe diretamente no PetFlow original sem remover módulos existentes. Este produto será vendido e usado por uma empresa real; não o trate como demonstração, projeto acadêmico ou hobby.

O PetFlow original já possui loja de produtos, catálogo, categorias, sacola, clientes, pets, serviços, agendamentos, funcionários, fornecedores, compras, estoque, vendas, financeiro, consultas, prontuários, vacinas, histórico de vacinas, newsletter, e-mails e checkout PagBank. Preserve todos esses módulos e suas relações.

Modernize o sistema até atingir o mesmo nível profissional do PetFlow v2, adaptando as melhorias ao escopo mais amplo do original. Não copie arquivos às cegas e não aplique a migração `105_remover_funcionarios.sql`, pois funcionários, agenda e atendimento fazem parte do produto original.

## Resultado obrigatório

Entregue um sistema pronto para operação comercial, com:

- Página pública responsiva e acessível.
- Catálogo e detalhes de produtos.
- Serviços e agendamentos.
- Cadastro de clientes e pets.
- Sacola lateral e página completa da sacola.
- Cupons.
- Frete para visitante e cliente autenticado.
- Checkout PagBank seguro.
- Reserva de estoque.
- Cancelamento e reembolso.
- Pedidos e notificações.
- GPS de entrega.
- Painel administrativo completo.
- Gestão de consultas, prontuários e vacinas.
- Auditoria administrativa.
- Atendimento ao consumidor.
- LGPD operacional.
- Backup, restauração, health check, readiness e verificação de lançamento.
- Testes automatizados relevantes.

Não finalize enquanto existirem botões sem ação, dados fictícios, valores confiados ao navegador, operações sem transação, credenciais expostas, migrações pendentes, erros silenciosos, TODOs em fluxos comerciais ou testes relevantes falhando.

## 1. Arquitetura e preservação do sistema

Mantenha Node.js 22+, Express 5, PostgreSQL, JavaScript modular, HTML e CSS existentes. Organize regras entre controllers, services, models, routes, middlewares, configurações, migrações e testes.

Preserve e teste:

- Clientes e usuários administrativos.
- Pets vinculados ao tutor correto.
- Serviços com duração e preço.
- Funcionários e suas permissões operacionais.
- Agendamentos vinculados a cliente, pet, serviço e funcionário.
- Consultas e prontuários.
- Vacinas e histórico de aplicação.
- Lembretes de agendamento e aniversário.
- Produtos, categorias, fornecedores, compras, estoque, vendas e financeiro.

Todas as consultas devem respeitar `empresa_id`. Um usuário de uma empresa não pode ler ou alterar dados de outra.

## 2. Diagnóstico inicial obrigatório

Antes de implementar:

1. Mapear rotas, controllers, services, models e tabelas.
2. Executar auditoria de dependências.
3. Identificar consultas sem `empresa_id`.
4. Identificar alterações de estoque fora de transação.
5. Identificar aprovação manual indevida de pagamento.
6. Verificar concorrência no checkout e no estoque.
7. Verificar ausência de cancelamento, reembolso e devolução de estoque.
8. Verificar autenticação, revogação de sessões e controle de perfil.
9. Verificar tratamento de dados pessoais e clínicos.
10. Criar testes antes de alterar fluxos críticos.

## 3. Cadastro, autenticação e sessões

Implemente cadastro com nome, e-mail, CPF válido, telefone ou WhatsApp, senha, endereço e aceite explícito da Política de Privacidade e dos Termos. Normalize dados e impeça duplicidade de e-mail, CPF, telefone e WhatsApp.

Use bcrypt. Exija confirmação de e-mail antes do login. Implemente reenvio de confirmação com rate limit, recuperação de senha com token aleatório e expirável, resposta genérica para e-mails inexistentes e revogação das sessões anteriores após troca de senha.

Separe tokens de cliente e administração. Inclua tipo do usuário, identificador, empresa e versão da sessão no JWT. Em cada requisição, consulte a conta ativa e compare `sessao_versao`. Logout, redefinição de senha, desativação e exclusão devem revogar tokens anteriores.

Perfis administrativos: `ADMIN` e `GERENTE`. Não permita desativar ou rebaixar a própria conta nem remover o último administrador ativo.

## 4. Pets, agenda e prontuário

O cliente só pode acessar os próprios pets. Valide nome, espécie, raça, sexo, nascimento, peso, observações e foto quando disponíveis.

Agendamentos devem validar cliente, pet, serviço, funcionário, data e horário. Impeça conflito de horário para o mesmo funcionário e, quando aplicável, para o mesmo pet. Defina transições de status e registre cancelamento, responsável e motivo.

Consultas, prontuários, vacinas e históricos devem ficar protegidos por autenticação administrativa e escopo de empresa. Registre autoria e data das alterações. Não exponha informações internas na página pública. Inclua esses dados na política de retenção e na exportação LGPD quando estiverem vinculados ao titular.

Lembretes precisam ser idempotentes: não enviar duas vezes o mesmo aviso no mesmo período. Registre a tentativa e não interrompa o servidor se o provedor de e-mail estiver temporariamente indisponível.

## 5. Produtos, imagens e catálogo

Permita cadastrar e editar nome, descrição, categoria, fornecedor, SKU, código de barras, marca, unidade, custo, preço, estoque mínimo, status e foto. Use Cloudinary com formatos JPG, JPEG, PNG e WebP e limite de tamanho. A foto deve aparecer corretamente nos cards e detalhes.

Produtos inativos ou sem estoque não podem ser vendidos. Preço, disponibilidade e quantidade devem ser consultados novamente pelo servidor no fechamento do pedido.

## 6. Sacola e cupons

Crie sacola lateral responsiva e mantenha `/sacola`. Permita alterar quantidades, remover itens, continuar comprando, calcular frete e aplicar cupom. Mostre produtos, desconto, subtotal, frete, total e economia apenas com valores válidos.

Cupons devem suportar percentual ou valor fixo, compra mínima, desconto máximo, início, validade, limite total, limite por cliente, ativo e público. O desconto incide nos produtos, não no frete. Revalide tudo dentro da transação do pedido e nunca aceite o desconto calculado pelo navegador.

## 7. Frete sem cadastro

Visitantes devem buscar CEP, preencher número e complemento, corrigir o endereço manualmente e calcular frete antes do login. Use ViaCEP e BrasilAPI como alternativa. Evite chamadas duplicadas e aplique rate limit.

Clientes autenticados recebem cálculo automático para o endereço salvo. A origem deve ser configurada em `DELIVERY_ORIGIN_ADDRESS` ou nas configurações da empresa. Nunca fixe endereço no código.

Use Google Routes para distância real por ruas. Deixe configuráveis a distância gratuita e o preço por quilômetro ou fração. Gere cotação assinada, com expiração, vinculada ao endereço e ao cliente quando houver. O servidor deve recalcular o preço a partir da distância assinada. Falha do Google nunca pode virar frete grátis.

## 8. Pedido, reserva e estoque

Crie pedidos em transação. Use `FOR UPDATE` nos registros concorrentes. Ignore preço, desconto, frete, total e status enviados pelo navegador. Consulte produtos, estoque, cupom e cotação no servidor.

Reserve o estoque por período configurável. Salve reservas por pedido e produto. Ao expirar pedido não pago, devolva o estoque uma única vez e registre a movimentação. Ao aprovar pagamento, confirme a reserva e impeça baixa duplicada.

Movimentações precisam guardar tipo, quantidade, saldo anterior, saldo novo, referência, observação, usuário e empresa.

Compras recebidas devem gerar entrada de estoque e financeiro. Cancelamento de compra deve ser transacional e reverter estoque e financeiro. Bloqueie edição ou exclusão que quebre a rastreabilidade.

## 9. PagBank e segurança financeira

Use checkout hospedado pelo PagBank para Pix e cartões habilitados na conta. Nunca armazene número completo de cartão ou CVV.

Envie preços em centavos, itens, desconto, acréscimo, frete, cliente, endereço congelado, referência interna, URLs de retorno, webhook e expiração alinhada à reserva.

Serializar cliques concorrentes no mesmo pedido. Reutilize checkout já criado quando válido. O administrador não pode marcar pagamento como aprovado manualmente. Somente consulta autenticada ao PagBank ou webhook válido pode confirmar pagamento.

Valide o webhook usando o corpo original, SHA-256 e comparação segura. Trate eventos repetidos, fora de ordem e atrasados. A confirmação deve baixar estoque e criar financeiro uma única vez.

## 10. Status, cancelamento e reembolso

Use máquina de estados: aguardando pagamento, pagamento aprovado, separação, saiu para entrega, entregue, finalizada e cancelada. Impeça transições inválidas.

Implemente cancelamento com estorno PagBank, chave de idempotência, registro do reembolso, cancelamento financeiro, devolução de estoque e auditoria. Pedido entregue deve seguir devolução ou atendimento.

Permita solicitações de cancelamento, arrependimento, devolução e reclamação. Gere protocolo e impeça mais de uma solicitação aberta para o mesmo pedido. Aplique o direito de arrependimento cabível e envie textos legais para revisão jurídica antes da publicação.

## 11. GPS de entrega

Quando o pedido sair para entrega, o administrador gera link privado e temporário. Salve apenas o hash do token. Gerar outro link revoga o anterior. Entrega concluída ou cancelada remove posição e rota.

O entregador deve ter tela móvel com mapa, linha da rota, posição real, seta direcional, próxima manobra, distância, duração, chegada estimada, velocidade, orientação por voz, centralização e encerramento. Envie GPS em intervalo curto somente enquanto a página estiver ativa. Não simule deslocamento.

Cliente e administrador veem veículo, rota, destino, estimativas e última atualização. Somente o dono do pedido e administradores da mesma empresa podem acompanhar. Guarde apenas a última posição, salvo decisão jurídica e operacional documentada para histórico.

## 12. Notificações e e-mails

Crie notificações persistentes no sino administrativo para novo cliente, pedido, solicitação LGPD e atendimento. Clientes recebem notificações de status do pedido, pagamento, entrega, cancelamento e respostas.

Use Resend para confirmação de conta, recuperação, pedido, pagamento, entrega, cancelamento, atendimento, LGPD, agendamento, vacinação, aniversário e newsletter. Use HTML e texto, links HTTPS e chaves de idempotência. Não registre chaves, tokens, destinatários ou conteúdo sensível.

## 13. Administração profissional

Preserve módulos de clientes, pets, serviços, agenda, funcionários, categorias, produtos, estoque, fornecedores, compras, vendas e financeiro. Adicione:

- Cupons.
- Usuários administrativos.
- Auditoria.
- Atendimento ao consumidor.
- LGPD.
- Notificações administrativas.
- Rastreamento de entrega.
- Configuração do endereço de origem.

O dashboard deve usar apenas dados reais. Adicione pesquisa, filtros, paginação e exportação onde fizer sentido.

## 14. LGPD

Registre versão e aceite da política. Mantenha consentimento de newsletter separado. Crie exportação estruturada, correção, portabilidade, revogação, anonimização e exclusão com protocolo.

Exclusão deve revogar sessões, remover marketing e anonimizar o que puder, preservando registros fiscais, financeiros, clínicos ou jurídicos obrigatórios. Pedidos e agendamentos ativos impedem exclusão imediata e geram solicitação para análise.

Registre consentimentos com finalidade, versão, origem, data, hash do IP e hash do User-Agent. Solicitações LGPD devem ter status, prazo, responsável, resposta e notificação.

## 15. Segurança

Use Helmet, CSP, CORS por allowlist, HPP, HTTPS, HSTS, rate limiting geral e específico, validação de entrada, SQL parametrizado, transações, controle de concorrência, escape de HTML, timeout externo, idempotência, logs sem segredos e erros sanitizados em produção.

Separe a chave privada do Google Routes da chave pública do Maps JavaScript. Restrinja a chave pública por domínio e API. Nunca exponha JWT secret, PagBank token, Resend key, banco ou Cloudinary secret.

## 16. Banco, migrações e Railway

Use migrações registradas em `schema_migrations`, com checksum SHA-256 e transação. Não edite migração já aplicada. Crie um novo arquivo.

No Railway, execute `npm run db:migrate` antes do deploy. Adicione health e readiness. Valide `DB_EXPECTED_NAME` para evitar apontar para banco errado. Use `DATABASE_URL` privada do serviço PostgreSQL.

Configure no serviço da aplicação, nunca no serviço PostgreSQL, as integrações externas. Não versione `.env`.

## 17. Backup e operação

Crie backup custom com `pg_dump`, valide com `pg_restore --list` e exija confirmação do banco na restauração. Documente ensaio em banco separado. Crie `release:check` para verificar variáveis, migrações, empresa, administrador, integrações, catálogo, estoque e dados legais.

## 18. Testes obrigatórios

Implemente testes de autenticação, revogação, escopo por empresa, cadastro, confirmação, pets, serviços, agenda, conflitos de horário, prontuários, vacinas, lembretes, produtos, estoque, compras, cupons, frete, CEP, pedido, reserva, PagBank, webhook, cancelamento, reembolso, financeiro, notificações, GPS, atendimento, LGPD, auditoria e migrações.

Testes PostgreSQL devem usar banco local ou schema temporário. Nunca rode teste destrutivo em produção.

## 19. Definição de pronto

Só declare o PetFlow original pronto para venda quando todos os fluxos principais forem testados, as integrações forem homologadas, o backup e a restauração forem validados, os dados legais forem preenchidos, os textos forem revisados, não houver segredos no repositório e não existirem vulnerabilidades críticas conhecidas.

Ao terminar, informe funcionalidades entregues, arquivos alterados, migrações, testes, variáveis, procedimento de deploy, backup, restauração, limitações reais e ações que dependem do proprietário da empresa.

Não entregue apenas uma análise. Implemente, teste, corrija e documente.
