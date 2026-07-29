# FixNote — исходный продуктовый и технический план

> Актуальный handoff на 30 июля 2026 года. Этот документ фиксирует исходную
> концепцию продукта, принятые архитектурные решения, текущее состояние и
> дальнейший порядок разработки.

## 1. Видение продукта

FixNote — personal-first AI note-taking app с пространственной организацией
контента, локальной работой, шифрованием, realtime-редактированием и AI-помощником.

Главная идея продукта:

- пользователь быстро фиксирует информацию любым удобным способом;
- система превращает сырой вход в структурированные заметки;
- заметки и другие документы можно свободно раскладывать в пространстве;
- поиск и AI помогают находить и связывать накопленные знания;
- отдельный ресурс можно расшарить другим людям без создания командного
  workspace.

FixNote не должен превращаться в тяжёлый корпоративный Notion. Основной сценарий
— личная база знаний с точечным совместным доступом.

## 2. Базовые продуктовые принципы

1. **Personal-first.** У пользователя есть личное пространство, папки и ресурсы.
   Командные workspace на первом этапе не создаются.
2. **Resource-level sharing.** Доступ выдаётся на конкретную заметку или доску с
   ролью viewer/editor.
3. **Local-first UX.** Редактирование не должно зависеть от качества сети.
   Синхронизация происходит в фоне.
4. **Spatial organization.** Домашний экран остаётся свободной поверхностью, а
   не обычным файловым списком.
5. **Minimal writing UI.** Постоянная панель форматирования не нужна. Команды
   появляются при выделении текста.
6. **AI as an action layer.** Чат не только отвечает, но и предлагает действия
   над заметками. Изменяющие данные действия требуют явного подтверждения.
7. **Encrypted persistence.** Чувствительные поля и Yjs-документы хранятся
   зашифрованными. Ключи контента защищаются envelope encryption.
8. **One canonical resource.** Web, desktop и будущий mobile используют общие
   контракты, API, realtime-протокол и модель данных.

## 3. Форматы ресурсов

### 3.1. Text Note

Минималистичный текстовый документ.

Необходимое форматирование:

- bold;
- italic;
- underline;
- strikethrough;
- quote;
- monospace;
- spoiler;
- link;
- date.

Форматирование вызывается selection popup. Постоянной toolbar быть не должно.

### 3.2. Board

FigJam-подобный документ:

- бесконечное поле;
- текст;
- sticky notes и карточки;
- свободное рисование;
- линии и связи;
- изображения и ссылки;
- перемещение и изменение размеров;
- мультивыбор;
- realtime-курсоры участников;
- разные цвета присутствующих пользователей.

Board является самостоятельным документом. Его нельзя смешивать с домашней
поверхностью, на которой лежат карточки ресурсов.

### 3.3. Будущие форматы

Архитектура должна позволять добавлять новые виды ресурсов без переделки
аутентификации, sharing, поиска и шифрования.

## 4. Домашняя пространственная поверхность

Исходный UX:

- свободное панорамирование во все стороны;
- карточки заметок и досок можно размещать в произвольных координатах;
- размеры карточек меняются;
- используется мягкое невидимое snapping-поведение без нарисованной сетки;
- карточки можно раскладывать по папкам;
- визуальный стиль остаётся спокойным и минималистичным;
- детали заметки открываются как чистый документ без тяжёлой навигации.

### Открытая продуктовая проблема

Свободная поверхность плохо масштабируется, когда ресурсов становится много:

- пользователь не понимает, в какую сторону перемещаться;
- автоматическая сортировка разрушает пространственную память;
- списки, сетки, круги и «умные кучки» решают локальную раскладку, но не
  глобальную навигацию;
- новые заметки естественно появляются в хронологическом inbox.

Эта модель **ещё не утверждена**. Перед её реализацией нужен интерактивный
прототип и проверка пользовательских сценариев.

Исследуемое направление:

- хронологический входящий поток для новых материалов;
- свободная поверхность для вручную размещённого контекста;
- временные AI/search-представления, которые вызывают нужные материалы в
  текущую область;
- возможность локально выстраивать выбранные карточки по времени;
- отделение самого ресурса от его размещения на конкретной поверхности.

Не следует начинать миграцию spatial-модели, пока не согласован UX-прототип.

## 5. Папки и организация

- Иерархические личные папки.
- Ресурс может находиться без папки.
- Перемещение между папками не меняет содержимое ресурса.
- В будущем могут появиться теги, свойства и сохранённые фильтры.
- Папки не являются workspace и не задают границу совместного доступа.

## 6. Варианты создания контента

### 6.1. Обычный ввод

Пользователь создаёт заметку или доску и редактирует её вручную.

### 6.2. AI input

Пользователь отправляет в чат сырой текст. AI:

- очищает и структурирует его;
- предлагает заголовок и формат;
- создаёт заметку только после подтверждения;
- позволяет продолжать редактирование через диалог.

### 6.3. URL input

Система различает:

- обычную web-страницу;
- YouTube/video URL.

Для страницы сохраняются источник, metadata, preview и структурированное
содержание. Для видео требуется transcript, summary и ссылка на таймкоды.

### 6.4. Voice input

- запись звука;
- сохранение исходного аудио;
- transcription через Whisper-совместимый сервис;
- AI-структурирование транскрипта;
- возможность прослушать запись внутри заметки.

## 7. AI-чат

### 7.1. Поведение интерфейса

- В спокойном состоянии чат представлен небольшой плавающей кнопкой/input.
- При начале взаимодействия элемент плавно перемещается вправо.
- Справа раскрывается фиксированная плавающая панель чата.
- Панель не должна полностью блокировать рабочее пространство.
- История диалога сохраняется.

### 7.2. Возможности

- создавать заметки из диалога;
- переименовывать и редактировать текущий ресурс;
- выполнять разрешённые действия через proposal/confirm flow;
- отвечать на вопросы по личной базе заметок;
- показывать источники ответа;
- работать в глобальном или resource-scoped режиме.

### 7.3. Безопасность AI-действий

- AI сначала создаёт proposal.
- Пользователь подтверждает или отклоняет proposal.
- Только подтверждённый proposal изменяет данные.
- История, metadata и proposal payload хранятся зашифрованными.

## 8. Поиск и RAG

Поиск должен покрывать:

- заголовки;
- текст заметок;
- текстовые узлы board;
- metadata импортированных материалов;
- в будущем — transcripts и OCR.

Первый этап использует PostgreSQL/Supabase:

- `tsvector` для полнотекстового поиска;
- `pgvector` для semantic search;
- hybrid ranking;
- отдельные chunks для текстовых board nodes с `nodeId`;
- переход к найденному board node из результата.

Текущий fallback при недоступных embeddings — быстрый lexical search.

### Privacy trade-off

Содержимое chunk хранится зашифрованным, однако `tsvector` и embeddings являются
производными от открытого текста и доступны стороне базы данных. Это не строгая
zero-knowledge модель. Перед production необходимо явно принять эту модель
угроз либо разработать client-side/private search.

## 9. Realtime и sharing

- Yjs является общей CRDT-моделью документов.
- Hocuspocus используется как realtime transport/server.
- Yjs state сохраняется на сервере зашифрованным.
- Presence/awareness не должен сохраняться как документ.
- Board показывает курсоры и выделения участников.
- Sharing работает на уровне ресурса.
- Роли первого этапа: owner, editor, viewer.
- Приглашение выдаётся ссылкой/email и может быть отозвано.
- Должны быть проверены reconnect, offline edits и конфликтное редактирование.

## 10. Шифрование

Текущая модель:

- для ресурса генерируется отдельный DEK;
- поля ресурса и Yjs state шифруются DEK;
- DEK оборачивается versioned KEK;
- папки используют отдельные DEK;
- пользовательский AI history использует profile home DEK;
- AAD привязывает ciphertext к entity, field и schema version;
- KEK хранится только в server environment;
- `.env` никогда не коммитится.

На 29 июля 2026 года dev fallback KEK был заменён на постоянный случайный KEK.
Существующие resource, folder и profile DEK были транзакционно rewrap-нуты.

Будущая production-ротация должна:

- создавать новую версию KEK;
- некоторое время сохранять предыдущую версию для чтения;
- rewrap-нуть DEK;
- после проверки удалить старый KEK;
- не пере-шифровывать всё содержимое без необходимости.

## 11. Техническая архитектура

Монорепозиторий:

```text
apps/
  api/          NestJS REST API
  desktop/      React + Vite + Tauri 2
  realtime/     Hocuspocus/Yjs server

packages/
  contracts/    общие DTO и Zod-контракты
  crypto/       envelope encryption и AAD
  database/     Prisma schema/client
  search/       общие search projections и indexing
  sync/         Yjs schemas и room naming
```

Текущий backend:

- NestJS;
- Prisma;
- Supabase Postgres;
- Supabase Auth;
- Supabase Vector/pgvector;
- Hocuspocus + Yjs;
- server-side encrypted persistence.

Будущие клиенты:

- web-приложение в этом же monorepo;
- hybrid mobile client;
- общие contracts/sync/search модели без копирования бизнес-логики.

## 12. Текущее состояние

### Реализовано или существенно подготовлено

- monorepo и общие packages;
- Tauri desktop shell;
- Supabase Auth;
- личные папки;
- spatial home и карточки ресурсов;
- text note editor;
- board editor;
- импорт и preview ссылок/изображений;
- encrypted resources/folders/Yjs state;
- realtime server и Yjs persistence;
- resource sharing backend;
- полнотекстовые search projections;
- индексация title, note body и board text nodes;
- backfill существующего search index;
- encrypted persistent AI history;
- AI proposals и подтверждение действий;
- global/resource AI scopes;
- lexical fallback при недоступном embeddings service.

### Частично реализовано

- realtime collaboration требует полноценного двухпользовательского E2E;
- board presence/cursors требуют UX-polish и проверки;
- AI использует mock provider в локальной конфигурации;
- vector embeddings не заполняются без отдельного embeddings provider;
- URL ingestion пока ограничен preview/metadata;
- search UX не завершён для перехода к точному board node;
- offline/local-first поведение требует системного тестирования.

### Не реализовано полностью

- production LLM provider;
- production embeddings provider;
- полноценный URL/YouTube ingestion pipeline;
- voice capture + Whisper + audio storage;
- AI-редактирование тела заметки через подтверждённые proposals;
- tags/properties/saved filters;
- утверждённая масштабируемая spatial/inbox модель;
- web client;
- mobile client;
- production observability, rate limiting и billing controls.

## 13. Приоритетный roadmap

### Этап A — подтвердить продуктовую модель

1. Создать UX-прототип полного сценария:
   capture → inbox → организация → повторный поиск → AI recall.
2. Проверить сценарий на 20, 100 и 1000 ресурсов.
3. Решить, отделяем ли `Resource` от `Placement`.
4. Только после этого менять schema spatial home.

### Этап B — закончить Search + RAG vertical slice

1. Подключить удалённый embeddings provider.
2. Заполнить embeddings существующих chunks.
3. Реализовать hybrid ranking и контролируемый fallback.
4. Добавить search results UI.
5. Добавить переход к точному месту заметки/board node.
6. Подключить production LLM.
7. Проверить ответы по заметкам с citations.

### Этап C — закончить collaboration

1. E2E с двумя реальными Supabase users.
2. Viewer/editor permissions.
3. Realtime cursors и selections.
4. Invite, accept и revoke flow.
5. Reconnect и offline conflict tests.

### Этап D — ingestion

1. Асинхронные ingestion jobs.
2. Web article extraction.
3. YouTube metadata/transcript/summary.
4. Voice recording, object storage и transcription.
5. Повторные попытки, idempotency и ошибки в UI.

### Этап E — hardening

1. Security review шифрования и search privacy.
2. Rate limits и AI cost limits.
3. Backup/restore и key rotation procedure.
4. Audit production Supabase configuration.
5. Telemetry, structured logs и crash reporting.
6. Tauri packaging, updater и release pipeline.

### Этап F — новые клиенты

1. Web client.
2. Hybrid mobile client.
3. Общий offline cache и sync semantics.
4. Push/share/deep-link сценарии.

## 14. Ближайшее решение

Не начинать новые крупные backend-фичи до короткого продуктового прототипа
масштабируемого spatial/inbox поведения. После решения этой модели следующий
законченный технический вертикальный срез:

```text
capture
→ encrypted persistence
→ full-text/vector indexing
→ search
→ AI answer with citations
→ confirmed AI action
```

## 15. Проверка проекта

Основные команды:

```powershell
pnpm install
pnpm test
pnpm typecheck
pnpm build
pnpm desktop:tauri dev
```

Maintenance:

```powershell
pnpm search:backfill
pnpm encryption:rewrap
```

`encryption:rewrap` нельзя повторно запускать без понимания текущей версии KEK и
плана ротации.
