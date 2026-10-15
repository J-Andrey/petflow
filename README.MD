# PetFlow — loja e gestão de pet shop

Aplicação web para **uma loja por instalação**, com catálogo, pedidos, checkout PagBank, entrega acompanhada pelo navegador e painel de gestão. Esta é a edição original do PetFlow, que também inclui pets, serviços, agenda e registros clínicos.

O pacote contém código e estrutura de banco para uma instalação nova. A entrada em operação depende da configuração da loja, das contas dos provedores e do [aceite na instalação do comprador](docs/ACEITE.md).

## O que está incluído

- Loja: catálogo, cadastro e confirmação de e-mail, conta do cliente, sacola, cupons, cotação de frete e acompanhamento de pedidos.
- Pagamentos: checkout hospedado no PagBank, consulta de confirmação, webhook, conciliação, cancelamento e tratamento de reembolsos/devoluções.
- Gestão: clientes, pets, categorias, produtos, fornecedores, compras, estoque, financeiro, serviços, funcionários e agendamentos.
- Administração: usuários e permissões, auditoria, atendimento, privacidade, fila de e-mails, consultas, prontuários e vacinação.
- Operação: migrações versionadas, endpoints de saúde, scripts de backup/restauração e empacotamento de entrega.

O rastreamento é web: exige HTTPS, permissão de localização e página aberta no celular. Bloquear a tela, trocar de aplicativo ou perder conexão pode interromper as posições. Não há aplicativo nativo, garantia de rastreamento em segundo plano nem administração de várias lojas independentes na mesma instância.

## Requisitos

- Node.js **22 ou superior** e npm.
- PostgreSQL com suporte à extensão `pgcrypto`; usuário de instalação com permissão para criar a extensão e os objetos do banco.
- Contas próprias do comprador: hospedagem, PagBank, Resend, Cloudinary e Google Maps. Domínio com HTTPS para operação pública.
- `pg_dump` e `pg_restore` acessíveis no `PATH` ou no diretório indicado por `PGBIN`, para backup e restauração. Use ferramentas compatíveis com a versão do servidor PostgreSQL.
- Git **2.43 ou superior** para o produtor gerar um novo pacote com `release:package`, que verifica atributos versionados por `git check-attr --source`. O comprador não precisa de Git para instalar e executar o ZIP entregue.

Não há etapa de compilação do frontend: o Express entrega os arquivos HTML, CSS e JavaScript do projeto.

## Instalação local em banco vazio

1. Extraia o pacote em uma pasta própria. Crie no PostgreSQL um banco **vazio**, por exemplo `petflow`, e um usuário exclusivo para ele. Não restaure um banco do vendedor.
2. No diretório do projeto, instale as dependências fixadas no lockfile:

   ```powershell
   npm ci
   ```

3. Copie o exemplo de ambiente, somente se ainda não existir um `.env`:

   ```powershell
   Copy-Item .env.example .env
   ```

4. Edite o `.env` local. Use `DATABASE_URL` **ou** o conjunto `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`. Defina `DB_EXPECTED_NAME` com o nome exato do banco. Se usar `DB_*`, deixe `DATABASE_URL` vazio; uma URL preenchida tem prioridade.
5. Preencha as integrações com as contas do comprador. Gere uma chave aleatória exclusiva para `JWT_SECRET`, de pelo menos 32 bytes; use `JWT_EXPIRES_IN=7d` ou outra duração explícita. Para desenvolvimento local, mantenha `APP_URL` e `FRONTEND_URL` em `http://localhost:4500` e `NODE_ENV=development`.
6. Execute a validação de configuração e as migrações:

   ```powershell
   npm run check:config
   npm run db:migrate
   ```

   `check:config` faz verificação offline de campos e coerência, sem confirmar credenciais nos provedores. O exemplo contém valores incompletos de propósito e não deve passar sem preenchimento. O acesso real ao banco é exercitado pelas migrações.

7. No mesmo ambiente, configure `ADMIN_NAME`, `ADMIN_EMAIL` e `ADMIN_PASSWORD` com os dados do responsável. A senha deve ter pelo menos 12 caracteres e no máximo 72 bytes. Crie o primeiro administrador:

   ```powershell
   npm run db:seed-admin
   ```

   Não existe login ou senha padrão. Se o e-mail já estiver cadastrado, o comando preserva a conta existente e não redefine senha ou permissões. Remova `ADMIN_PASSWORD` do arquivo/ambiente após a criação.

8. Inicie a aplicação:

   ```powershell
   npm start
   ```

   Abra [a loja local](http://localhost:4500) e [o login administrativo](http://localhost:4500/admin/index.html). `npm start` executa `db:migrate` antes de iniciar. `npm run dev` usa observação de arquivos e requer migrações executadas previamente.

9. No painel, complete **Configurações**, crie usuários da equipe e cadastre categorias, fornecedores, produtos, estoque real e serviços. Revise os cupons existentes: as migrações incluem o cupom demonstrativo público `PETFLOW10`, com 10% de desconto; ajuste ou desative antes de abrir a loja.
10. Revise a identidade visual, os contatos públicos, os termos e a política de privacidade com os dados aprovados da loja. A tela Configurações não reescreve automaticamente todos os textos, imagens e templates estáticos. Siga o [roteiro de entrega](docs/ENTREGA-COMERCIAL.md).

### Catálogo de demonstração

Somente em banco isolado de desenvolvimento, defina `SEED_DEMO_CATALOG=true` e execute:

```powershell
npm run db:seed-catalog
```

Esse comando cria produtos, serviços, fornecedor, preços e quantidades **fictícios**, e recusa `NODE_ENV=production`. Não use esses saldos em uma loja real. Volte `SEED_DEMO_CATALOG` para `false` depois. Dados de demonstração não são necessários para criar o administrador nem para iniciar a aplicação.

## Configuração por área

Use [.env.example](.env.example) como inventário de variáveis. Nunca versionar `.env`, tokens, senhas ou URLs de conexão com credenciais.

| Área | Configuração da instalação |
| --- | --- |
| Aplicação | `NODE_ENV`, `PORT`, `APP_URL`, `FRONTEND_URL`; em produção, as URLs devem apontar para a loja em HTTPS. |
| PostgreSQL | `DATABASE_URL` ou `DB_*`, `DB_EXPECTED_NAME` e `DB_SSL`, conforme a conexão fornecida pelo hospedeiro. |
| Sessões | `JWT_SECRET` exclusivo e `JWT_EXPIRES_IN`. Alterar a chave invalida sessões e links assinados existentes. |
| PagBank | `PAGSEGURO_BASE_URL=https://api.pagseguro.com` e `PAGSEGURO_TOKEN` da conta recebedora do comprador. `PAGSEGURO_ENABLE_DEBIT=true` somente após liberação da conta. |
| E-mail | `RESEND_API_KEY`, `EMAIL_FROM` em domínio verificado e, opcionalmente, `EMAIL_TEST_TO` controlado pelo operador. |
| Imagens | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` e `MAX_FILE_SIZE`. O cloud name é o identificador técnico do ambiente. |
| Entrega | `GOOGLE_MAPS_API_KEY` para Routes API, `GOOGLE_MAPS_BROWSER_API_KEY` para Maps JavaScript API, `DELIVERY_ORIGIN_ADDRESS` completo e política `DELIVERY_*` da loja. |
| Regras operacionais | `ORDER_RESERVATION_MINUTES`, `CANCELLATION_WINDOW_MINUTES`, `CANCELLATION_MIN_DISTANCE_METERS` e `PRIVACY_POLICY_VERSION`, coerentes com a operação e o conteúdo publicado. |

O checkout envia ao PagBank as URLs de retorno e de webhook a partir de `APP_URL`. O endpoint é `/api/public/pagamentos/webhook`; deve ser público em HTTPS. Abrir o endereço de retorno não confirma um pagamento. PIX e crédito estão previstos no checkout; a disponibilidade efetiva depende da conta PagBank. A entrega comercial usa o endpoint de produção e requer ensaios financeiros controlados e autorizados pelo comprador.

## Publicação no Railway

1. Crie um projeto e um serviço PostgreSQL na conta do comprador. Publique o código em um serviço de aplicação separado, com raiz neste diretório.
2. Configure no serviço da aplicação as variáveis próprias da instalação. Referencie a conexão privada e o nome do serviço PostgreSQL; para um serviço chamado `Postgres`:

   ```text
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   DB_EXPECTED_NAME=${{Postgres.PGDATABASE}}
   ```

3. Defina `NODE_ENV=production`, as URLs HTTPS públicas, o segredo de sessão e as integrações. Ajuste as referências caso o serviço do banco tenha outro nome. Chaves dos provedores pertencem ao serviço da aplicação.
4. Use `npm start` como comando de inicialização. O [railway.json](railway.json) configura `npm run db:migrate` antes do deploy e `/api/readiness` como healthcheck. O migrador serializa as execuções e registra checksums.
5. Após a migração inicial, execute `npm run db:seed-admin` uma vez no ambiente da aplicação com os dados do comprador. Remova `ADMIN_PASSWORD` das variáveis após o uso.
6. Valide `/api/health`, `/api/readiness`, login, envio real de e-mail, upload, frete e o checklist de aceite. Ajuste domínio, restrições das chaves Google e URLs antes de abrir a loja.

`/api/health` confirma que o processo responde. `/api/readiness` confirma acesso ao banco e compatibilidade de todas as migrações do pacote. Nenhum desses endpoints testa disponibilidade de PagBank, Resend, Cloudinary ou Google Maps.

## Verificações e entrega

```powershell
npm run release:check
```

Executa sintaxe JavaScript, testes automatizados locais, links locais e auditoria das dependências de produção. A auditoria requer acesso ao registro npm. Para integração PostgreSQL, crie **outro banco vazio** com nome iniciado por `petflow_test`, configure `TEST_DATABASE_URL` e `TEST_DATABASE_NAME` no ambiente do processo e rode:

```powershell
npm run test:integration
```

O runner de integração não carrega o `.env`, recusa banco divergente/já inicializado e grava dados de teste. Use um novo banco de teste vazio em cada execução. `RUN_DB_TESTS` não substitui as duas variáveis exigidas pelo runner.

No repositório, `.github/workflows/verify.yml` configura a verificação automática no GitHub Actions em push, pull request ou execução manual: `release:check` com Node.js 22 e integração em PostgreSQL 18 descartável, com configuração sintética. A existência do workflow não comprova que ele foi executado nem aprovado. Confira a execução concluída da revisão entregue e registre o resultado; o aceite da instalação e os testes reais dos provedores continuam necessários. O workflow pertence à verificação do repositório e não é requisito para executar o ZIP.

Para gerar a entrega, use Git 2.43+, mantenha o repositório limpo e os arquivos da revisão salvos em commit, então execute:

```powershell
npm run release:package
```

O resultado em `dist/` inclui ZIP, hash SHA-256 e manifesto com versão/revisão, lista de arquivos e hash de cada arquivo. A lista de inclusão do empacotador exclui ambiente privado, banco, dependências instaladas e registros internos de produção. Confira o conteúdo antes de enviar; a verificação de padrões não substitui a revisão de segredos e dados pessoais.

Leia [Entrega comercial](docs/ENTREGA-COMERCIAL.md), [Operação](docs/OPERACAO.md) e [Aceite](docs/ACEITE.md). O código segue a [licença MIT](LICENSE); condições de implantação, treinamento e suporte devem constar na proposta aprovada.
