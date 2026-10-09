# PetFlow original — operação e validação

Atualizado em 09/10/2026. A integração usa a API de produção do PagBank e o token existente. O produto de teste `TESTE-CREDITO-6-20261008` foi publicado por R$ 6,00, com 10 unidades iniciais. Seu pedido foi criado com frete grátis (945 m), mas a reserva terminou sem pagamento: a consulta canônica ao PagBank em 09/10 confirmou checkout EXPIRED, sem cobrança. Não foi efetuado pagamento nem estorno real durante esta revisão.

## Diagnóstico e correções

O banco publicado estava na migração 112, embora o código dependesse das seguintes. Em 07/10, depois de backup e ensaio de restauração/migração local, foram aplicadas as migrações 113 a 122. `npm start` agora verifica as migrações antes de abrir a aplicação; o Railway deve consultar `/api/readiness`.

No deploy seguinte, a comparação estrita de checksums entre arquivos Windows/Linux interrompeu a inicialização. A revisão de 08/10 trata diferenças de final de linha sem aceitar alterações no conteúdo SQL nem reaplicar migrações existentes.

O frete foi definido pelo proprietário e salvo no ambiente local e no Railway: até 1 km grátis, R$ 3 por quilômetro excedente, cobrança proporcional e alcance máximo de 20 km. A cotação real entre a origem configurada e a Prefeitura de Santo André retornou 3.120 metros e R$ 6,36. O Google Routes continua sendo a fonte da distância.

O cupom PETFLOW10 está ativo, com desconto de 10%. O servidor validava o cupom, mas a interface não confirmava sua aplicação e o total permanecia indisponível enquanto o frete falhava. O resumo deve distinguir desconto aplicado de frete ainda pendente.

O GPS dependia do carregamento do Google Maps para iniciar o envio de posições. O compartilhamento foi separado do mapa, com envio inicial imediato, mensagens próprias para permissões/HTTPS e alternativa de navegação externa. O aparelho precisa conceder localização e manter a página aberta durante a rota.

Na revisão de 09/10, a cota de rastreamento foi separada por link validado do entregador e por usuário autenticado. As cotas continuam limitadas a 40 requisições/minuto; tentativas inválidas seguem limitadas por IP. Isso impede que entregador e observadores na mesma rede esgotem uma cota compartilhada. Respostas de limite agora usam JSON em português. Abrir outro aplicativo ou bloquear a tela pode pausar o GPS; a página orienta o entregador a voltar ao PetFlow para retomar.

O retorno do checkout identifica o pedido e consulta o resultado autenticado no PagBank. Durante ACTIVE, WAITING, IN_ANALYSIS ou AUTHORIZED, a página faz até seis consultas com intervalo de cinco segundos; confirmação, recusa, falha e saída da página interrompem o acompanhamento. Se for preciso entrar novamente, o login preserva o destino do pedido. A URL de retorno nunca confirma pagamento por si só.

Webhooks agora solicitam checkout/pedido e cobrança canônicos antes de liberar estoque ou gerar financeiro. A referência, o vínculo da cobrança, a moeda e o total pago precisam corresponder ao pedido. Recusa ou cancelamento de uma tentativa de cartão não encerra um checkout ainda ativo nem substitui a cobrança já confirmada. Pagamento após cancelamento conserva os identificadores e abre pendência para atendimento, sem baixar estoque ou ressuscitar a venda.

## Limpeza solicitada do cadastro

Em 07/10 foram removidos cinco clientes, cinco contas de cliente e cinco pets sem histórico. Consultas, vacinação e agenda estavam vazias. Os 25 pedidos e o lançamento financeiro foram preservados. O ensaio em transação com rollback confirmou esses números antes da aplicação.

Backup anterior à remoção: `.backups/petflow-before-customer-cleanup-2026-10-07-verified.dump`. O arquivo contém dados privados, está fora do Git e teve seu catálogo validado e restauração local concluída. Não incluí-lo em deploys ou anexos públicos.

## Recursos implementados

O checkout público agora recebe uma chave de intenção por tentativa. O servidor normaliza itens, endereço, cupom e forma de pagamento, grava a intenção com o pedido na mesma transação e recupera o mesmo pedido em um reenvio após perda de resposta ou expiração da cotação. Uma chave reutilizada com dados diferentes é rejeitada; a interface preserva a sacola até receber uma resposta definitiva. Cupons que zerariam o pedido são rejeitados antes do commit.

A tela de entrega foi redesenhada para navegação móvel: mapa escuro, manobra atual e próxima, rota ciano, seta baseada no heading real, velocidade, ETA, controles de centralização/rota/voz/tela cheia e botão para abrir a navegação externa. O GPS continua enviando a posição quando o Maps falha, pausa ao sair da página e retoma ao voltar. O painel administrativo gera o link privado em POST /api/entregas/admin/:id/link somente para pedido SAIU_PARA_ENTREGA; o link vale 12 horas, revoga o anterior e é aberto em /entrega.html#TOKEN. Como não há pedido elegível em produção neste momento, nenhum token privado foi criado ou exposto.

| Área | Comportamento |
| --- | --- |
| Sessões | Separação cliente/equipe, empresa e versão de sessão; revogação e recuperação de uso único. |
| Cadastro | Validação de CPF, contatos, endereço, senha e aceites; envio crítico antes da confirmação do cadastro. |
| Produtos e estoque | Campos comerciais completos, upload de foto, escopo por empresa, estoque reservado e histórico preservado. |
| Pedidos | Preço e desconto calculados no banco, endereço congelado, frete assinado, reserva transacional e baixa única. |
| Pagamento | Tentativa durável antes da chamada; resposta incerta bloqueia repetição; rejeição comprovada permite tentar o mesmo pedido. Meus pedidos oferece pagamento pendente e consulta de confirmação. |
| Conciliação | Estornos parciais, disputas e reversões com lançamentos separados; consulta canônica ao provedor. |
| Devolução | Aprovação pelo atendimento e recebimento físico por item; estoque só retorna após decisão explícita de reposição. |
| Entrega | Link privado com expiração/revogação, GPS com timestamp e precisão, mapa e navegação externa. |
| Agenda e clínica | Conflitos de horário, escopo por tutor/pet/empresa e preservação dos registros clínicos. |
| Privacidade | Exportação ampliada por titular, protocolos, resposta administrativa, revogação de newsletter e análise de retenção. |
| E-mails opcionais | Fila durável transacional com idempotência, espera progressiva e estados de falha/resultado incerto. |

## Migrações e publicação

Preservar os SQL já aplicados. Nunca editar um arquivo para contornar o checksum. Mudanças reais exigem novo arquivo. Não executar a remoção de funcionários pertencente ao PetFlow v2.

| Migração | Finalidade |
| --- | --- |
| 113 | Revogação de sessões, tokens e histórico idempotente. |
| 114 | Reservas e movimentações de estoque. |
| 115 | Observação, direção e velocidade do GPS. |
| 116 | Agenda e preservação clínica. |
| 117 | Intenção durável de reembolso. |
| 118 | Intenção durável de checkout. |
| 119 | Fila de e-mails. |
| 120 | Conciliação e devoluções. |
| 121 | Vínculos de tutor, categoria, fornecedor e estoque restritos à empresa. |
| 122 | Nova tentativa após rejeição comprovada do checkout. |
| 123 | Intenção idempotente de pedido, com vínculo empresa/cliente/venda e índice composto. |

A migração 113 invalida links antigos de confirmação/recuperação. A 121 usa constraints NOT VALID para preservar possíveis inconsistências legadas; novas gravações são verificadas, mas os registros antigos exigem revisão antes da validação integral.

A configuração de deploy inclui pre-deploy e verificação no início por npm, além de readiness. A trava do migrador serializa execuções. O readiness verifica o manifesto inteiro. Referência: [configuração Railway](https://docs.railway.com/config-as-code/reference).

Em 09/10, três builds falharam antes de instalar dependências porque o helper Alpine do Railpack 0.40.1 recebeu 429/504 do Docker Hub. `railpack.json` configura `steps.install.secrets=["*"]`: pela implementação desta versão, a instalação usa o hash global já fornecido pelo Railway e dispensa o helper que calcula hashes por subconjunto. As variáveis já eram montadas em todos os comandos pelo Railpack; esse ajuste muda a invalidação do cache, sem gravar valores no arquivo. Qualquer mudança de variável passa a invalidar a etapa de instalação. `deployOutputs=[]` conserva as entradas de imagem geradas pelo provider e evita adicionar uma camada extra da instalação. Referências: [configuração Railpack](https://railpack.com/config/file/) e [implementação 0.40.1](https://github.com/railwayapp/railpack/blob/v0.40.1/buildkit/build_llb/build_graph.go).

## Configuração

Manter segredos exclusivamente nas variáveis do ambiente. Não copiar valores de tokens/chaves para Git, logs ou documentação.

- Aplicação: NODE_ENV, DATABASE_URL, DB_EXPECTED_NAME, DB_SSL, JWT_SECRET, JWT_EXPIRES_IN, APP_URL, FRONTEND_URL.
- Pagamento: PAGSEGURO_BASE_URL=https://api.pagseguro.com, PAGSEGURO_TOKEN e PAGSEGURO_ENABLE_DEBIT conforme liberação da conta.
- E-mail/upload: RESEND_API_KEY, EMAIL_FROM e variáveis CLOUDINARY existentes.
- Entrega: GOOGLE_MAPS_API_KEY, GOOGLE_MAPS_BROWSER_API_KEY, DELIVERY_ORIGIN_ADDRESS, DELIVERY_FREE_DISTANCE_KM=1, DELIVERY_PRICE_PER_KM=3, DELIVERY_MAX_DISTANCE_KM=20, DELIVERY_CHARGE_FRACTION=true.
- Operação: ORDER_RESERVATION_MINUTES, CANCELLATION_WINDOW_MINUTES, CANCELLATION_MIN_DISTANCE_METERS, PRIVACY_POLICY_VERSION.

A chave Google do servidor precisa autorizar Routes API; a do navegador precisa autorizar o domínio e Maps JavaScript API. A origem deve corresponder ao endereço real da loja.

## Verificação e backup

Executar `npm run release:check` para sintaxe, testes unitários/HTTP/DOM, links locais e auditoria de dependências. Esse comando não substitui PostgreSQL nem valida uma transação real.

Para `npm run test:integration`, criar banco vazio separado cujo nome comece com petflow_test e definir TEST_DATABASE_URL e TEST_DATABASE_NAME. O runner não carrega o .env, aplica as migrações e recusa banco já inicializado. Nunca usar o banco operacional nesse teste.

A integração PostgreSQL passou em 07/10, incluindo reserva concorrente, pagamento idempotente, checkout rejeitado seguido de recuperação, devoluções, conciliação, fila, privacidade, compras e isolamento entre empresas. Backup real foi restaurado em outro banco local e as migrações passaram antes da aplicação à produção.

Em 09/10, `npm run release:check` passou com 201 arquivos JavaScript verificados, 168 testes, 500 links locais válidos e nenhuma vulnerabilidade reportada pela auditoria de dependências de produção. A integração PostgreSQL isolada também passou após restaurar o backup pré-123/124 e aplicar a migração 123; os contadores restaurados permaneceram em 27 vendas, 1 cliente e 2 e-mails. A integração PostgreSQL passou novamente em banco local vazio e isolado, incluindo pagamento tardio sem baixa de estoque e recuperação administrativa idempotente de uma cobrança já paga. A fixture de cancelamento em rota usa um único horário recente para evitar diferença de relógio entre PostgreSQL e Node; as verificações de GPS futuro, precisão e distância permanecem intactas.

```text
npm run db:backup -- /destino-protegido/petflow.dump
npm run db:restore -- /destino-protegido/petflow.dump --confirm-database NOME_EXATO
```

A restauração destina-se a banco vazio, usa transação única e não apaga objetos existentes. DB_EXPECTED_NAME precisa coincidir com o destino. PGBIN informa o diretório dos binários PostgreSQL; PETFLOW_ENV_FILE permite ambiente separado. Definir retenção, armazenamento protegido e periodicidade dos próximos backups.

## Exceções operacionais

- Checkout incerto: conferir a referência no PagBank e usar Conferir pagamentos no painel. Não apagar a intenção para forçar outra cobrança.
- Reembolso incerto: consultar o provedor; não repetir o POST. Estorno de pedido em rota não comprova devolução física do produto.
- E-mail FALHA ou INCERTA: analisar antes de repetir. A fila preserva a chave e remove conteúdo pessoal após sucesso ou retenção terminal. Ainda não há painel específico para investigar esses estados.
- Privacidade: histórico comercial/clínico exige decisão de retenção. A exportação exclui senhas, tokens, payloads brutos do provedor, dados de terceiros e GPS do entregador.

## Verificações ainda necessárias

- Uma compra acompanhada em produção, incluindo confirmação por webhook e percurso em aparelho real. O checkout de R$ 6,00 expirado comprova criação, frete e encerramento, mas não o ciclo de aprovação. Um novo checkout precisa ser criado pelo fluxo normal de compra quando o usuário estiver pronto para confirmar o cartão.
- GPS em dois aparelhos, permissões, perda de conexão e retomada; navegador em segundo plano pode suspender a captura.
- Domínio/envio real de e-mail e upload Cloudinary. As variáveis de produção estão presentes e iguais às locais; o ping da API administrativa do Cloudinary ainda responde 401, então o upload real não foi declarado validado. A chave Resend é restrita a envio e responde 401 ao endpoint administrativo de domínios, sem invalidar as mensagens já aceitas para a fila.
- Razão social, CNPJ, endereço e contatos aprovados para os textos públicos, além da política de retenção da empresa.
- Operação das exceções de e-mail, backup periódico e acompanhamento de deploys.

Os resultados automatizados comprovam os cenários executados; não certificam todos os requisitos comerciais ou integrações externas.
