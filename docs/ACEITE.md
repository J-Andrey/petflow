# PetFlow — roteiro de aceite da instalação

Este documento é um roteiro preenchível. **Nenhum teste real da instalação do comprador é declarado concluído nesta versão.** Resultados de outra instalação, testes simulados, checkout criado ou readiness positivo não substituem a homologação abaixo.

Use `APROVADO`, `REPROVADO`, `PENDENTE` ou `NÃO APLICÁVEL` com justificativa. Cada aprovação deve indicar data, responsável e evidência. Não registrar senhas, tokens, links privados de entregador, dados de cartão ou informações pessoais desnecessárias.

## Identificação

| Campo | Valor |
| --- | --- |
| Loja / responsável pelo aceite | A preencher |
| Responsável técnico | A preencher |
| Versão / revisão do manifesto | A preencher |
| Hash SHA-256 do ZIP | A preencher |
| Ambiente e data dos ensaios | A preencher |
| Aparelhos / navegadores utilizados | A preencher |
| Compra controlada: responsável e valor autorizado | A preencher antes do teste |
| Política de backup: frequência, retenção e responsável | A preencher |

## Instalação e titularidade

| ID | Cenário e resultado esperado | Situação |
| --- | --- | --- |
| I01 | Conferir ZIP, hash e manifesto; arquivos obrigatórios presentes e nenhuma credencial/dump/dado do vendedor no pacote. | PENDENTE |
| I02 | Instalar com `npm ci` em Node.js 22+ e PostgreSQL vazio próprio; `db:migrate` conclui e uma segunda execução preserva o schema sem reaplicar arquivos. | PENDENTE |
| I03 | Executar `check:config` com configuração própria; ausência de placeholders, conexão/nome coerentes, URLs públicas HTTPS e integrações corretas. | PENDENTE |
| I04 | Criar ADMIN próprio com `db:seed-admin`, entrar no painel e retirar `ADMIN_PASSWORD` do ambiente. Reexecutar seed com mesmo e-mail não altera senha/perfil. | PENDENTE |
| I05 | Confirmar que contas de hospedagem, banco, domínio, PagBank, Resend, Cloudinary e Google pertencem ao comprador; acessos temporários identificados. | PENDENTE |
| I06 | Dados empresariais, identidade, contatos, textos legais, versão de privacidade, origem/frete e catálogo reais aprovados. Revisar/desativar `PETFLOW10`; nenhum estoque de demonstração em produção. | PENDENTE |
| I07 | Após deploy, `/api/health` e `/api/readiness` respondem 200; aplicação reinicia sem perder dados e continua compatível com as migrações. | PENDENTE |

## Verificações automatizadas

| ID | Execução e critério | Situação |
| --- | --- | --- |
| A01 | `npm run release:check`: sintaxe, testes, links e auditoria de dependências concluem; registrar revisão, totais e saída resumida. | PENDENTE |
| A02 | `npm run test:integration`: banco novo vazio `petflow_test...`, com `TEST_DATABASE_URL` e `TEST_DATABASE_NAME` próprios; migrações e cenários de integridade passam. | PENDENTE |
| A03 | `npm run release:package` em revisão limpa e versionada gera ZIP, SHA-256 e manifesto; pacote extraído contém somente o material de entrega. | PENDENTE |

O runner de integração não lê `.env`. Nunca apontá-lo ao banco operacional nem reutilizar o banco já inicializado da execução anterior. Resultados automatizados devem ser anexados à revisão efetivamente entregue, sem substituir os testes externos e de uso abaixo.

## Fluxos da loja e integrações reais

| ID | Cenário e resultado esperado | Situação |
| --- | --- | --- |
| F01 | Cliente de teste controlado se cadastra, recebe e-mail real, confirma o endereço, entra e recupera a senha. Link já usado/expirado não pode ser reutilizado. | PENDENTE |
| F02 | Catálogo exibe categoria/produto reais, foto e preço corretos; upload real chega ao Cloudinary do comprador. Registrar e depois remover a imagem temporária, se criada para o teste. | PENDENTE |
| F03 | Cotar entrega para endereço controlado: faixa gratuita, faixa cobrada e endereço fora da cobertura têm resultados compatíveis com a política aprovada. | PENDENTE |
| F04 | Aplicar cupom permitido e conferir subtotal, desconto, frete e total no site e no checkout PagBank. Cupom inválido/expirado não reduz o valor. | PENDENTE |
| F05 | Compra controlada com pagamento real autorizado: cobrança aprovada na conta correta, retorno e webhook/consulta confirmam o mesmo pedido, estoque baixa uma vez e financeiro registra uma vez. | PENDENTE |
| F06 | Repetir consulta/retorno do pedido pago sem criar cobrança, pedido, baixa ou lançamento duplicado. Validar perda de resposta/reenvio em ambiente de homologação. | PENDENTE |
| F07 | Pedido sem pagamento expira e libera a reserva sem aumentar estoque físico. Registrar prazo configurado e disponibilidade antes/depois. | PENDENTE |
| F08 | Pagamento pendente ou rejeitado apresenta situação coerente; fluxo Conferir pagamentos recupera vínculo existente sem criar cobrança. Cenário incerto pode ser exercitado de modo controlado em homologação. | PENDENTE |
| F09 | Testar cada forma de pagamento anunciada. Débito somente se habilitado/homologado pela conta; registrar como NÃO APLICÁVEL se não fizer parte da oferta. | PENDENTE |
| F10 | Cancelamento/estorno controlado: provedor e aplicação concordam com valor e estado; reenvio não duplica estorno. Se a resposta for incerta, operação mantém pendência para conferência. | PENDENTE |
| F11 | Devolução: aprovar itens, registrar recebimento, decidir reposição de estoque por item e verificar reembolso/conciliação sem confundir estoque com dinheiro. | PENDENTE |
| F12 | Notificação opcional de pedido/atendimento passa pela fila e é aceita pelo Resend. Conferir recebimento real em caixa controlada e distinguir aceitação de entrega. | PENDENTE |
| F13 | Fila E-mails: ADMIN/GERENTE consultam; ADMIN trata falha elegível e encerra análise; envio INCERTA não é reenviado. Falha controlada deve ser ensaiada fora da operação pública. | PENDENTE |

Para F05 e F10, guardar apenas identificadores necessários, datas, valores e confirmação redigida dos resultados. Encerrar o teste conforme o combinado com o comprador, conciliando a cobrança e eventual reembolso; não abandonar cobranças ou itens fictícios na operação.

## Entrega em aparelhos reais

| ID | Cenário e resultado esperado | Situação |
| --- | --- | --- |
| G01 | Pedido em saída permite gerar link privado; link novo revoga o anterior e pedido não elegível não permite iniciar rastreamento. | PENDENTE |
| G02 | No celular do entregador e em outro aparelho observador, autorizar GPS e realizar percurso controlado com página aberta. Observar posição, horário e precisão. | PENDENTE |
| G03 | Negar localização, interromper rede e restaurar permissões/conexão. A tela orienta a falha e retoma o envio quando possível, sem apresentar posição antiga como atual. | PENDENTE |
| G04 | Bloquear a tela/trocar de aplicativo e voltar. Registrar o comportamento real do navegador e orientar a equipe sobre a possível pausa; não aprovar promessa de rastreamento contínuo em segundo plano. | PENDENTE |
| G05 | Mapa e navegação externa funcionam com as chaves do comprador; se o mapa falhar, conferir indicação de GPS/envio independente. | PENDENTE |

## Gestão, permissões e recuperação

| ID | Cenário e resultado esperado | Situação |
| --- | --- | --- |
| O01 | Cadastrar cliente/pet, serviço e agendamento; conflito de horário é tratado e dados de tutor/pet permanecem coerentes. | PENDENTE |
| O02 | Cadastrar consulta/prontuário/vacinação e conferir histórico. Preparar lembrete controlado e confirmar a data/regra efetivamente aplicada. | PENDENTE |
| O03 | Registrar compra/entrada e movimentação de estoque de teste; saldo e financeiro conferem. Não usar exclusão de histórico para corrigir uma movimentação. | PENDENTE |
| O04 | Testar ADMIN, perfil de equipe autorizado e cliente: acesso indevido às operações protegidas é negado. Conta desativada não mantém acesso operacional. | PENDENTE |
| O05 | Abrir e responder protocolo de atendimento/privacidade, exportar dados de titular controlado e cancelar newsletter; preservar histórico conforme decisão de retenção aprovada. | PENDENTE |
| O06 | Criar backup, validar catálogo e restaurar em outro banco vazio; conferir registros, migrações, tempo de recuperação e ausência de envios/cobranças acidentais no ensaio. | PENDENTE |
| O07 | Configurar e comprovar uma execução do agendador externo de backup, retenção/cópia protegida e alerta de falha. O script sozinho não satisfaz este item. | PENDENTE |
| O08 | Entregar acesso aos manuais, treinar rotina de pedidos/e-mails/conciliação e registrar operador responsável, canal de suporte e condições aprovadas. | PENDENTE |

## Evidências e pendências

Copiar uma linha para cada teste executado. Evidência pode ser log sanitizado, identificação de registro controlado, captura sem dados sensíveis ou registro acompanhado pelo comprador.

| ID | Data / responsável | Resultado observado | Evidência protegida | Pendência / responsável / prazo |
| --- | --- | --- | --- | --- |
| A preencher | A preencher | A preencher | A preencher | A preencher |

Falhas na criação da instalação, acesso administrativo, pagamento, integridade de estoque/financeiro, entrega prometida, envio necessário para cadastro ou recuperação de dados bloqueiam a abertura operacional até resolução. Demais pendências precisam de decisão explícita, impacto descrito, responsável e prazo; não transformar ausência de teste em aprovação.

## Registro de aceite

- Recebimento do pacote e manuais: **PENDENTE**.
- Homologação técnica da instalação: **PENDENTE**.
- Aprovação dos fluxos financeiros e integrações reais: **PENDENTE**.
- Treinamento e rotina de backup recuperável: **PENDENTE**.
- Liberação comercial para operação: **PENDENTE**.
- Responsáveis, data, pendências aceitas e condições de suporte: **A preencher**.

O aceite identifica a versão ensaiada e suas condições. Alterações posteriores de código, infraestrutura, domínio ou contas de provedores podem exigir novos testes dos fluxos afetados.
