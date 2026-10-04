# Migração profissional do PetFlow original

Este pacote preserva os módulos exclusivos do PetFlow original: pets, serviços, agenda, funcionários, consultas, prontuários, vacinas e lembretes.

Ele adiciona a base de dados criada no PetFlow v2 para:

- baixa idempotente de estoque;
- frete e rastreamento GPS;
- cupons;
- notificações administrativas e de pedidos;
- reserva temporária de estoque;
- cancelamento e reembolso;
- auditoria;
- consentimentos e solicitações LGPD;
- atendimento, arrependimento, devolução e reclamação;
- revogação de sessões.

## Arquivos SQL

Execute na ordem numérica:

1. `106_pagamento_processado.sql`
2. `107_frete_rastreamento.sql`
3. `108_cupons.sql`
4. `109_notificacoes_entregas.sql`
5. `110_admin_profissional.sql`
6. `111_lgpd.sql`
7. `112_atendimento_consumidor.sql`

Não copie nem execute `105_remover_funcionarios.sql` do PetFlow v2. Essa migração pertence somente à versão de varejo e removeria um módulo necessário do sistema original.

## Opção recomendada: terminal do VS Code

Faça backup antes. Depois, no diretório do PetFlow original:

```powershell
npm run db:migrate
```

O executor registra cada arquivo e seu checksum em `schema_migrations`. Se uma migração aplicada for alterada depois, a execução é bloqueada para evitar divergência de produção.

## Opção pelo pgAdmin

1. Abra o banco correto.
2. Faça backup.
3. Abra o Query Tool.
4. Abra cada arquivo SQL na ordem acima.
5. Execute o arquivo inteiro.
6. Interrompa caso algum comando falhe.
7. Não execute em outro banco sem confirmar a conexão.

Executar somente o SQL cria a estrutura, mas não adiciona automaticamente as telas, controllers e serviços. Use o `PROMPT-PETFLOW-ORIGINAL.md` para implementar os fluxos correspondentes antes de disponibilizá-los ao público.

## Railway

Cadastre as variáveis descritas em `.env.example` no serviço da aplicação. Para o PostgreSQL, use a referência privada do próprio projeto:

```text
DATABASE_URL=${{Postgres.DATABASE_URL}}
DB_EXPECTED_NAME=${{Postgres.PGDATABASE}}
```

Não use `DATABASE_PUBLIC_URL` na comunicação interna entre aplicação e banco. Não cadastre chaves de Google, Resend, PagBank ou Cloudinary dentro do serviço PostgreSQL.

O `railway.json` executa as migrações antes do deploy. Antes do primeiro deploy dessa atualização, mantenha um backup recuperável do banco.
