# PetFlow — manual de operação

Aplicável a uma instalação da edição original, configurada conforme o [README](../README.MD). Registre o responsável técnico, o responsável por pagamentos, o local protegido dos backups e o canal de incidentes no documento interno da loja. Credenciais ficam no ambiente/gerenciador de segredos do comprador.

## Rotina da loja

| Frequência | Ação |
| --- | --- |
| Início do expediente | Abrir o painel, verificar pedidos aguardando atendimento, entregas, agenda, notificações e disponibilidade da loja. |
| Durante o expediente | Acompanhar pagamento confirmado, separação, saída e entrega; conferir divergências de estoque, solicitações e falhas de e-mail. |
| Fechamento | Conciliar vendas/reembolsos com PagBank, verificar pendências, confirmar execução do backup e registrar falhas. |
| Após atualização/configuração | Conferir readiness, login, telas afetadas e integração alterada; manter evidência da revisão. |
| Periodicidade definida pela loja | Ensaiar restauração, revisar acessos, capacidade, limites dos provedores e atualizações de dependências. |

Estabeleça uma frequência de backup e um tempo de recuperação compatíveis com a perda de dados tolerável pela loja. O projeto fornece os comandos; não configura nem executa automaticamente um agendador de backups.

## Saúde e inicialização

```powershell
npm run check:config
npm start
```

`check:config` verifica campos offline. `npm start` aplica/verifica as migrações e inicia o servidor. Quando o servidor sobe, ele inicia também o processamento da fila de e-mails, a liberação de reservas e os lembretes. Mantenha o serviço em execução para essas rotinas funcionarem.

- `GET /api/health`: processo HTTP está respondendo; não consulta banco nem provedores.
- `GET /api/readiness`: acesso ao banco e checksums de todas as migrações do pacote. Retorno 503 precisa de investigação antes de liberar tráfego.
- Fila de e-mails: verificação a cada 30 segundos enquanto o servidor está ativo, com até dez eventos por rodada.
- Reservas: verificação a cada 60 segundos; libera reservas vencidas de pedidos aguardando pagamento.
- Lembretes: execução ao iniciar e a cada 24 horas. A implementação atual busca agenda/vacinação previstas para três dias à frente; não há editor de periodicidade no painel.

Essas verificações não substituem monitoramento do hospedeiro e dos provedores. Registre horário, rota, código de erro e identificador do pedido/evento quando houver falha. Evite copiar tokens, senhas, conteúdo de e-mails, CPF, payloads de pagamento e links privados para chamados ou logs públicos.

## Pedidos, estoque e pagamento

1. O pedido público reserva disponibilidade antes do pagamento. Preço, estoque, desconto e frete são conferidos no servidor.
2. O cliente abre o checkout PagBank. Um retorno ao site, captura de tela ou relato do cliente não confirma recebimento: use a situação consultada pelo sistema no provedor.
3. Após confirmação, o sistema registra a baixa de estoque e os lançamentos correspondentes uma única vez. A equipe passa o pedido pelos estados permitidos de preparação e entrega.
4. Reservas vencidas liberam disponibilidade. Pagamento que chegar depois do cancelamento exige conciliação/atendimento; não retoma automaticamente a venda.

Não altere estados de pagamento, intenções ou estoque diretamente no banco para contornar uma pendência. Use os fluxos administrativos, mantendo o histórico.

### Checkout sem resposta ou pagamento divergente

Abra **Administração → Conferir pagamentos** em `/admin/profissional.html`. Localize o pedido e confira sua referência na conta PagBank do comprador. Quando o painel solicitar o identificador de um checkout existente, use o identificador conferido no provedor; a ação consulta esse checkout e não cria outra cobrança.

Uma tentativa incerta bloqueia repetição para evitar cobrança duplicada. Não remova a tentativa nem peça ao cliente que crie pedidos sucessivos antes da conferência. Rejeição comprovada pode permitir nova tentativa no mesmo pedido enquanto a reserva estiver válida. Se houver pagamento de pedido cancelado, use **Conciliação** e o atendimento para decidir a solução.

### Cancelamento, estorno e devolução

As regras automáticas de cancelamento consideram janela operacional, status e, em rota, posição/distância válidas. Casos bloqueados devem seguir atendimento; a janela técnica não define por si só todos os direitos ou condições aplicáveis ao cliente.

1. Localize a solicitação em **Atendimento** e analise o histórico do pedido e da cobrança.
2. Use **Devoluções** para aprovar os itens e registrar recebimento físico. A decisão de repor estoque é explícita e por item; estorno financeiro não prova que o produto voltou.
3. Execute o reembolso pelo fluxo correspondente com usuário autorizado. Confira o resultado na aplicação e no PagBank.
4. Em estado de reembolso incerto/processando, consulte o provedor e a conciliação antes de repetir qualquer solicitação. Registre a resolução.

Disputas, estornos parciais e reversões devem ser comparados com os registros do provedor. Encerrar uma análise administrativa não cria saldo no banco do comprador nem substitui a conferência da liquidação.

## Entregas e GPS

O link do entregador é gerado pelo administrador apenas para pedido em `SAIU_PARA_ENTREGA`. Ele expira em 12 horas; gerar outro revoga o anterior. É um acesso privado: compartilhe somente com o entregador designado e não o inclua em evidências públicas.

No aparelho do entregador:

1. Abra o link em HTTPS e autorize a localização precisa, quando disponível.
2. Mantenha a página aberta durante o percurso e observe se as posições continuam sendo enviadas.
3. Se abrir navegação externa, bloquear a tela ou perder internet, volte ao PetFlow e confira a retomada.
4. Se o mapa não carregar, a captura de posição pode continuar, desde que o GPS e a página estejam ativos. Use a mensagem de estado da página para diagnosticar.

O operador deve verificar a idade da posição e a precisão, sem interpretar um ponto antigo como localização atual. A compatibilidade e o comportamento em segundo plano dependem do aparelho/navegador e precisam ser ensaiados nos celulares da equipe. Não há garantia de rastreamento contínuo com tela bloqueada.

## E-mails e pendências da fila

Em **Administração → E-mails**, ADMIN e GERENTE consultam estados, tentativas, prazos e orientações; somente ADMIN pode reagendar quando elegível ou encerrar a análise. A tela não exibe destinatário, assunto, conteúdo ou chave do provedor. Cadastro e recuperação de senha usam envio direto e não aparecem nessa fila de notificações.

| Estado | Interpretação e ação |
| --- | --- |
| `PENDENTE` | Aguarda a próxima tentativa. Conferir se o servidor está ativo, a integração Resend está configurada e o prazo não expirou. |
| `PROCESSANDO` | Evento adquirido pelo trabalhador. Um bloqueio vencido pode ser retomado automaticamente com a mesma chave. |
| `ENVIADA` | Provedor aceitou a solicitação. Não equivale a leitura ou entrega na caixa de entrada. |
| `FALHA` | Tentativas, prazo ou rejeição impediram o envio. Corrigir a causa e usar Reagendar somente se a tela permitir. |
| `INCERTA` | Não foi possível confirmar o resultado com segurança. Conferir no Resend e tratar o atendimento antes de encerrar a análise. Não forçar novo envio. |

O trabalhador usa espera progressiva, até oito tentativas e janela máxima de repetição de 23 horas desde a primeira tentativa, respeitando a expiração do evento. Um reagendamento manual não zera esses limites nem cria nova chave. Eventos incertos, expirados, sem conteúdo ou com limite atingido não são elegíveis.

Ao reagendar uma falha elegível, o processamento ocorre pela fila. **Encerrar análise** registra a decisão sem reenviar e elimina o conteúdo do evento. O conteúdo também é removido após aceitação pelo provedor e, nos estados terminais, pela rotina de retenção após sete dias. Chave e estado permanecem para deduplicação.

Se o erro for de configuração, confira chave Resend, remetente e domínio verificado. Se for limite, confira plano/cota e respeite a espera. Em resultado incerto, procure a evidência no provedor com acesso autorizado; não altere a chave de idempotência para contornar o bloqueio.

## Contas, atendimento e privacidade

- Crie contas individuais com o perfil necessário. Desative acessos que não serão mais usados e revise usuários após desligamentos.
- A criação inicial por `db:seed-admin` preserva contas existentes. Para acesso perdido, utilize recuperação de senha ou outro administrador autorizado.
- Use **Atendimento** e **Privacidade** para registrar e responder protocolos. A exportação do titular exclui senhas, tokens e dados técnicos sensíveis; revise o destinatário antes de entregar o arquivo.
- Retenção de documentos comerciais/clínicos, exclusão e resposta a solicitações precisam seguir a decisão aprovada da loja. Não exclua histórico operacional para resolver uma solicitação sem essa avaliação.
- Troca de `JWT_SECRET` invalida sessões e links assinados. Planeje comunicação e nova autenticação quando houver rotação.

## Backup PostgreSQL

Pré-requisitos: `pg_dump`/`pg_restore` instalados, destino protegido com espaço disponível, conexão confirmada e `DB_EXPECTED_NAME` igual ao banco de origem. O script aceita `PETFLOW_ENV_FILE` para um arquivo separado de conexão; variáveis já presentes no processo têm precedência sobre esse arquivo.

Exemplo no PowerShell, em uma estação ou tarefa operacional configurada para o banco correto:

```powershell
npm run db:backup -- "C:\BackupsPetFlow\petflow-AAAA-MM-DD-HHMM.dump"
```

Substitua data/hora para cada execução. O script recusa sobrescrever arquivo existente, cria um dump no formato custom sem donos/ACL e valida seu catálogo com `pg_restore --list`. Isso detecta parte dos problemas do arquivo; só um ensaio de restauração comprova sua recuperabilidade.

Para usar binários fora do `PATH`, configure `PGBIN` com o diretório onde estão `pg_dump` e `pg_restore`. Para usar outra configuração nos scripts:

```powershell
$env:PETFLOW_ENV_FILE = "C:\ConfiguracaoPetFlow\backup.env"
npm run db:backup -- "C:\BackupsPetFlow\petflow-AAAA-MM-DD-HHMM.dump"
Remove-Item Env:PETFLOW_ENV_FILE
```

Mantenha esse arquivo de ambiente fora do pacote, com permissões restritas. Não coloque credenciais em argumentos de linha de comando ou no nome do arquivo. Se houver falha, revise a causa e use outro nome de destino: um arquivo parcialmente criado não deve ser tratado como backup válido.

Defina com o comprador frequência, retenção, cópia externa, criptografia, alerta de falha e responsável. Configure a execução por serviço/agendador da infraestrutura. Esse agendamento não vem instalado pelo PetFlow. Conserve um registro de data, origem, tamanho, resultado e teste de restauração, sem dados pessoais.

### O que precisa de proteção além do dump

O backup contém registros do PostgreSQL, inclusive dados pessoais. Ele não inclui arquivos de imagem hospedados no Cloudinary, o código, as variáveis secretas, a conta de e-mail, o domínio ou configurações dos provedores. Mantenha cópia da revisão implantada e procedimentos de recuperação desses recursos na conta do comprador. Não inclua dumps no Git nem no ZIP comercial.

## Restauração e recuperação

O destino deve ser **outro banco vazio**, já criado, que não recebeu `db:migrate`. O script não apaga objetos existentes e usa transação única com interrupção em erro. Nunca use restauração como atalho para sobrescrever o banco operacional.

1. Prepare um banco vazio de recuperação e acesso com permissões para restaurar os objetos. Configure um arquivo privado separado, apontando exclusivamente para esse banco.
2. Confira `DATABASE_URL` ou `DB_*` e `DB_EXPECTED_NAME` do destino. Verifique também variáveis previamente exportadas no terminal, que podem sobrepor o arquivo.
3. Restaure, substituindo o nome de exemplo pelo nome exato do destino:

   ```powershell
   $env:PETFLOW_ENV_FILE = "C:\ConfiguracaoPetFlow\restore.env"
   npm run db:restore -- "C:\BackupsPetFlow\petflow-AAAA-MM-DD-HHMM.dump" --confirm-database petflow_restore
   npm run db:migrate
   Remove-Item Env:PETFLOW_ENV_FILE
   ```

4. Registre a revisão usada, o resultado da restauração, o tempo gasto e as contagens relevantes de pedidos, clientes, estoque e financeiro. Confira relações e registros recentes com responsável autorizado.
5. Valide a aplicação em ambiente isolado antes de trocar o serviço operacional. Ao subir o servidor, os trabalhadores são iniciados: uma cópia de produção pode conter e-mails pendentes e lembretes. Não disponibilize chaves reais de envio/pagamento nem tráfego público nesse ensaio sem preparação explícita.
6. Em recuperação real, suspenda novas gravações durante a mudança, preserve a instância anterior e confirme a origem/destino antes de alterar a conexão. Reavalie pedidos/pagamentos ocorridos depois do horário do backup no PagBank. Uma restauração não desfaz cobranças nem eventos já recebidos por terceiros.

`PETFLOW_ENV_FILE` é suportado pelos scripts de migração, seed, configuração e backup. O servidor carrega o `.env` padrão ou as variáveis fornecidas pelo hospedeiro; não presuma que `npm start` trocará todo o ambiente da aplicação por esse caminho.

## Atualizações e diagnóstico

Antes de atualizar uma instalação com dados, faça backup recuperável e ensaie a revisão em ambiente separado. Use `npm ci` com o lockfile entregue, execute os testes adequados e aplique `db:migrate`. Migrações aplicadas são imutáveis; não edite SQL ou checksums para forçar a inicialização. Alteração de schema deve chegar em novo arquivo SQL.

O Railway executa migração em pre-deploy, e `npm start` verifica novamente. A trava do migrador serializa as execuções. Readiness em 503 pode indicar banco inacessível, schema incompleto ou revisão incompatível. Consulte os logs protegidos e compare manifesto de código e migrações.

| Sintoma | Conferência inicial |
| --- | --- |
| Aplicação não inicia | Variáveis obrigatórias, conexão e `DB_EXPECTED_NAME`; resultado da migração. |
| Frete indisponível | Origem completa, Routes API, chave do servidor, cota e regra de distância. |
| Mapa não aparece | Chave do navegador, domínio autorizado, Maps JavaScript API e conexão do aparelho. |
| Upload recusado | Cloud name técnico e chaves do mesmo ambiente, tamanho e formato da imagem. |
| Cliente não recebe cadastro/recuperação | Configuração Resend, domínio/remetente e resultado do envio direto no provedor. |
| Pedido pago sem confirmação local | Referência e cobrança no PagBank; Conferir pagamentos e Conciliação. |
| Mensagens opcionais acumuladas | Servidor ativo, fila E-mails, prazos, conta Resend e limites. |

Não faça rollback de código sem confirmar compatibilidade com o schema atual. Prefira correção adiante quando segura; restauração exige planejamento de perda/reconciliação de dados e responsáveis definidos. Registre causa, ação, verificação e pendências de cada incidente.
