# geo-prospect-test-api

App Node minimalista para receber webhooks **outbound** do CRM GeoVendas (`GEO-11323`) e inspecionar os eventos. Usa Express + SQLite (`better-sqlite3`).

## Pré-requisitos

- Node 22+
- Sem build step

## Instalar

```bash
npm install
```

## Rodar

```bash
npm start
# -> http://localhost:3001
```

UI de inspeção: abra `http://localhost:3001/` no browser. Auto-refresh a cada 3s.

## Endpoints

| Método | Path | Descrição |
|---|---|---|
| `POST` | `/webhook` | Recebe payload, persiste no SQLite, responde 200 `{ ok, id }`. |
| `GET` | `/events?limit=50&offset=0&event=prospect.created` | Lista eventos paginados (DESC). |
| `GET` | `/events/:id` | Detalhe (headers + body). |
| `DELETE` | `/events` | Limpa tudo. |
| `GET` | `/health` | `{ status: "ok" }`. |
| `GET` | `/` | UI estática. |

## Configuração de teste no GeoVendas

1. Ativar flag `CRM Integrações` em **Config Modulos**.
2. React `/crm/integracoes` → criar integração com:
   - `callbackUrl = http://<ip-da-maquina>:3001/webhook`
   - Marcar Status, Webhook e os 3 eventos (Criação/Atualização/Conversão).
3. Criar/editar/converter prospect via Vue (CRM 360).
4. Conferir os eventos chegando em `http://localhost:3001/`.

## Simulação de falhas

Configurável via env (sticky pro processo) ou query param (sticky pra request):

| Env | Query | Efeito |
|---|---|---|
| `FAIL_MODE=500` | `?fail=500` | Responde HTTP 500 |
| `FAIL_MODE=401` | `?fail=401` | Responde HTTP 401 |
| `DELAY_MS=12000` | `?delay=12000` | Aguarda 12s antes de responder (testa timeout read=10s do emissor) |

Em qualquer modo o evento **ainda é persistido** com `status_returned` correspondente — útil pra cruzar com o `CRMLogIntegracao` do backend.

Exemplos:

```bash
# Roda sempre devolvendo 500
FAIL_MODE=500 npm start

# Roda em modo timeout
DELAY_MS=12000 npm start

# Por request (env limpa)
curl -X POST "http://localhost:3001/webhook?fail=500" -H "Content-Type: application/json" -d '{}'
```

## Outras envs

| Var | Default |
|---|---|
| `PORT` | `3001` |
| `DB_PATH` | `./events.db` |

## Schema (SQLite)

Tabela `events`:

| Coluna | Tipo |
|---|---|
| id | INTEGER PK AUTOINCREMENT |
| received_at | TEXT (ISO) |
| event | TEXT |
| prospect_id | INTEGER |
| cnpj | TEXT |
| ip | TEXT |
| auth_header | TEXT |
| headers_json | TEXT |
| body_json | TEXT |
| status_returned | INTEGER |

Índice em `received_at DESC` e `event`.

## Smoke test rápido

```bash
curl -X POST http://localhost:3001/webhook \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test:secret" \
  -d '{"event":"prospect.created","prospectId":42,"cnpj":"12345678000100","razaoSocial":"Empresa Teste"}'

curl http://localhost:3001/events
```
