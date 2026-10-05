# PetFlow original — operação e validação

Atualizado em 05/10/2026. O trabalho preserva pets, funcionários, serviços, agenda e área clínica. O `.env` original não foi alterado. Não houve deploy nem transação com o PagBank de produção.

## Estado da entrega

As rotinas locais descritas abaixo foram implementadas e testadas. Isso não representa aprovação para venda ou publicação: ainda existem pendências de integração, cobertura e operação na seção final. O relatório não substitui revisão dos textos legais pelo responsável da empresa.

## Implementação

| Área | Comportamento implementado |
| --- | --- |
| Sessões | JWT separado para cliente/equipe, empresa e versão de sessão; consulta da conta; revogação no logout e em alterações de acesso; recuperação de uso único. |
| Administração | Usuários ADMIN/GERENTE, proteção do último administrador, cupons, auditoria, solicitações, leitura persistente de notificações. |
| Cadastro | CPF, contatos, endereço, senha em bytes, aceite versionado; falha do envio crítico desfaz cadastro. |
| Pedidos | Preços obtidos do banco, cupom e frete revalidados, endereço congelado, reserva transacional e baixa única. |
| Estoque/compras | Concorrência testada; quantidade reservada protegida; compras em centavos, fornecedores/produtos da empresa; itens sem alteração avulsa; histórico preservado. |
| Financeiro | Lançamentos de vendas controlados pelo pagamento; compra permite registrar pagamento preservando origem, valor e vínculo; cancelamento de lançamento manual preserva registro. |
| Checkout | Tentativa durável antes da chamada externa, serialização e reaproveitamento; resposta incerta bloqueia nova criação; conciliação de checkout existente pelo painel. |
| Cancelamento | Janela e GPS conservadores; reembolso com chave persistente, confirmação antes da devolução de estoque; fora da regra abre atendimento. |
| Frete | CEP com alternativa, distância de carro, configuração de origem e tarifa, cotação assinada e expiração; falha não vira gratuidade. |
| Entrega | Link privado de 12 horas salvo como hash, rotação/revogação, última posição, visualização por cliente/equipe e tela móvel do entregador. |
| Agenda/clínica | Conflitos de horários, escopo por empresa/tutor/pet, registros clínicos administrativos, auditoria, preservação do histórico. |
| Privacidade | Protocolos, exportação selecionada, resposta administrativa, revogação da newsletter, anonimização automática apenas sem histórico que exija análise. |
| Operação | Health/readiness, checksums de migrações, verificação de links/sintaxe, suíte automatizada, backup custom e restauração confirmada. |

## Migrações

Preservar os arquivos já aplicados. Executar `npm run db:migrate` no pre-deploy, conforme `railway.json`. O script verifica checksums e serializa execuções. Não executar `105_remover_funcionarios.sql` do PetFlow v2.

| Migração adicionada no trabalho | Finalidade |
| --- | --- |
| 113_sessoes_e_operacao.sql | Revogação de sessões, tokens antigos e eventos idempotentes. |
| 114_integridade_estoque.sql | Proteção de reservas e registro de movimentações. |
| 115_entrega_posicao.sql | Observação, direção e velocidade da última posição. |
| 116_agenda_clinica.sql | Duração da agenda, escopo clínico e preservação de registros. |
| 117_reembolsos.sql | Registro durável e chave de reembolso. |
| 118_tentativas_checkout.sql | Tentativa de checkout que sobrevive à perda da resposta. |

A migração 113 revoga sessões afetadas e invalida links antigos de recuperação/confirmação em texto simples. Clientes podem precisar solicitar novo link. Ensaiar em cópia anonimizada de dados legados antes da migração real; o teste realizado usa banco vazio.

## Variáveis

Configurar somente o que estiver ausente, mantendo os valores existentes dos serviços já funcionais. Não copiar segredos para documentação, Git ou mensagens.

- Aplicação: `NODE_ENV=production`, `DATABASE_URL`, `DB_EXPECTED_NAME`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `APP_URL`, `FRONTEND_URL`.
- Integrações existentes: `PAGSEGURO_BASE_URL`, `PAGSEGURO_TOKEN`, `PAGSEGURO_ENABLE_DEBIT`, `RESEND_API_KEY`, `EMAIL_FROM`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `MAX_FILE_SIZE`.
- Novos recursos: `GOOGLE_MAPS_API_KEY`, `GOOGLE_MAPS_BROWSER_API_KEY`, `DELIVERY_ORIGIN_ADDRESS`, `DELIVERY_FREE_DISTANCE_KM`, `DELIVERY_PRICE_PER_KM`, `DELIVERY_MAX_DISTANCE_KM`, `DELIVERY_CHARGE_FRACTION`, `ORDER_RESERVATION_MINUTES`, `CANCELLATION_WINDOW_MINUTES`, `CANCELLATION_MIN_DISTANCE_METERS`, `PRIVACY_POLICY_VERSION`.
- Testes isolados: `TEST_DATABASE_URL`, `TEST_DATABASE_NAME`.
- Ferramentas de backup: `PGBIN` quando os binários PostgreSQL não estiverem no PATH; `PETFLOW_ENV_FILE` permite usar um arquivo separado ou inexistente quando todas as variáveis forem fornecidas explicitamente.

No Railway, usar a referência privada do PostgreSQL no serviço da aplicação, com o nome esperado do banco. URLs públicas da aplicação devem usar HTTPS. Restringir a chave Google do servidor à Routes API e a chave do navegador ao domínio autorizado e Maps JavaScript API. O endereço de origem e os preços de entrega precisam vir do proprietário.

## Validação reproduzível

1. Instalar dependências com `npm ci` na versão Node compatível com `package.json`.
2. Executar `npm run release:check`. Inclui sintaxe, testes unitários/HTTP, links e auditoria npm.
3. Criar um banco PostgreSQL **vazio e separado**, cujo nome comece com `petflow_test`. Definir `TEST_DATABASE_URL` e `TEST_DATABASE_NAME` para esse banco.
4. Executar `npm run test:integration`. Esse teste não carrega `.env`, recusa banco já inicializado e aplica todas as migrações. Precisa de um novo banco vazio a cada execução. Nunca apontar ao banco de produção.
5. Ensaiar backup/restauração e conferir health/readiness na aplicação conectada ao banco restaurado.
6. Executar a homologação externa e os cenários manuais pendentes abaixo.

`release:check` sozinho **não** executa o teste PostgreSQL nem certifica serviços externos.

Na validação local, o teste PostgreSQL abrange reservas concorrentes de clientes diferentes, confirmação repetida, estoque e financeiro únicos, recuperação de uso único, isolamento, cancelamento/estorno com provedor simulado, expiração, conflitos de agenda, links GPS, registros clínicos, compras, proteção financeira, anonimização, lembretes e checkout com perda de resposta.

## Backup e restauração

Em ambiente com conexão explicitamente configurada:

```text
npm run db:backup -- /destino-protegido/petflow.dump
npm run db:restore -- /destino-protegido/petflow.dump --confirm-database NOME_EXATO_DO_BANCO_DESTINO
```

Usar caminhos reais adequados ao sistema operacional. `pg_dump` cria formato custom, e `pg_restore --list` valida o catálogo. O arquivo não é sobrescrito. A restauração usa transação única, sem apagar objetos existentes; destinar a banco vazio. `DB_EXPECTED_NAME`, quando definido, precisa coincidir com a conexão.

O ensaio de 05/10 utilizou apenas dados sintéticos, criando um arquivo local ignorado pelo Git e restaurando-o em outro banco vazio. Isso não é um backup da produção. Antes do deploy real, definir armazenamento protegido, retenção, responsáveis, periodicidade e monitoramento dos backups.

## Operação de exceções

### Checkout sem resposta

Abrir **Equipe, atendimento e privacidade → Conferir pagamentos**. Conferir no PagBank a referência interna do pedido e informar o identificador do checkout já existente. O servidor consulta o provedor e exige a mesma referência. Esta ação não cria cobrança nem aprova pagamento. Não apagar uma tentativa incerta para forçar repetição. Se não for possível determinar se o provedor criou o checkout, abrir atendimento e concluir a conferência operacional.

O cabeçalho de idempotência é enviado, mas a proteção local contra repetição não depende de o endpoint aceitá-lo. Referências: [checkout hospedado](https://developer.pagbank.com.br/docs/checkout) e [idempotência PagBank](https://developer.pagbank.com.br/docs/chaves-publicas-e-de-idempotencia).

### Reembolso e disputa

Reembolsos incertos permanecem registrados. Consultas posteriores verificam a cobrança; não repetem automaticamente a ordem de estorno. Eventos externos de estorno/chargeback em pedido pago geram alerta persistente sem devolver mercadorias nem regredir uma entrega por evento antigo. A conciliação contábil de disputas, estornos parciais e devoluções após entrega ainda exige evolução específica e validação operacional.

### Privacidade

Pedidos com histórico comercial, agenda, atendimento ou vacinação são encaminhados para análise de retenção; a operação automática não apaga esses dados. A revogação automática do painel é específica para newsletter. Outras finalidades precisam de análise e resposta. A exportação atual contém um conjunto selecionado dos dados; não representa portabilidade completa de todos os documentos clínicos.

## Pendências antes da liberação comercial

### Informações e validações externas

- Razão social, CNPJ, endereço, contato de atendimento/privacidade e critérios aprovados de retenção para finalizar Política de Privacidade e Termos com dados reais.
- Origem, tarifa, área máxima e chaves Google restritas para validar a cotação real.
- Homologação das alterações de checkout/estorno/webhook em conta de testes; o token de produção existente não foi usado nos testes.
- Entrega de e-mails e domínio Resend, upload Cloudinary e GPS em dois aparelhos, inclusive perda de conexão e permissões de localização.
- Ensaio das migrações sobre uma cópia anonimizada do banco existente, backup real e revisão do deploy Railway.

### Trabalho de software ainda necessário

- Completar a conciliação de chargebacks/estornos parciais e o fluxo de devolução após entrega com efeitos contábeis definidos.
- Implementar fila durável e política de novas tentativas para e-mails opcionais; atualmente falhas não desfazem transações, mas o reenvio não é garantido.
- Ampliar exportação de dados e procedimentos de retenção/anonimização parcial conforme decisão documentada da empresa.
- Ampliar cobertura automática e visual dos fluxos legados, especialmente produtos completos, compras/devoluções, edição de estoque, notificações e formulários em dispositivos móveis. Os testes existentes não cobrem integralmente todos os cenários solicitados.

Não há autorização de publicação derivada deste documento. A existência de testes passando não equivale a conclusão de todos os requisitos do pedido original.
