# Микросервисы маркетплейса — учебный стенд

Учебный проект: маркетплейс из трёх узлов (фронт, сервис заказов, сервис оплаты) с RabbitMQ, Kafka, PostgreSQL, Loki, Tempo и Grafana. Один заказ прослеживается по **traceId** через API, очереди, топики, логи и трейсы.

В этом репозитории — только код и конфигурация для сборки и запуска. Обучающие материалы (план лекций, ТЗ по этапам, словарик, чек-листы и т.д.) в репо не входят и выдаются отдельно в рамках курса.

## Требования

- Docker и Docker Compose
- Порты: 3000, 5050, 5432, 5672, 8080, 8090, 15672, 3001, 3100, 3200 (и при необходимости 2181, 9092)

## Запуск

```bash
docker compose up -d
```

Первый запуск может занять несколько минут (сборка образов order-service — один образ для order-api и двух воркеров — payment-service, frontend). После старта проверьте:

```bash
docker compose ps
```

Все сервисы должны быть в состоянии `running` (или `Up`).

**После обновления кода** (например, правки в order-service или переход на расслоённую архитектуру) пересоберите образы и поднимите контейнеры:

```bash
docker compose up -d --build
```

Полностью пересобирать все контейнеры не обязательно: `--build` пересоберёт только те образы, у которых изменился контекст или Dockerfile (обычно order-api и воркеры — один общий образ из папки order-service). Остальные сервисы (postgres, rabbitmq, kafka, frontend, payment-service) пересобираются только при изменении их кода.

## Доступные интерфейсы

| Компонент      | URL                      | Назначение                          |
|----------------|---------------------------|-------------------------------------|
| **Фронтенд**   | http://localhost:3000     | Каталог, корзина, оформление заказа |
| **Order API**  | http://localhost:8080     | REST API заказов                    |
| **Swagger UI** | http://localhost:8080/api-docs | Документация API, вызов методов из браузера или Postman |
| **RabbitMQ UI**| http://localhost:15672    | Очереди и сообщения (guest/guest)  |
| **Kafka UI**   | http://localhost:8090     | Топики: `payment_requests` (Order→Payment), `order-events` (события заказов). По **traceId** можно проследить путь сообщения. |
| **pgAdmin**    | http://localhost:5050     | Подключение к БД (admin@local.host / admin) |
| **Grafana**    | http://localhost:3001     | Логи (Loki) и трейсы (Tempo), логин: admin / admin. Логи order-api, order-worker-orders, order-worker-payment-results и payment-service попадают в Loki автоматически. |

## RabbitMQ и Kafka: путь заказа и трассировка по traceId

Один заказ проходит через **оба брокера**, чтобы тестировщики могли отслеживать путь по одному **traceId** в RabbitMQ UI и Kafka UI.

1. **Фронт** → **Order API** (REST `POST /api/orders`) — заказ принимается, возвращается **202 Accepted** и заявка кладётся в RabbitMQ (`order_requests`).
2. **RabbitMQ** (`order_requests`) → **Order Worker (заказы)** забирает заявку, создаёт заказ в БД и отправляет запрос на оплату в **Kafka** (топик `payment_requests`).
3. **Kafka** (`payment_requests`) → **Payment Service** обрабатывает оплату и кладёт результат в **RabbitMQ** (очередь `payment_results`).
4. **RabbitMQ** (`payment_results`) → **Order Worker (результаты оплаты)** обновляет статус заказа и шлёт события в топик Kafka `order-events`.

Для демо по шагам можно останавливать по одному воркеру: без **order-worker-orders** копятся сообщения в `order_requests`; без **payment-service** — в Kafka `payment_requests`; без **order-worker-payment-results** — в `payment_results`. API при этом продолжает принимать заказы.

Во всех сообщениях передаётся один и тот же **traceId**. В **RabbitMQ UI** (http://localhost:15672) видны три очереди: `order_requests`, `payment_requests`, `payment_results`; в текущем потоке используются `order_requests` и `payment_results` (запросы на оплату идут через Kafka). В **Kafka UI** (http://localhost:8090) — топики `payment_requests` и `order-events`. В Loki/Grafana ищите логи по этому traceId по всем сервисам.

## Подключение к развёрнутой базе данных

База PostgreSQL запущена в Docker; порт **5432** проброшен на хост.

### Параметры подключения

| Параметр   | Значение              |
|-----------|------------------------|
| **Host**  | `localhost` (с хоста) или `postgres` (из контейнеров Docker) |
| **Port**  | 5432                   |
| **Database** | marketplace        |
| **User**  | marketplace            |
| **Password** | marketplace_secret  |

**Connection string (с хоста):**
```
postgresql://marketplace:marketplace_secret@localhost:5432/marketplace
```

### С хоста (psql, DBeaver, DataGrip и т.п.)

Укажите хост **localhost**, порт **5432**, базу **marketplace**, пользователь **marketplace**, пароль **marketplace_secret**. Пример из командной строки:

```bash
psql "postgresql://marketplace:marketplace_secret@localhost:5432/marketplace"
```

### Через pgAdmin (веб-интерфейс в Docker)

1. Откройте http://localhost:5050, войдите (**admin@local.host** / **admin**).
2. Правый клик по "Servers" → **Register → Server**.
3. Вкладка **General:** Name — например `Marketplace`.
4. Вкладка **Connection:**
   - **Host:** `postgres` (имя сервиса в Docker, не localhost)
   - **Port:** 5432
   - **Username:** marketplace
   - **Password:** marketplace_secret
   - при желании отметьте **Save password**.
5. Сохраните. В дереве: Servers → Marketplace → Databases → **marketplace** → Schemas → public → **Tables** → `orders` (поля: id, trace_id, status, amount_cents, items, error_message, created_at, updated_at).

## Сценарий «счастливого пути»

1. Откройте http://localhost:3000.
2. Добавьте товары в корзину, нажмите «Оформить заказ» (учебная ошибка — «нет»).
3. Дождитесь уведомления «Оплачено».
4. Скопируйте **Trace ID** с экрана и откройте Grafana (http://localhost:3001).
5. **Explore** → выберите **Loki** → запрос: `{service=~"order-service|payment-service"} | json | traceId="$traceId"` (подставьте свой traceId). Либо по сервису: `{service="order-service"}` или `{service="payment-service"}`.
6. **Explore** → выберите **Tempo** → вкладка **TraceQL** → вставьте в поле запроса **Trace ID для Tempo** (32 символа, hex — он есть в свёрнутом блоке на фронте после покупки) **без кавычек** → Run query. Внимание: UUID из фронта (с дефисами) в TraceQL даёт ошибку — нужен именно OTel Trace ID (без дефисов), он возвращается в ответе API и отображается в блоке «Идентификаторы для поиска в Grafana».

## Учебные ошибки (X-Test-Error)

При создании заказа можно передать заголовок **X-Test-Error** или выбрать значение в выпадающем списке на фронте:

| Значение                      | Сценарий                         |
|------------------------------|-----------------------------------|
| `order_processing_failure`   | Ошибка обработки заказа (Order Service) |
| `bank_timeout`               | Превышено время ответа от банка  |
| `payment_declined`           | Отказ в оплате (недостаточно средств) |
| `payment_service_unavailable`| Сервис оплаты недоступен         |

Тестовый эндпоинт (получить traceId для сценария без заказа):

```http
POST http://localhost:8080/api/test/trigger-error?type=order_processing_failure
```

В ответах при ошибке всегда возвращаются **traceId** и при возможности **orderId** — используйте их для поиска в Grafana и pgAdmin.

## Swagger и Postman

- **Swagger UI:** откройте http://localhost:8080/api-docs — все методы API с описанием, можно вызывать из браузера.
- **Импорт в Postman:** в Postman выберите **Import** → **Link** и укажите `http://localhost:8080/api-docs.json`, либо **Import** → **File** и загрузите JSON, полученный по GET http://localhost:8080/api-docs.json. После импорта создайте окружение с переменной `baseUrl` = `http://localhost:8080`.

## Остановка

```bash
docker compose down
```

С томами (полная очистка БД и данных):

```bash
docker compose down -v
```
