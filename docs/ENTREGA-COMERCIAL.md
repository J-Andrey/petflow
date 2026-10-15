# PetFlow — escopo e entrega comercial

Este documento define uma base verificável para uma entrega de **R$ 5.000**, sujeita à proposta aprovada entre as partes. O preço remunera o pacote, a implantação e os serviços expressamente combinados; não significa exclusividade sobre o código nem inclui automaticamente despesas mensais de terceiros. A entrega só está concluída quando o responsável registra o aceite da instalação do comprador.

## Identificação da entrega

Preencher antes do aceite, sem inserir credenciais:

| Campo | Registro |
| --- | --- |
| Comprador / loja | A preencher |
| Responsável pela implantação | A preencher |
| Responsável pelo aceite | A preencher |
| Versão e revisão do manifesto | A preencher |
| SHA-256 do ZIP entregue | A preencher |
| Ambiente homologado / data | A preencher |
| Valor e condições aprovados | A preencher |
| Prazo, canal e limite do suporte | A preencher na proposta |

## Escopo do produto

Uma instância atende uma loja, com banco, domínio, configuração e contas de provedores próprios. Para outro estabelecimento independente, implante outra instância. Campos `empresa_id` e verificações internas de acesso não constituem um serviço SaaS com cadastro e cobrança de múltiplas lojas.

| Área | Entrega funcional prevista |
| --- | --- |
| Loja web | Catálogo, detalhes de produtos e serviços, cadastro e conta do cliente, sacola, cupons e pedidos. |
| Pagamentos | Checkout hospedado no PagBank, confirmação consultada no provedor, webhook, conciliação e tratamento de pagamento incerto. PIX e crédito; débito condicionado à habilitação da conta. |
| Entrega | Frete por distância consultada no Google Routes, link privado do entregador e acompanhamento das posições recebidas no navegador. |
| Administração | Clientes, pets, categorias, produtos, estoque, fornecedores, compras, pedidos e financeiro operacional. |
| Serviços e clínica | Agenda, funcionários, consultas, prontuários, vacinas e lembretes. |
| Atendimento | Solicitações do consumidor, devoluções, reembolso, solicitações de privacidade e exportação de dados do titular. |
| Operação | Usuários/permissões, auditoria, fila de notificações por e-mail, migrações, saúde da aplicação, backup e restauração por comando. |

O sistema não inclui emissão fiscal, contabilidade, integração com marketplaces, aplicativo nativo, rastreamento garantido com tela bloqueada, geolocalização offline ou operação de múltiplas lojas em uma instância. Novos gateways, integrações, layouts e funcionalidades exigem escopo adicional. O painel financeiro registra operações da aplicação; o extrato e a liquidação efetiva devem ser conciliados com o provedor.

## Conteúdo do pacote

O ZIP inclui código fonte do servidor e das telas, migrações SQL, testes, scripts operacionais, `package-lock.json`, `.env.example`, configuração Railway/Railpack, licença e os manuais de instalação, operação e aceite. O manifesto identifica a revisão e os hashes dos arquivos entregues; o SHA-256 do ZIP permite conferir o pacote recebido. O produtor precisa de Git 2.43+ para empacotar essa revisão. O comprador instala e executa o ZIP sem precisar de Git.

Não integram o pacote `.env`, bancos ou dumps do vendedor, dados de clientes, contas de provedores, tokens de acesso, logs, dependências instaladas ou histórico operacional privado. O comprador começa com banco vazio e seu próprio administrador. Nenhuma conta ou senha padrão precisa ser compartilhada.

O código é distribuído sob a licença MIT em `LICENSE`, com preservação do aviso de licença. A entrega comercial não altera a licença, não transfere automaticamente marcas de terceiros e não oferece exclusividade. Imagens e materiais enviados posteriormente pelo comprador devem ter autorização de uso.

## Responsabilidades e custos recorrentes

| Responsável | Providência |
| --- | --- |
| Comprador | Contratar e administrar hospedagem, PostgreSQL, domínio, PagBank, Resend, Cloudinary e Google Maps, inclusive taxas, consumo, saldo e limites. |
| Comprador | Fornecer identidade, razão social, CNPJ, contatos, endereço, catálogo, preços, estoque, horários e regras comerciais reais. |
| Comprador | Aprovar textos públicos, retenção de dados, atendimento, cancelamentos/devoluções e responsáveis autorizados a estornar. |
| Implantador, conforme proposta | Instalar a revisão entregue, preencher a configuração junto ao comprador, aplicar migrações e orientar a criação do administrador. |
| Implantador, conforme proposta | Aplicar a identidade e os textos combinados, cadastrar a amostra acordada e conduzir o roteiro de homologação e treinamento. |
| Operador designado | Monitorar pedidos, pagamentos, e-mails, backups, falhas e atualizações após o aceite. |

Hospedagem e integrações não possuem gratuidade garantida neste pacote. Quantidade de produtos a cadastrar, importação de dados, personalização, treinamento, manutenção, correções cobertas e prazo de suporte devem ser delimitados na proposta, com responsável e data. Não há SLA, atendimento permanente ou atualização vitalícia implícitos no preço.

## Sequência de implantação

1. **Definir o escopo.** Registrar a loja, os responsáveis, os serviços incluídos e os critérios de aceite. Definir o orçamento dos provedores e a rotina de backup.
2. **Preparar contas próprias.** Criar a infraestrutura na conta do comprador. Confirmar a conta recebedora PagBank, domínio de envio Resend, ambiente Cloudinary e projeto Google com APIs necessárias. Fornecer acesso delegado quando necessário, por canal privado.
3. **Instalar em banco vazio.** Seguir o [README](../README.MD), executar `npm ci`, `check:config`, `db:migrate` e criar o administrador com `db:seed-admin`. Retirar a senha de instalação do ambiente depois.
4. **Configurar a loja.** Preencher dados empresariais no painel, definir frete/origem e cadastrar catálogo e saldo físico reais. Revisar o cupom `PETFLOW10` criado pelas migrações. Não ativar o catálogo demonstrativo em produção.
5. **Publicar identidade e contatos.** Revisar cabeçalhos, rodapés, imagens, nomes, templates de e-mail e páginas em `views/legal`. Esses conteúdos possuem textos estáticos e não são todos atualizados pela tela Configurações. Conferir a versão informada em `PRIVACY_POLICY_VERSION` com a política aprovada.
6. **Homologar.** Executar as verificações técnicas, testar integrações na conta do comprador e preencher [ACEITE.md](ACEITE.md). Compra e estorno reais precisam de valor, pagador e responsável previamente definidos; a presença de um link de checkout não comprova pagamento aprovado.
7. **Treinar a operação.** Demonstrar pedidos, estoque, atendimento, devolução, conciliação, fila de e-mails, link do entregador e procedimento de recuperação. Ensaiar backup/restauração em banco separado.
8. **Entregar e encerrar acessos temporários.** Entregar ZIP, hash, manifesto e evidências sem dados pessoais desnecessários. Confirmar posse das contas pelo comprador, remover acessos temporários conforme combinado e registrar pendências, aceite e início do suporte contratado.

## Limites que precisam ser apresentados na demonstração

- A aplicação é web e requer conexão. No celular do entregador, autorizar a localização, manter a página aberta e retornar a ela após usar outro aplicativo. O sistema não garante coleta com tela bloqueada ou navegador suspenso.
- A configuração de frete depende de endereço de origem correto e Google Routes disponível. O checkout depende dos serviços externos ativos e das regras da conta PagBank.
- Confirmação de cadastro e recuperação de senha usam envio direto de e-mail. As notificações opcionais de pedidos, lembretes e atendimento passam pela fila. Aceitação de mensagem pelo provedor não comprova leitura ou entrega na caixa de entrada.
- Backup PostgreSQL protege os registros do banco. As imagens no Cloudinary, as credenciais, o domínio e a configuração dos provedores exigem proteção e recuperação próprias.
- Cancelamentos, disputas, solicitações de privacidade e devoluções exigem decisão humana em casos previstos na operação. O sistema registra o fluxo; não substitui a política da loja nem a aprovação de seus textos.

## Condição de entrega

Testes automatizados e documentação demonstram comportamentos limitados aos cenários executados. A instalação do comprador só pode ser anunciada como homologada após os testes reais previstos em [ACEITE.md](ACEITE.md), com evidência e responsável. Itens pendentes permanecem identificados; uma assinatura de recebimento do código não deve ser confundida com aceite para abrir vendas.

O repositório possui verificação automática configurada em `.github/workflows/verify.yml`, com checagens da release e integração PostgreSQL isolada. Essa configuração não é um comprovante de execução: quando houver uma execução concluída, registrar a revisão e seu resultado como evidência técnica. Ela não aprova os testes reais nem altera os itens pendentes do aceite.

O registro final deve conter o artefato/revisão, resultados, pendências aceitas, responsáveis, datas e condições de suporte. Qualquer mudança posterior de provedor, domínio, segredo, regra comercial ou código precisa de verificação proporcional ao impacto.
