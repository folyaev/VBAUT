# AGENTS.md

Документ для разработчиков и код-агентов проекта `VBAUT`.
Цель: быстро понять архитектуру, рабочий процесс и правила безопасных правок.

## 1) Что это за проект

`VBAUT` — редакторский инструмент для сценариев:
- загрузка текста вручную или из Notion;
- сегментация по темам и сегментам;
- блоки ссылок по темам;
- AI-помощь для визуалов/поиска;
- ручные медиазагрузки через `yt-dlp`;
- экспорт в `JSONL`, `MD`, `XML (xmeml)`.

## 2) Компоненты

- `frontend/` — React + Vite (`http://localhost:5173`)
- `frontend/src/components/ReleaseWorkspace.jsx` — координатор release-контурa
- `frontend/src/components/ReleaseWorkspaceOverview.jsx` — overview ассистента, рекомендации, draft pack
- `frontend/src/components/ReleaseWorkspaceBoard.jsx` — статусная доска выпуска
- `frontend/src/components/ReleaseWorkspaceRundown.jsx` — редакторский rundown и bulk-действия
- `frontend/src/components/ReleaseWorkspaceTimeline.jsx` — лента событий выпуска
- `frontend/src/components/NewsOpsStorageHealth.jsx` — отдельный reliability/storage health блок, вынесенный из `App.jsx`
- `frontend/src/components/NewsOpsOwnerDashboard.jsx` — owner-level сводка: focus release, pressure, reliability, next actions
- `frontend/src/components/NewsOpsSourceIntelligence.jsx` — отдельный `News Ops` блок для source profiles и memory-слоёв
- `frontend/src/components/NewsOpsOverview.jsx` — отдельный `News Ops` обзор: stats, assets, bot sessions, releases, needs visual
- `frontend/src/components/AppHeroHeader.jsx` — верхний shell-блок `App.jsx`: theme toggle, document status и recent docs
- `frontend/src/components/AppNewsOpsSection.jsx` — shell-обёртка `News Ops` с lazy-loading внутренних dashboard/overview/storage/source intelligence panels
- `frontend/src/components/ScenarioBlocksHeader.jsx` — header/action-shell секции `Блоки сценария`
- `frontend/src/components/ScenarioLinksPanel.jsx` — panel `Все ссылки сценария`, вынесенный из блока `Блоки сценария`
- `frontend/src/components/ScenarioGroupHeadingSearchPanel.jsx` — group-level heading search panel (`RU/EN query`) внутри секции сегментов
- `frontend/src/components/ScenarioGroupHeader.jsx` — group-level header темы: title row, ready toggle, AI/heading/XML actions и expand toggle
- `frontend/src/components/ScenarioGroupContent.jsx` — раскрытое содержимое группы: `LinksCard`, `segments-grid` и `show more` footer
- `frontend/src/components/ScenarioGroupSection.jsx` — контейнер одной группы сегментов, который собирает header, heading-search panel и expanded content
- `frontend/src/components/SegmentVisualEditor.jsx` — visual/media editor внутри `SegmentCard`: visual params, media picker и video timecodes
- `frontend/src/components/SegmentResearchToolbar.jsx` — toolbar внутри `SegmentCard`: search generate/toggle и fast/deep research actions
- `frontend/src/components/SegmentResearchHeader.jsx` — header/history selector внутри `SegmentCard`: run summary, `Copy Brief` и выбор research run
- `frontend/src/components/SegmentLinkedReleasePanel.jsx` — linked release / release snapshot block внутри `SegmentCard`: `Linked Release`, `Release Item Snapshot`, pair badges и quick release actions
- `frontend/src/components/SegmentResearchBrief.jsx` — `Research Brief` внутри `SegmentCard`: brief cards, current pair summary, guidance/phase hints и main/backup preset actions
- `frontend/src/components/SegmentResearchResultsPanel.jsx` — ranked research surface внутри `SegmentCard`: tabs/filters, quick promote actions, warnings, ranked list и compare view
- `frontend/src/components/SegmentSearchQueriesPanel.jsx` — search query editor/list внутри `SegmentCard`: textarea запросов, engine actions, copy и clear-search button
- `frontend/src/hooks/useUiAuditQueue.js` — служебный hook для UI audit batching/listeners: queue, throttling, visibility flush и DOM event wiring
- `frontend/src/hooks/useMediaManager.js` — media operational hook: media state, refresh/polling, queue/download helpers, job-status notifications и `yt-dlp` version/update
- `frontend/src/hooks/useCollaborativeSession.js` — collaborative session hook: fingerprint/revision tracking, autosave и session-save helper
- `frontend/src/hooks/useScenarioGroups.js` — derived-state hook для grouped segments, scenario links, needs visual и sync локального group UI-state
- `frontend/src/hooks/useReleaseBoardState.js` — release-side derived-state hook для selection sync, board filter/counts, summary, orphan screenshots и local assistant findings
- `frontend/src/hooks/useReleaseWorkspaceData.js` — release-side read-state hook для selected release detail, assistant/recommendations/draft/checklist/control/briefing/activity loaders и polling/effect orchestration
- `frontend/src/hooks/useReleaseAssistantActions.js` — release-side assistant action hook: orphan/recommendation/visual-gap flows, bulk selection actions, item-level prepare/draft/fill и release-level `prepare/air-ready/publish/draft-pack`
- `frontend/src/hooks/useReleaseMutations.js` — release-side mutation hook для `create/attach/detach/update/reorder` и `update release item`, чтобы обычные release writes тоже не жили inline в `App.jsx`
- `frontend/src/components/NewsroomWorkspace.jsx` — отдельный workspace для `Inbox / Library / Releases`
- `frontend/src/components/ScenarioEditorPanel.jsx` — оболочка сценария/Notion-загрузки
- `frontend/src/components/MediaHistoryPanel.jsx` — оболочка панели медиазагрузок и `yt-dlp` статуса
- `frontend/src/components/ReleaseProducerMode.jsx` — компактный producer/on-air экран для localhost/ngrok
- `frontend/src/components/ReleaseOnAirMode.jsx` — крупный эфирный экран с fullscreen, live clock, countdown, ticker, publish snapshot и hotkeys
- `backend/src/routes/research.js` — API research по сегментам
- `backend/src/services/research-store.js` — хранение `research.json`
- `backend/src/services/research-search.js` — безопасный поиск через `SearxNG`
- `backend/src/services/research-qwen.js` — query generation/ranking через текущий OpenAI-compatible endpoint
- `backend/src/services/research-ranker.js` — merge scoring, montage-aware ranking и summary research runs, включая phase summary и pass-items для deep research
- server-side `Research Brief` теперь умеет и explicit backup picks (`Backup Source`, `Backup Visual`) поверх основных best-picks
- segment-side `Research Brief` в карточке сегмента теперь использует ту же pair-терминологию, что и release flow: `Main Source / Main Visual / Backup Source / Backup Visual`, плюс `Current Pair` с drift-hint, если deep-pair уже закреплён.
- там же есть и явные segment-level actions: `Promote Main Pair / Promote Backup Pair`, `Use Main Source / Use Main Visual / Use Backup Source / Use Backup Visual`.
- там же есть и явный feedback action `Helpful`: можно отметить research candidate как удачный без `Promote/Apply`; это пишет explicit signal в `source-memory`.
- research candidate cards теперь также показывают human-readable memory badges (`Helpful before`, `Used before`), а raw technical tags вроде `helpful:*` / `used_before:*` в UI не дублируются.
- server-side `Research Brief` теперь тоже может нести короткий `memory_hint`, чтобы release/segment brief surfaces и markdown export показывали reuse-signal не только через score/reason_tags.
- `NewsOpsOwnerDashboard.jsx` теперь также показывает top source-memory signal (`Helpful xN` / `Used xN`) и может использовать его в `Suggested Session` / `Next Actions`, а не только считать число learned domains.
- markdown/txt export для `research/brief` тоже теперь pair-aware: печатает `Current Pair`, `Main Picks` и `Backup Picks`.
- release-level `Segment Research Briefs` в overview и markdown export тоже теперь используют pair-aware язык: `Current Pair`, `Main Source / Main Visual`, `Backup Source / Backup Visual`.
- release markdown handoff для `Segment Research Briefs` также печатает отдельный `Pair Drift`, чтобы текстом передавать не только current pair, но и её интерпретацию.
- release-level `Copy Brief` в overview теперь привязан к конкретному `run_id` brief-а, а не к абстрактному latest-run сегмента.
- там же появился и `Open Run`: release overview умеет открыть исходный сегмент уже с тем research run, на котором построен текущий brief.
- там же появились и `Pin Run / Unpin Run`: release может закреплять конкретный research run как рабочую основу segment brief-а.
- release export/handoff тоже теперь знает про это: markdown печатает `Pinned Run`, а JSON `research_briefs` содержит `is_pinned` и `pinned_run_id`.
- release handoff (`shotcard`, `media package`, `copy plan`) теперь предпочитает явные `backup_source / backup_visual` из `Research Brief`; provenance различает `Backup Source / Backup Visual` и generic fallback.
- release-level `Segment Research Briefs` в overview тоже показывают explicit `Backup Source / Backup Visual`, если они уже есть у сегмента.
- segment-side `Release Item Snapshot` тоже показывает `Backup Source / Backup Visual`, если release research уже подготовил запасной вариант по этому сюжету.
- из `Release Item Snapshot` в карточке сегмента теперь можно сразу сделать `Use Backup Source` / `Use Backup Visual`, не открывая release workspace.
- из того же `Release Item Snapshot` теперь можно и сразу применить основные picks: `Use Main Source` / `Use Main Visual`.
- там же есть и `Promote Main Pair`: one-click применение основного source+visual к связанному release item.
- там же есть и `Promote Backup Pair`: one-click переключение связанного release item на backup source+visual.
- `Release Item Snapshot` также показывает `Current Source / Current Visual`, то есть какая pair сейчас реально активна на release item.
- там же показывается и `Current Pair`: `Main Pair / Backup Pair / Mixed Pair / Custom Pair`.
- рядом с `Current Pair` есть и drift-hint, то есть короткое объяснение, почему pair main/backup/mixed/custom.
- segment snapshot и rundown inspector также показывают последнее `pair switch` событие и время: `Research pair applied`, `Research source updated`, `Research visual updated` или `Manual override`.
- `Release Overview -> Segment Research Briefs` тоже умеет pair switching: оттуда можно жать `Promote Main Pair` и `Promote Backup Pair`.
- там же есть и частичные overrides: `Use Main Source / Use Main Visual / Use Backup Source / Use Backup Visual`.
- `backend/src/services/source-profiles.js` — единый source of truth для trusted/blocked/downloadable доменов
- `backend/src/services/source-memory.js` — память по реально использованным source/result доменам и URL
- `backend/src/services/release-outcome-memory.js` — память по удачным release-выборам ассетов, доменов, kind и роли
- `backend/src/services/integration-sqlite.js` — SQLite mirror поверх integration JSON-store
- `scripts/start-searxng-local.ps1` — локальный безопасный bootstrap `SearxNG` через Docker
- `scripts/stop-searxng-local.ps1` — остановка и удаление локального `SearxNG`-контейнера
- `backend/` — Express API (`http://localhost:8787`)
- `backend/src/services/telegram-sdvg-bot.js` — Telegram long-polling бот для `/sdvg` (опционально)
- `HeadlessNotion/` — парсер Notion (опционально)
- `data/` — документы и версии
- `MediaDownloaderQt6-5.4.2/` — локальные бинарники `yt-dlp`/`ffmpeg` (если используются)

## 3) Быстрый запуск

```powershell
npm install
npm --prefix backend install
npm --prefix frontend install
npm run dev
```

Если нужен Notion-бот в отдельном окне:

```powershell
npm --prefix HeadlessNotion install
.\start-dev.cmd
```

## 4) Важные данные документа

Для каждого `doc_id`:
- `data/<doc_id>/document.json`
- `data/<doc_id>/document.vN.json` (снимки при изменении текста сценария)
- `data/<doc_id>/segments.json`
- `data/<doc_id>/decisions.json`
- `data/<doc_id>/research.json`
- `data/<doc_id>/events.jsonl`
- `data/<doc_id>/*.vN.json` (versioned snapshots)
- глобальный API audit: `data/_audit/api-requests-YYYY-MM-DD.jsonl`
- глобальный UI audit: `data/_audit/ui-actions-YYYY-MM-DD.jsonl`
- `data/source-profiles.json`
- `data/source-memory.json`
- `data/release-outcome-memory.json`
- `data/_integration/integration.sqlite` (mirror-индекс, включая `doc_documents`, `doc_segments`, `doc_decisions`, `doc_media_downloads`)

Ключевые поля:
- в `segments.json`: `segment_id`, `block_type`, `text_quote`, `section_id`, `section_title`, `is_done`
- в `decisions.json`: `visual_decision`, `search_decision`, `search_decision_en`
- в `research.json`: `run_id`, `segment_id`, `queries`, `results`, `ranked_results`, `summary`, `applied`
- в `ranked_results`: `bucket`, `montage_score`, `source_kind`, `visual_hints`, `reason`
- в `ranked_results`: также `memory_usage_count`, `similarity_score`, `similarity_hits`, `reason_tags`
- в `source-profiles.json`: `trusted_domains`, `blocked_domains`, `downloadable_domains`, `screenshot_friendly_domains`, `domain_profiles`
- в `source-memory.json`: `domains`, `urls`, `recent`
- в `source-memory.json`: доменные stats теперь также держат `helpful_count` для явного editor feedback по удачным research-кандидатам
- этот же `helpful_count` теперь также участвует в release-side recommendation scoring: `release recommendations` и item-level assistant picks сильнее приоритизируют домены, которые редактор уже отмечал как `Helpful`
- в `Release Workspace -> Recommended Assets` этот signal теперь также виден отдельными badge’ами (`Helpful Before`, `Used Before`), а не только внутри reason summary
- top recommendation cards теперь также показывают короткую explain-line для batch action, чтобы было видно, почему кандидат попадает в `Attach Top 3`
- рядом с `Attach Top 3` теперь также есть компактный preview-список: видно, какие именно три ассета сейчас прикрепятся, с bucket и memory hint
- `Attach Top 3` теперь идёт через мини-confirmation state: preview можно открыть, снять один из кандидатов и затем выполнить `Attach Selected`, а backend route принимает явный список `asset_ids`
- после `Attach Selected` preview теперь также показывает result breakdown: что реально `Attached`, что было `Skipped`; backend route возвращает `selected_ids`, `attached_ids`, `skipped_ids` и per-item `results`
- тяжёлые frontend-панели (`News Ops`, `NewsroomWorkspace`, `ScenarioEditorPanel`, `MediaHistoryPanel`, `Producer/OnAir`) теперь lazy-loaded через `React.lazy`, чтобы основной Vite bundle не держал весь UI в одном chunk
- верхний shell `App.jsx` тоже подчищен по JSX-объёму: hero/header и `News Ops` shell вынесены в `AppHeroHeader.jsx` и `AppNewsOpsSection.jsx`, а `LazySectionFallback` живёт в отдельном shared component.
- в `source-memory.json`: также `patterns` для similarity memory по похожим сегментам
- в `release-outcome-memory.json`: `domains`, `kinds`, `roles`, `recent`
- `News Ops -> Source Memory` — read-only сводка по реально использованным доменам и recent actions
- `News Ops -> Source Profiles` — UI-редактор этих правил, пишет через `PUT /api/source-profiles`
- `doc_documents` — mirror текущего `document.json` state для SQLite-first document/media/generation reads
- для XML-кейса: `visual_decision.media_file_path`, `visual_decision.media_file_paths`, `visual_decision.media_file_timecodes`

Флаги audit:
- `API_AUDIT_LOG_ENABLED` (default `1`)
- `API_AUDIT_LOG_INCLUDE_HEALTH` (default `0`)
- `UI_ACTION_AUDIT_ENABLED` (default `1`)

## 5) XML-экспорт (без Python)

Реализован в backend (Node.js).

Эндпоинт:
- `GET /api/documents/:id/export?format=xml` — весь документ
- `GET /api/documents/:id/export?format=xml&scope=section&section_id=...`
- также поддержан `section_title=...` для экспорта одной темы

Как собирается XML:
- формат: `xmeml` (FCP XML);
- берутся не-`links` сегменты с валидным `media_file_path`/`media_file_paths`;
- путь проверяется через safe resolve внутри media root;
- длительность: `duration_hint_sec`, иначе `XML_EXPORT_DEFAULT_DURATION_SEC`;
- FPS: `XML_EXPORT_FPS`;
- размер секвенции: `1920x960`;
- для видео+аудио используется общий `file id` (важно для корректного relink в Premiere);
- встроены базовые motion templates размеров (`1920x960`, `960x960` и др.).
- для видео-сегментов поддержан `media_start_timecode` (legacy) и `media_file_timecodes` (таймкод на каждый файл).
- если у сегмента несколько файлов, в XML они кладутся параллельно (V1/V2/...) с общей длительностью сегмента.
- `out` вручную не задается: рассчитывается автоматически как `in + duration_hint_sec`.

Переменные окружения:
- `XML_EXPORT_FPS` (по умолчанию `50`)
- `XML_EXPORT_DEFAULT_DURATION_SEC` (по умолчанию `5`)
- `XML_SECTION_MARKER_DURATION_SEC` (по умолчанию `2`)
- `XML_SECTION_GAP_SEC` (по умолчанию `0`)

Текущие правила motion:
- `3840x*` -> `scale 45`;
- `3840x3840` -> `scale 25`;
- любые квадратные источники центрируются как `960x960` (позиция `480x480` в sequence-space).

Поведение по no_visual:
- если у сегмента нет привязанного `media_file_path`/`media_file_paths`, в XML добавляется пауза по длительности сегмента (gap), чтобы тайминг не схлопывался.

Разделение тем в общем XML:
- проставляются sequence markers на старте каждой темы (section), чтобы было удобно прыгать между темами в монтажке.

## 6) Медиазагрузка

- только вручную по кнопке;
- через `yt-dlp` (+ `ffmpeg` при необходимости);
- root-папка: `MEDIA_DOWNLOAD_ROOT` (обычно `C:\Users\Nemifist\YandexDisk\PAMPAM`);
- события и статусы пишутся в `events.jsonl`.
- в UI есть проверка версии `yt-dlp` и ручное обновление (`yt-dlp -U`);
- обновление `yt-dlp` не запускается при активных задачах загрузки.

## 7) Кодировка (критично)

Все текстовые файлы должны быть в UTF-8.

Правила:
- предпочтительно использовать `apply_patch` для правок;
- если запись через PowerShell, всегда явно указывать UTF-8;
- не оставлять “кракозябры” в UI-строках и документации.

Проверки:

```powershell
npm run guard:encoding
npm run guard:ui:utf8
npm run guard:ci
npm run guard:encoding:staged
```

CI:
- `.github/workflows/guard-encoding.yml` запускает `guard:encoding` и `guard:ui:utf8`.
- В защищенной ветке этот check должен быть обязательным (required status check).

## 8) Проверки после правок

Frontend:

```powershell
npm --prefix frontend run build
```

Backend:

```powershell
node --check backend/src/index.js
npm --prefix backend test
```

## 9) Правила изменения поведения

- не ломать существующий UX без явного запроса;
- делать минимальные целевые правки;
- при добавлении новых кнопок/фич — обновлять `README.md` и этот `AGENTS.md`;
- для новых API обязательно добавлять понятную ошибку и успешный статус.

Дополнительно по сегментации:
- `POST /api/documents/:id/segments:generate` возвращает `segmentation_diff` (added/changed/same/removed/preserved_manual).
- При `Новый сценарий` на фронте есть подтверждение, если состояние не сохранено.
- При загрузке документа фронт поднимает последний `research run` по каждому сегменту из `research.json`.
- В UI сегмента можно переключаться между последними `research run` без повторного запуска поиска.
- В UI сегмента есть `research compare mode`: выбор до 3 кандидатов и сравнение по score/components/actions.

## 10) Актуальный путь XML

Прод-путь — Node.js backend экспорт `XML (xmeml)` без Python-зависимостей.

## 11) Telegram SDVG-бот

Назначение:
- команда `/sdvg` выдаёт один незавершенный сегмент (`is_done = false`);
- поддержан порядок выдачи: по очереди и случайный (`/sdvg random` или кнопка режима);
- кнопка `✅` отмечает текущий сегмент как готовый (`is_done = true`) и автоматически отправляет следующий;
- пока не нажаты кнопки `Следующий сегмент` или `✅`, входящие текст/медиа в чате привязываются к текущему сегменту;
- текст уходит в `visual_decision.description` (в этом режиме это же поле считается комментарием);
- ссылка запускает существующий `MediaDownloader` (`yt-dlp`) с прогрессом;
- медиа-файлы из Telegram скачиваются в папку темы и пишутся в `visual_decision.media_file_paths`.

Переменные окружения:
- `TELEGRAM_BOT_TOKEN` — токен бота;
- `TELEGRAM_SDVG_ENABLED` — включение бота (`1/0`);
- `TELEGRAM_SDVG_DOC_ID` — фиксированный документ для `/sdvg` (опционально);
- `TELEGRAM_SDVG_POLL_TIMEOUT_SEC` — timeout long polling;
- `TELEGRAM_BASE_API_URL` — base URL Bot API (по умолчанию `https://api.telegram.org/bot`, для локального сервера: `http://127.0.0.1:8081/bot`);
- `TELEGRAM_BASE_FILE_URL` — base URL скачивания файлов (опционально; для локального сервера обычно `http://127.0.0.1:8081/file`);
- `TELEGRAM_LOCAL_STORAGE_PREFIX` — префикс абсолютного `file_path` локального Bot API (по умолчанию `/var/lib/telegram-bot-api/`);
- `TELEGRAM_DOCKER_COPY_FALLBACK` — fallback через `docker cp` при `404` от `/file` (по умолчанию `1`);
- `TELEGRAM_DOCKER_CONTAINER_NAME` — имя контейнера локального Bot API для fallback (по умолчанию `tgbotapi`).

## 12) Integration Layer

Первый шаг объединения `VBAUT + utmanager` идёт через backend integration-layer.

Что уже считается частью этого слоя:
- `data/_integration/assets.json`
- `data/_integration/attachments.json`
- `data/_integration/releases.json`
- `data/_integration/bot-sessions.json`
- `data/_integration/jobs.json`
- `data/_integration/activities.json`
- `data/_integration/integration.sqlite`

Producer mode:
- query params `?mode=producer&release=<release_id>` открывают компактный remote-view выпуска;
- экран рассчитан на localhost/ngrok и показывает control panel, briefing, checklist, rundown и timeline с автообновлением.
- query params `?mode=onair&release=<release_id>` открывают эфирный экран с главным статусом выпуска, блокерами, rundown и fullscreen-пультом.

API:
- `GET /api/documents/:id/segments/:segmentId/research`
- `POST /api/documents/:id/segments/:segmentId/research`
- `POST /api/documents/:id/segments/:segmentId/research/apply`
- `GET /api/integration/overview`
- `GET/POST /api/assets`
- `GET/PATCH /api/assets/:id`
- `POST /api/assets/:id/attachments`
- `PATCH /api/assets/:id/attachments/:attachmentId`
- `DELETE /api/assets/:id/attachments/:attachmentId`
- `GET/POST /api/releases`
- `GET/PATCH /api/releases/:id`
- `POST /api/releases/:id/rundown`
- `GET /api/releases/:id/assistant-pass`
- `GET /api/releases/:id/recommendations`
- `GET /api/releases/:id/draft-pack`
- `GET /api/releases/:id/publish-checklist`
- `GET /api/releases/:id/control-panel`
- `GET /api/releases/:id/briefing`
- `GET /api/releases/:id/activity`
- `POST /api/releases/:id/assistant-actions/attach-orphan-screenshots`
- `POST /api/releases/:id/assistant-actions/attach-recommendations`
- `POST /api/releases/:id/assistant-actions/fill-missing-visuals`
- `POST /api/releases/:id/assistant-actions/fill-selection-visuals`
- `POST /api/releases/:id/assistant-actions/apply-draft-pack`
- `POST /api/releases/:id/assistant-actions/apply-selection-draft-pack`
- `POST /api/releases/:id/assistant-actions/update-selection-items`
- `POST /api/releases/:id/assistant-actions/update-selection-asset-status`
- `POST /api/releases/:id/assistant-actions/apply-selection-note-templates`
- `POST /api/releases/:id/assistant-actions/detach-selection-items`
- `POST /api/releases/:id/assistant-actions/prepare-selection`
- `POST /api/releases/:id/assistant-actions/prepare-release`
- `POST /api/releases/:id/assistant-actions/mark-air-ready`
- `POST /api/releases/:id/assistant-actions/publish-release`
- `GET /api/releases/:id/export?format=md|json`
- `GET /api/integration/sqlite/status`
- `POST /api/integration/sqlite/reindex`
- `GET /api/integration/backups/status`
- `POST /api/integration/backups/create`
- `GET /api/integration/backups/:backupId`
- `POST /api/integration/backups/:backupId/restore-dry-run`
- `POST /api/integration/backups/:backupId/restore`
- `GET/PUT /api/bot/sessions`

Надёжность:
- перед `sqlite reindex` и крупными assistant mass-actions backend теперь создаёт `auto_backup` recovery-point, если `RUNTIME_AUTO_BACKUP_ENABLED` не равен `0`.
- restore теперь стал реальным recovery flow: backend создаёт `pre-restore-*` snapshot, закрывает SQLite mirror, восстанавливает `data/` из выбранного backup и затем пересобирает SQLite-first state с диска.
- в `News Ops -> Storage Health` выбранный backup теперь можно не только inspect/dry-run, но и реально `Restore Snapshot`.
- runtime backups теперь ещё и хранят `restore history`: последний restore и недавние recovery entries видны в `Storage Health`.

Правило:
- не переносить сразу source of truth документов из `data/<doc_id>/*.json`;
- integration-layer пока служит общим индексом и связующим слоем для мегааппа.
- SQLite mirror не заменяет JSON-store, а синхронизируется после изменений как persistent-index для следующего этапа миграции.
- первые SQLite-first чтения уже включены: `GET /api/integration/overview` и `GET /api/assets` читают через mirror с fallback на JSON-store.
- release workspace тоже уже частично сидит на SQLite-first path: `GET /api/releases`, `GET /api/releases/:id`, `GET /api/releases/:id/activity` и release export читают через mirror с fallback на JSON-store.
- release assistant/readback hot-path тоже подчищен: после mass assistant-actions и в fallback recommendation helpers `release` теперь читается через общий SQLite-first helper вместо прямого `integrationStore.getRelease(...)`.
- `GET /api/bot/sessions` тоже уже читает через SQLite-first path; для mirror есть debug-endpoint `GET /api/integration/jobs`.
- assistant memory тоже зеркалится в `integration.sqlite`: `source profiles`, `source memory`, `release outcome memory`.
- research routes, `News Ops` memory endpoints и recommendation-heavy release flows читают assistant memory через SQLite-first wrappers с fallback на JSON-store.
- `source profiles` читаются из mirror-таблиц списков/overrides, а summaries `source memory` / `release outcome memory` считаются SQL-агрегациями, чтобы `News Ops` и assistant memory tooling меньше зависели от загрузки полного JSON.
- `research_runs` тоже зеркалятся в `integration.sqlite`; `GET /api/documents/:id`, `GET /api/documents/:id/segments/:segmentId/research` и `GET /api/documents/:id/segments/:segmentId/research/brief` читают их через SQLite-first wrappers с fallback на `research.json`.
- `document.json` тоже уже зеркалится в SQLite (`doc_documents`); document/media/export routes читают document state через mirror-first helper, а document/generation writes синхронизируют его после записи.
- document export теперь и `segments/decisions` берёт через SQLite-first document context helpers, а не через прямой file-first read как основной путь.
- `documents` и `generation` routes теперь тоже читают текущие `segments/decisions` через SQLite-first document context helpers, а прямое file-first чтение там оставлено только как fallback.
- segment research и document reuse-by-Notion тоже читают document state через тот же mirror-first helper.
- Telegram SDVG bot тоже использует mirror-first document/media getters вместо прямого `document.json` как основного пути.
- bot-side current-state reads для `segments/decisions` тоже идут через injected SQLite-first document context helpers; прямой `segments.json` / `decisions.json` там оставлен только как fallback.
- bot-side writes в `segments/decisions` после `/sdvg` действий теперь сразу пересинхронизируют SQLite document context, чтобы mirror не оставался stale.
- запись `document.media_downloads` после завершения download job теперь тоже идёт через mirror-first document getter перед сохранением, а не через прямой file-first read `document.json`.
- release/integration handoff-side `document.media_downloads` теперь тоже сначала берутся через injected mirror-first document getter, а прямой `document.json` там остался только последним fallback.
- release-side document context в `integration routes` теперь тоже поднимается через общий SQLite-first helper для `segments/decisions`, чтобы `research briefs` и fallback assistant diagnostics не дублировали file-first чтения.
- release-side `research runs` в `integration routes` теперь тоже сначала берутся через injected SQLite-first getter, а прямой `research.json` там остаётся только fallback-путём.
- `documents` routes теперь тоже используют общий mirror-first helper для `document state` и общий helper для `segments/decisions`, чтобы CRUD/session/dataset paths меньше дублировали прямые file fallback’и.
- `research` routes теперь тоже используют отдельные mirror-first helper’ы для document state и `segments/decisions`, а не держат этот fallback inline в `loadSegmentContext(...)`.
- `generation` и `export` routes теперь тоже используют отдельные mirror-first helper’ы для current document state и `segments/decisions`; прямое чтение versioned snapshots там оставлено только для исторических `vN`-кейсов.
- `media` routes теперь тоже используют локальные mirror-first helper’ы для `document state` и `media_downloads`, так что `media / media:download / job / cancel / file` больше не дублируют inline fallback на `document.json`.
- `integration` release-side helper’ы теперь поддерживают и mixed fallback: `segments`, `decisions` и `research runs` могут читаться через injected SQLite-first getter’ы независимо друг от друга, а JSON используется только как запасной путь для конкретного missing/failed getter.
- сам backend safe-getter слой в `index.js` тоже теперь централизует этот pattern: array/object document getters используют общие SQLite-first + file-fallback loader’ы, а не повторяют одну и ту же логику по месту.
- запись `media_download_recorded` теперь синхронизирует не только `doc_media_downloads`, но и `doc_documents`, чтобы mirror не оставался stale по `document.updated_at` и встроенному `media_downloads` после завершения download job.
- bot-side loader слой в `telegram-sdvg-bot.js` тоже теперь централизует SQLite-first + file-fallback pattern для `document state`, `media_downloads`, `segments` и `decisions`, чтобы fallback policy там не дублировалась между helper’ами.
- `integration.js` теперь тоже держит общий release-side loader-слой для array/object document data: `segments`, `decisions`, `research runs` и fallback document-state для `media_downloads` идут через общие helper’ы, а не через разрозненные inline fallback-ветки.
- intentional file-stat fallback в `document-state.js` теперь тоже вынесен в отдельные helper’ы: так явно видно, что revision/segmentation freshness через `fs.stat` — это последний аварийный путь, а не основной storage path.
- `documents`, `export`, `generation`, `research` и `media` routes теперь используют общий service helper `document-route-loaders`; route-side mirror-first loaders для current `document state`, `segments/decisions` и `media_downloads` больше не дублируются по нескольким route-файлам.
- generic SQLite-first + file-fallback pattern теперь ещё и вынесен в общий service helper `indexed-fallback-loaders`; `index.js`, `integration.js` и bot-side loaders больше не держат собственные копии одного и того же fallback-паттерна.
- `documents/:id` и `documents/:id/state` теперь получают `revision/updated_at` через SQLite-first document summary (`doc_documents`/`doc_segments`/`doc_decisions`/`research_runs`) с fallback на file stats.
- legacy `needs_segmentation` inference теперь сначала сравнивает timestamps самого `document` и `segments`, а file stats использует только как последний fallback.
- `document.media_downloads` тоже уже зеркалятся в SQLite (`doc_media_downloads`), а handoff/media hot-path читает скачанные URL через mirror-first helper вместо прямого `document.json` как основного пути.
- Audit note по remaining file paths:
  `writeJson(document.json)` и `saveVersioned(segments/decisions/document)` остаются intentional, потому что JSON-store всё ещё source of truth.
  Чтение `segments.vN.json` / `decisions.vN.json` остаётся intentional historical snapshot path для versioned generation/realign flows.
  `research-store`, `source-memory`, `source-profiles`, `release-outcome-memory`, `integration-store` и `runtime-backups` по дизайну продолжают читать свои JSON/manifest files как source of truth или backup metadata.
  `document-route-loaders`, `integration` loaders и bot-side loaders держат file reads только как last-resort fallback, если SQLite/indexed getter недоступен или пуст.
  `document-state` file stats через `fs.stat` считаются intentional аварийным freshness/revision fallback, а не нормальным hot-path query-layer.
- segment research поддерживает два режима запуска: `fast` и `deep`; deep mode генерирует больше поисковых запросов, делает более широкий source/visual проход, сохраняет phase summary по run и добавляет `source/visual pass` items в research brief.
- в UI segment research теперь есть ещё и phase-focus: результаты можно фильтровать по `context / source / visual` pass, а каждый кандидат явно показывает, из какого research-phase он пришёл.
- phase-aware deep-research также получил one-click actions: лучший `source pass` и `visual pass` можно сразу promote’ить в решение сегмента, а лучший `context pass` — быстро attach’ить как reference/source context.
- deep-research phase summary теперь ещё и action-oriented: UI показывает короткий hint, какое следующее действие ожидается от каждого pass (`promote source`, `promote visual`, `attach context`).
- segment research brief теперь можно получать и как `md/txt` export через `GET /api/documents/:id/segments/:segmentId/research/brief?format=md|txt`; фронт использует это для `Copy Brief`.
- release-level `Segment Research Briefs` теперь умеют `Open Segment`, чтобы из brief в release overview можно было прыгнуть обратно к карточке исходного сегмента в сценарии.
- segment/release navigation стала двусторонней: release-level `Segment Research Briefs` теперь дают и `Open Release`, и `Open Segment`, чтобы связь между сценарным research и выпуском не терялась.
- если сегмент уже фигурирует в текущем release-level research brief, сама карточка сегмента тоже показывает `Linked Release` и даёт прямой jump в release flow.
- рядом с `Linked Release` карточка сегмента также показывает `Release Item Snapshot`: текущий `item_status` и закрыт ли этот сюжет по `script/visual` внутри выбранного выпуска.
- в `Release Item Snapshot` у сегмента теперь также видно короткий `handoff`-статус и, если он уже известен, `picked_from`-основание, чтобы монтажная готовность читалась без открытия `Release Workspace`.
- из `Release Item Snapshot` можно сразу открыть `Rundown` на нужном item через `Open Handoff`, не делая лишний переход через overview выпуска.
- `Release Item Snapshot` теперь ещё и показывает последний resolved handoff-event (`download/capture resolved`) с коротким временем, чтобы было видно недавние монтажные изменения прямо из карточки сегмента.
- туда же теперь подтянут и компактный `assistant trace`-hint, чтобы рядом с editorial/handoff состоянием читалось, насколько item опирается на research/recommendation и был ли manual override.
- `Release Item Snapshot` у сегмента теперь также считает `Next Action` из script/visual gaps и handoff-state, чтобы карточка подсказывала следующий рабочий шаг без входа в `Release Workspace`.
- для deep-run UI поддерживает и `Promote Deep Pair`: backend route `POST /api/documents/:id/segments/:segmentId/research/apply-bundle` применяет лучший source и лучший visual из `Research Brief` как один рабочий shortcut.
- результат такого bundle-pick сохраняется в `decisions.json` как `research_bundle_trace`, чтобы pair не терялся при обычном сохранении сессии и был доступен для дальнейшего handoff.
- `buildReleaseResearchBriefs(...)` теперь подмешивает `research_bundle_trace` в release-level briefs как `Picked Source / Picked Visual`, так что shotlist/media-package используют именно закреплённую pair.
- `deriveShotcardForReleaseItem(...)` теперь пишет и provenance-код `picked_from` (`research_bundle`, `research_brief`, `assistant_recommendation`) в shotlist/media-package, чтобы handoff был трассируемым.
- `buildMediaPackageHighlights(...)` и `ReleaseWorkspaceOverview.jsx` теперь тоже показывают этот provenance в `Copy Plan Highlights`, так что montage handoff объясним не только в export, но и прямо в UI.
- `Export Media Package` теперь включает не только `items/files`, но и `copy_plan` для монтажного handoff: что копировать, что докачивать/доскринить и в каком приоритете.
- `Export Copy Plan` — отдельный markdown-handoff по шагам подготовки файлов/захватов для монтажки; строится из `media_package.copy_plan`.
- `media_package.items`, `copy_plan` и `copy_plan_highlights` теперь несут `ready_state` (`ready`, `capture_needed`, `download_needed`, `backup_only`), чтобы handoff был прозрачен по реальному состоянию подготовки.
- release handoff теперь дополнительно reconciled на backend: `effective_ready_state` может стать `downloaded` или `captured`, если `document.media_downloads` или уже прикреплённый visual asset фактически закрыли blocker.
- при смене такого состояния integration-layer пишет release activity события `handoff_snapshot`, `handoff_download_resolved`, `handoff_capture_resolved`, так что timeline и recovery-лог уже знают о фактическом закрытии montage blockers.
- `ReleaseWorkspaceOverview.jsx` использует эти activity events и показывает у handoff-очереди/копи-плана последний resolved marker по attachment, чтобы handoff был объясним ещё и по времени закрытия блокера.
- `ReleaseWorkspaceTimeline.jsx` и overview handoff-карточки теперь дают прямой jump назад к resolved item (`Open Handoff` / `Open Resolved`), чтобы trace был не только читаемым, но и навигационным.
- `ReleaseWorkspaceRundown.jsx` теперь держит в inspector отдельный `Handoff Trace`: `ready_state`, provenance `picked source / picked visual` и последний resolved handoff event по выбранному release item.
- этот же inspector handoff-block теперь action-oriented: при `download_needed` можно сразу `Queue Download`, при `capture_needed` — сразу `Screenshot`.
- в `Handoff Trace` inspector-а также есть `Open Source`, чтобы быстро открыть исходный URL перед ручной проверкой или перед стартом handoff-действия.
- `Release Control` использует `media_package.summary` как handoff-layer: показывает `handoff_status_code`, summary по `ready_files/capture_needed/backup_steps` и quick actions по первому pending copy-plan item.
- `handoff_status_code` теперь жёстче различает монтажную готовность: `ready`, `pending_capture`, `pending_download`, `backup_only`, `no_files`.
- `publish_checklist.summary` теперь тоже хранит `editorial_ready`, `handoff_ready` и `handoff_status_code`, чтобы API/export/UI явно различали “готово к air gate” и “готово к монтажному handoff”.
- `buildHandoffQueue(...)` собирает pending `download/capture` шаги из `media_package.copy_plan`; эта очередь теперь идёт в `briefing_panel.handoff_queue` и `control_panel.handoff_queue`, а `ReleaseWorkspaceOverview.jsx` показывает её как отдельный action-oriented блок с routing по типу блокера: `Queue Download` для `download_needed`, `Screenshot` для `capture_needed`.
- `Release Briefing` использует `copy_plan` и показывает `copy plan highlights` прямо в overview/export, а не только в отдельном `media-package` JSON.
- recommendation-heavy release logic больше не тянет ассеты напрямую из JSON-store: injected asset/recommendation queries в `integration routes` уже SQLite-first, поэтому `assistant pass`, orphan screenshot scan и `release recommendations` используют mirror как основной query-layer.
- document context тоже зеркалится: `segments` и `decisions` пишутся в `integration.sqlite` на document/session/generation update.
- `buildReleaseAssistantPass` и `buildReleaseResearchBriefs` уже умеют брать document context через SQLite-first deps (`listDocSegments`, `listDocDecisions`, `listResearchRuns`) и откатываться к JSON только как fallback.
- для `buildReleaseRecommendations` есть отдельная narrowed SQLite candidate selection: она отсекает неподходящие `kind/status`, исключает текущий release и заранее поднимает same-document/recent visual/source candidates ещё до JS ranking.
- этот narrowed recommendation query теперь ещё учитывает section/domain context выпуска: SQL поднимает кандидатов из тех же section/source domain ещё до финального scoring в JS.
- item-level assistant actions (`fill_missing_visuals`, `fill_selection_visuals`, `prepare_selection`, `prepare_release`) тоже используют SQLite-first shortlist под конкретный сюжет: section/domain context и `visual/source` mode сужаются ещё до JS scoring.
- item-level shortlist ещё и research-aware: preferred domain/title из `Research Brief` поднимаются уже на SQL-слое, до финального assistant scoring.
- `assistant pass` summary для release (`ready / in progress / missing script / missing visual / needs link / screenshots`) теперь тоже идёт через SQLite-first aggregate; JS остаётся только для более сложных gap-lists.
- `assistant pass` теперь отдаёт и gap item lists (`items_without_script / items_without_visual / items_without_link`) через SQLite-first release diagnostics queries, с fallback на release JSON.
- `briefing_panel` и `control_panel` теперь используют эти indexed diagnostics lists как `diagnostic_highlights`: assistant показывает конкретные проблемные сюжеты и suggested next step, а markdown export включает этот блок.
- assistant-actions `prepare_release / prepare_selection / fill_missing_visuals / fill_selection_visuals` теперь приоритизируют release items по diagnostics gaps, а в ответах возвращают `prioritized_attachment_ids`.
- diagnostics highlights в `Release Workspace Overview` теперь умеют action-routing: `Open` переводит прямо к attachment в `Rundown`, а `Board` открывает нужный gap filter.
- diagnostics highlights в `Overview` умеют и one-click actions: `Draft/Prepare` для script gaps и `Fill/Screenshot` для visual gaps через уже существующие single-item assistant handlers.
- diagnostics highlights в `Overview` умеют и `Use Research`: если у attachment есть связанный `Research Brief`, можно применить research-backed note patch прямо из overview.
- diagnostics highlights в `Overview` умеют и точечные `Use Source` / `Use Visual`, чтобы применять отдельно script-side или visual-side research patch без перехода в inspector.
- если у diagnostics item есть и source-side, и visual-side research signal, `Overview` теперь показывает и `Promote Research` для полного research-backed patch за один клик.
- diagnostics в `Overview` также показывают short research preview (`Source` / `Visual`) рядом с action-кнопками, чтобы было видно, что именно применится до клика.
- diagnostics в `Overview` также показывают trace/confidence badges (`Research-backed`, `Recommendation-backed`, `Manual override`) из attachment trace, чтобы triage был прозрачным ещё до открытия `Rundown`.
- diagnostics в `Overview` также показывают quality hints (`Trusted Domain`, `Worked in Releases`, `Successful Asset Type`) на основе уже загруженных `source profiles` и `release outcome memory`.
- `Release Workspace Overview` also shows preflight safety hints before mass assistant actions, surfacing auto-backup state and latest recovery-point from runtime backup status.
- после mass assistant-actions `Release Workspace Overview` также показывает последний `auto_backup` и даёт `Inspect Snapshot`, чтобы recovery-point был доступен прямо из release flow.
- `News Ops` теперь включает `Storage Health`: `sqlite` size/WAL, runtime backups, snapshot inspector и `restore dry-run` diff для выбранного backup.
- `Storage Health` также показывает warnings по надёжности: disabled auto-backup, stale latest backup, large WAL и active retention policy.
- блок `Storage Health` вынесен в отдельный компонент `NewsOpsStorageHealth.jsx`, чтобы снижать риск дальнейшего разрастания `App.jsx`.
- `Owner Dashboard` также даёт quick jumps в фокусный `Release Workspace`, `Needs Visual`, `Source Intelligence` и `Storage Health`, чтобы возвращать owner-level обзор без ручного поиска по экрану.
- `Owner Dashboard` также показывает `Current Release Summary`: editorial readiness, handoff status, top diagnostic blocker и last meaningful assistant/release action по текущему выпуску.
- `Owner Dashboard` также держит `risk strip` с owner-level сигналами (`handoff blocked`, `backups off`, `storage warning`, `visual pressure high`), чтобы критичные вещи были видны без чтения детальных карточек.
- `risk strip` также даёт быстрый action-routing: owner-level риск можно сразу открыть в `Release Workspace`, `Needs Visual` или `Storage Health`, а не только прочитать.
- `Owner Dashboard` также держит `What Changed Recently`: короткий список последних важных изменений по release activity, runtime backup, SQLite sync и handoff status, чтобы owner мог быстро восстановить контекст после паузы.
- `Owner Dashboard` также предлагает `Suggested Session`: короткий 3-step маршрут действий с быстрыми jump-actions, чтобы owner не только видел состояние, но и сразу понимал, с чего начать сессию.
- блок `Source Profiles / Source Memory / Release Outcome Memory` тоже вынесен в `NewsOpsSourceIntelligence.jsx`, чтобы `App.jsx` не держал весь `News Ops` inline.
- верхний обзорный слой `News Ops` тоже вынесен в `NewsOpsOverview.jsx`, чтобы `App.jsx` не держал даже stats/cards этого раздела inline.
- раздел `Inbox / Library / Releases` тоже вынесен в `NewsroomWorkspace.jsx`; `App.jsx` теперь прокидывает туда уже собранный `releaseWorkspaceProps`, а не длинный inline JSX.
- release export поддерживает не только `md/json/shotlist`, но и `media-package`: JSON-manifest с items и списком локальных медиа-путей для монтажного handoff.
- оболочки `Сценарий` и `История Загрузок` тоже вынесены в отдельные компоненты, чтобы `App.jsx` не держал shell-секции inline.
- assistant-heavy release routes тоже переведены на `loadReleaseSafe/loadAssetSafe`, то есть читают state через mirror-first helpers с fallback на JSON-store.

Что уже пишет данные в integration-layer:
- Telegram SDVG ссылки -> `asset.kind = link`
- заметки в активном сегменте -> `asset.kind = note`
- Telegram media -> `asset.kind = telegram_media`
- `yt-dlp` загрузки и cached downloads -> `asset.kind = downloaded_media`
- ручной pick из downloaded files -> `asset.kind = downloaded_media`
- `Screenshot Lab` manual capture -> `asset.kind = screenshot`
- если `Screenshot Lab` открыт с `doc_id / release_id / segment_id`, screenshot asset сразу прикрепляется к этим target-ам

UI:
- в основном `frontend` уже есть панель `News Ops`, которая показывает overview integration-layer, свежие assets, bot sessions и releases.
- рядом с ней есть рабочая панель `Inbox / Library / Releases`: можно фильтровать assets, создавать выпуск, добавлять assets в выпуск и убирать их обратно.
- в release builder можно менять `status` и `editor_status` выпуска; внутри выпуска assets можно быстро помечать `processed/archived`.
- из library/release UI можно открыть `Screenshot Lab` уже с контекстом выбранного выпуска, чтобы новые capture сразу попадали в нужный release.
- в `News Ops` есть `Needs Visual`: сегменты без визуала, откуда можно сразу открыть `Screenshot Lab` в контексте сегмента.
- release attachments имеют `sort_order`; порядок выпуска меняется через `POST /api/releases/:id/rundown` и кнопки вверх/вниз в UI.
- release attachment теперь хранит ещё `item_status`, `script_note`, `visual_note`; это редакторские поля конкретного выпуска, а не общего asset.
- в UI над детальным списком есть `Release Board`: он группирует release items по `item_status` и даёт быстрые фильтры по пробелам (`missing_script`, `missing_visual`, `needs_link`).
- над `Release Board` есть summary-панель с агрегатами по готовности выпуска (`total`, `ready`, `in_progress`, `missing_script`, `missing_visual`, `screenshots`).
- release flow теперь собран в `Release Workspace` с табами `Overview / Board / Rundown / Timeline`; новые UI-добавления лучше класть в эту структуру.
- в `Rundown` есть bulk-selection: несколько release items можно массово помечать `ready/visual_ready`, переводить asset status в `processed/archived` или снимать из release.
- там же есть быстрый выбор `Missing Script / Missing Visual` и bulk note templates для `script_note` и `visual_note`.
- у `Rundown` есть item-level inspector: по выбранному сюжету в одном месте видны asset, notes, research brief, draft hints, trace, confidence и последние timeline-события.
- inspector умеет прямые assistant-actions `Prepare / Draft / Fill Visuals / Screenshot / Mark Ready`, а research brief внутри него теперь даёт и explicit pair/source/visual controls: `Promote Main Pair / Promote Backup Pair`, `Use Main Source / Use Main Visual`, `Use Backup Source / Use Backup Visual`.
- inspector также показывает мини-shotcard `picked source / picked visual / fallback` как быстрый монтажный handoff по каждому release item.
- export выпуска поддерживает `shotlist`: компактный монтажный список по release items с `usage_role`, `on_screen_cue`, `picked source / picked visual / fallback`, `backup_note`, `notes`, `confidence`; в JSON-export это поле лежит как `shotlist`.
- у release есть отдельный export brief: `GET /api/releases/:id/export?format=md|json|shotlist`, и кнопки `Export MD / Export JSON / Export Shotlist` в UI.
- в `Release Builder` есть `Release Assistant Pass`: он ищет дыры по выпуску (`missing_script`, `missing_visual`, `needs_link`, orphan screenshots, segments without visual`) и даёт быстрые action-кнопки.
- в `Release Builder` есть server-side `Recommended Assets`: backend предлагает кандидатов в выпуск по документному контексту, секциям, доменам и уже собранным material signals.
- рекомендации можно прикреплять по одной или bulk-кнопкой `Attach Top 3`.
- в `Release Builder` есть server-side `Draft Pack`: backend собирает черновые `script_note` и `visual_note`, а UI умеет применять их как `Fill Missing` или `Overwrite`.
- для `missing_visual` есть server-side `Fill Visual Gaps`: backend подбирает best-fit recommendation-assets, прикрепляет их в release и одновременно закрывает `visual_note` у проблемных items.
- assistant pass теперь считается на backend и используется и в UI, и в export brief; orphan screenshots можно bulk-прикрепить к release.
- release activity timeline тоже серверная: любые attach/detach/reorder/update события релиза пишутся в integration activity log и показываются в UI.
