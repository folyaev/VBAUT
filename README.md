# VBAUT: локальный ассистент визуального брифа

Инструмент для редактора/сценариста: разбивает сценарий на сегменты, помогает с визуалом и поиском, хранит историю и дает совместный режим через один backend (в том числе через ngrok).

## Текущий рабочий state

Важно: если какие-то более старые bullets ниже противоречат этому блоку, ориентируйся на этот блок как на актуальное поведение.

- `Newsroom` вынесен с главной страницы на отдельный route: `http://localhost:5187/newsroom`.
- `Research` вынесен в отдельный workspace: `http://localhost:5187/research`.
- Основной `Research` workflow сейчас один: ranked list результатов, мультивыбор, `Add Selected Links`, `Искать заново`; старый `deep/main/backup pair` больше не является основным UX.
- `Research` учитывает `visual description`, `search queries/keywords`, может учитывать родительское имя темы и `theme tags`, а также не показывает дубликаты, уже лежащие в `Все ссылки` документа или в прошлых research-runs.
- У темы есть ручной research-context: `theme tags`, плюс независимые переключатели `учитывать имя темы` и `учитывать theme tags`.
- `Source Registry` редактируется из `News Ops -> Source Intelligence` и хранится в `data/source-profiles.json`; там есть `domain profiles`, `channel profiles` и `screenshot_profiles` для удачных browser presets.
- Metadata из `Source Registry` уже используются и в ranking, и в UI: badges вроде `RU blocked`, `Responsive`, `Watermarks`, `1080p`, `Lang EN` видны в research, newsroom и release UI.
- В `SDVG` research suggestions приходят отдельными сообщениями по одной ссылке с собственными кнопками.
- В `SDVG` ручной URL-flow теперь двухступенчатый:
  если ссылка скачиваемая через текущий `yt-dlp/gallery-dl` pipeline, используется обычный download-flow;
  если ссылка не скачиваемая, она сначала добавляется в `Ссылки темы`, а затем бот присылает `screenshot preview`.
- На `screenshot preview` в `SDVG`: `+` привязывает screenshot к сегменту как visual, `-` убирает preview, `✖️` делает перескрин с другими browser params.
- Нажатие `+` на research-ссылке в `SDVG` теперь запускает тот же путь, как будто пользователь сам отправил эту ссылку в сегмент.

## Downloader tools

- `yt-dlp` и `gallery-dl` версии видны в `GET /api/health` (`health.downloader_tools`) и в `GET /api/downloader/tools/versions`.
- Ручные проверки версий:
  - `GET /api/downloader/yt-dlp/version`
  - `GET /api/downloader/gallery-dl/version`
- Ручные обновления:
  - `POST /api/downloader/yt-dlp:update`
  - `POST /api/downloader/gallery-dl:update`
- Фоновая проверка версий включена по умолчанию.
- Управление через env:
  - `MEDIA_TOOL_VERSION_CHECK_ENABLED=0` отключает фоновую проверку
  - `MEDIA_TOOL_VERSION_CHECK_MS=21600000` меняет интервал проверки
  - `MEDIA_TOOL_AUTO_UPDATE_ENABLED=1` включает автообновление при отсутствии активных media jobs

## Что умеет сейчас

- Сегментация текста по блокам: `intro/news/ad/selfad/outro`.
- Сохранение и восстановление ручной структуры, включая пользовательские `_01` под-сегменты.
- Отдельные блоки ссылок по теме + общая панель всех ссылок документа.
- AI Help по теме/сегменту (визуал и поисковые запросы).
- Segment Research Assistant: безопасный web-research по сегменту через `SearxNG` + ранжирование на твоём текущем Qwen/OpenAI-compatible endpoint, теперь с режимами `fast` и `deep`; `deep` делает более широкий source/visual проход, сохраняет phase summary по run и показывает отдельные pass-candidates в research brief.
- В UI `Deep Research` теперь можно разбирать и по фазам `context / source / visual`: у кандидатов виден phase-tag, а список можно фильтровать не только по `Top Sources / Top Visuals / Downloadables`, но и по research-pass.
- Для фазового deep-research теперь есть и быстрые actions: `Promote Source Pass Top`, `Promote Visual Pass Top`, `Attach Context Pass Top`, чтобы брать лучший результат конкретного pass одним кликом.
- У phase summary теперь есть и action hints: рядом видно рекомендуемое следующее действие по каждому pass (`promote source`, `promote visual`, `attach context`).
- Segment research brief теперь можно вытаскивать и вне UI через `GET /api/documents/:id/segments/:segmentId/research/brief?format=md|txt`, а в UI есть `Copy Brief`.
- Server-side `Research Brief` теперь отдаёт не только `Best Source / Best Visual / Best Download`, но и явные `Backup Source / Backup Visual`, чтобы deep research быстрее превращался в рабочую source+fallback раскладку.
- В самой `Segment Research` карточке brief теперь использует ту же pair-терминологию, что и release flow: `Main Source / Main Visual / Backup Source / Backup Visual`, а если deep-pair уже закреплён, там же показывается `Current Pair` с drift-hint.
- Там же теперь есть и pair/source/visual actions: `Promote Main Pair / Promote Backup Pair`, `Use Main Source / Use Main Visual / Use Backup Source / Use Backup Visual`, без перехода в release flow.
- В карточке `Segment Research` теперь есть и явный feedback action `Helpful`: можно отметить research candidate как удачный без `Promote/Apply`, а `source memory` и ranking потом используют этот сигнал как отдельный confidence-hint.
- В самих research candidate cards теперь видны и human-readable memory badges (`Helpful before`, `Used before`), так что reuse-сигналы читаются прямо в ranked list, а не только в `News Ops`.
- Тот же memory-signal теперь подмешивается и в server-side `Research Brief`: brief cards, release-side research briefs и markdown/txt export могут показывать короткий `memory_hint`, а не только score/domain.
- `Owner Dashboard` теперь тоже читает `source memory` не только как счётчик доменов: он показывает top memory signal (`Helpful xN` / `Used xN`) и может подсказывать reuse-first шаг в `Suggested Session` / `Next Actions`.
- Server-side markdown/txt export для `research/brief` теперь тоже явно печатает `Current Pair`, `Main Picks` и `Backup Picks`, а не только общий список best-picks.
- Release-level `Segment Research Briefs` в overview/export теперь тоже используют этот язык: `Current Pair`, `Main Source / Main Visual`, `Backup Source / Backup Visual`.
- В release markdown handoff для `Segment Research Briefs` теперь есть и отдельная строка `Pair Drift`, чтобы было видно не только текущую пару, но и её смысл (`Aligned with main picks`, `Using backup picks` и т.д.).
- `Copy Brief` в `Release Overview -> Segment Research Briefs` теперь копирует не просто latest brief сегмента, а именно тот `run_id`, который сейчас привязан к release-level brief.
- Там же есть и `Open Run`: можно открыть исходный сегмент уже с выбранным research run, на котором построен release-level brief.
- И там же теперь есть `Pin Run / Unpin Run`: release может явно зафиксировать конкретный research run как основу brief-а, а не жить только по latest-run.
- Release markdown/json export теперь тоже отражает pinned-state: handoff видит `Pinned Run`, а в `research_briefs.items[]` приходят `is_pinned` и `pinned_run_id`.
- Release-side shotcard, `media package` и `copy plan` теперь сначала используют явные `backup_source / backup_visual` из `Research Brief`, а уже потом падают обратно на generic fallback-кандидаты; provenance при этом различает `Backup Source / Backup Visual` и старый `Fallback`.
- В `Release Overview -> Segment Research Briefs` теперь тоже видны не только `Best Source / Best Visual`, но и явные `Backup Source / Backup Visual`, если deep research уже собрал запасной вариант по сегменту.
- В карточке сегмента `Release Item Snapshot` теперь тоже показываются `Backup Source / Backup Visual`, если у связанного release item уже есть explicit backup picks из research.
- Оттуда же теперь можно и сразу применить их: `Use Backup Source` / `Use Backup Visual` используют release-side `research_pick` flow без перехода в release workspace.
- В том же `Release Item Snapshot` теперь можно и сразу применить основные research picks: `Use Main Source` / `Use Main Visual`, не уходя в release workspace.
- Там же появился и shortcut `Promote Main Pair`: одним действием применяются и основной source, и основной visual для связанного release item.
- И аналогично для запаса: `Promote Backup Pair` одним действием переводит release item на backup source+visual связку.
- `Release Item Snapshot` теперь ещё и показывает `Current Source / Current Visual`, чтобы было видно, какая pair реально стоит на release item после promote/use действий.
- Там же теперь есть и быстрый статус `Current Pair`: `Main Pair / Backup Pair / Mixed Pair / Custom Pair`.
- Рядом с `Current Pair` теперь есть и drift-hint: короткое объяснение вроде `Aligned with main picks`, `Using backup picks`, `Mixed main + backup`, `Recommendation-backed override`.
- Segment snapshot и rundown inspector теперь также показывают последнее `pair switch` событие: `Research pair applied`, `Research source updated`, `Research visual updated` или `Manual override`, с временем.
- В `Release Overview -> Segment Research Briefs` теперь тоже можно прямо переключать pair: `Promote Main Pair` и `Promote Backup Pair` работают без перехода в inspector.
- Там же теперь есть и точечные actions: `Use Main Source / Use Main Visual / Use Backup Source / Use Backup Visual`.
- В `Release Overview -> Segment Research Briefs` теперь есть и `Open Segment`, чтобы из release-level brief быстро прыгать обратно к исходному сегменту сценария.
- Навигация стала двусторонней: из segment research можно идти в release flow, а в `Release Overview -> Segment Research Briefs` теперь есть и `Open Release`, и `Open Segment`.
- В самой карточке сегмента теперь тоже видно `Linked Release`, если сегмент уже участвует в текущем выпуске, и оттуда можно сразу открыть release flow.
- Там же теперь есть и `Release Item Snapshot`: видно `item_status` и закрыт ли по выпуску `script`/`visual`, не открывая сам `Release Workspace`.
- `Release Item Snapshot` в карточке сегмента теперь показывает ещё и короткий монтажный `handoff`-статус (`Ready / Capture Needed / Download Needed / Downloaded / Captured`) и, если есть, основание выбора (`Research Brief`, `Research Bundle`, `Assistant Recommendation`).
- Из `Release Item Snapshot` теперь можно и сразу нажать `Open Handoff`, чтобы открыть связанный item прямо в `Release Workspace -> Rundown`.
- Там же теперь виден и последний resolved handoff event по сюжету, например `Download resolved` или `Capture resolved`, с относительным и коротким временем.
- В этот же snapshot теперь подтянут и короткий `trace`-hint: видно, был ли item `research-backed`, `recommendation-backed`, `assistant-updated` или уже был `manual override`.
- Snapshot у сегмента теперь также подсказывает `Next Action`: например `Draft`, `Fill Visuals`, `Queue Download`, `Screenshot` или `Mark Ready`, чтобы было понятно, что делать дальше без открытия выпуска.
- Кнопки поиска по сегментам и по заголовкам:
  - RU: `VK`, `VK Video`, `Copy and Perplexity`
  - EN: Reuters / AFP / NY Post / WTHR13 / Independent (YouTube channel search)
- Ручная загрузка медиа (через `yt-dlp`, до 1080p) в папки тем.
- Telegram SDVG-бот (`/sdvg`) для выдачи незавершенных сегментов и привязки описаний/медиа из чата.
- Выбор одного или нескольких медиафайлов на сегмент.
- Проверка версии и ручное обновление `yt-dlp` из UI.
- Очередь загрузок, ограничение частоты, проверка дублей, прогресс (0/20/40/60/80/100), журнал событий.
- Экспорт в `JSONL`, `MD` и `XML (xmeml)`.
- Integration layer для мегааппа: общие `assets`, `releases`, `bot sessions` и `attachments` через backend API.
- `News Ops` панель в основном UI: обзор integration-layer, последние `assets`, bot sessions и `releases`.
- Под integration-layer теперь поднят SQLite mirror: JSON-файлы остаются source of truth, а `data/_integration/integration.sqlite` служит быстрым persistent-индексом.
- `GET /api/integration/overview` и `GET /api/assets` уже идут по SQLite-first path с fallback на JSON-store.
- release-path тоже частично переведён на SQLite-first: `GET /api/releases`, `GET /api/releases/:id`, `GET /api/releases/:id/activity` и `export` читают через mirror с fallback на JSON-store.
- mirror-first чтение release теперь используется и глубже в assistant/recommendation hot-path: после mass-actions и во fallback recommendation helpers `release` поднимается через единый SQLite-first helper, а не напрямую из JSON-store.
- `GET /api/bot/sessions` тоже идёт по SQLite-first path, а для mirror появился debug API `GET /api/integration/jobs`.
- assistant-heavy release actions теперь тоже читают release/asset state через mirror-first helpers, а не через прямые JSON-чтения.
- assistant memory тоже уже зеркалится в SQLite: `source profiles`, `source memory`, `release outcome memory`.
- research, `News Ops` memory endpoints и release recommendations теперь читают assistant memory по SQLite-first path с fallback на JSON-store.
- `Source Memory` и `Release Outcome Memory` summary в `News Ops` теперь собираются SQL-агрегациями из mirror-таблиц, а `source profiles` восстанавливаются из mirror-списков/overrides, а не только из raw JSON state.
- `Source Memory` теперь хранит и явный editor feedback `helpful_count`: этот сигнал виден в `News Ops -> Source Memory`, зеркалится в SQLite mirror и подмешивается в research ranking как отдельный reuse/confidence boost.
- этот же `helpful_count` теперь также участвует в release-side recommendation scoring: `release recommendations` и item-level `fill visuals / prepare` сильнее поднимают домены, которые редактор уже отмечал как `Helpful`.
- в `Release Workspace -> Recommended Assets` этот signal теперь также виден отдельными badge’ами (`Helpful Before`, `Used Before`), а не только внутри reason summary.
- top recommendation cards теперь ещё и показывают короткую explain-line для batch action: видно, почему именно этот кандидат попадёт в `Attach Top 3`.
- рядом с `Attach Top 3` теперь есть и компактный preview-список: видно, какие именно три ассета сейчас будут прикреплены, с bucket и memory hint.
- `Attach Top 3` теперь работает через мини-confirmation state: preview можно открыть, снять один из кандидатов и затем запустить `Attach Selected`, а backend route принимает явный список `asset_ids`.
- после `Attach Selected` preview теперь показывает и result breakdown: что реально `Attached`, что было `Skipped`, а backend route возвращает `selected_ids`, `attached_ids`, `skipped_ids` и per-item `results`.
- тяжёлые frontend-панели (`News Ops`, `NewsroomWorkspace`, `ScenarioEditorPanel`, `MediaHistoryPanel`, `Producer/OnAir`) теперь lazy-loaded через `React.lazy`, так что основной Vite bundle снова ушёл ниже chunk warning threshold.
- верхний shell `App.jsx` тоже стал тоньше: hero/header вынесен в `frontend/src/components/AppHeroHeader.jsx`, shell `News Ops` — в `frontend/src/components/AppNewsOpsSection.jsx`, а lazy fallback живёт в `frontend/src/components/LazySectionFallback.jsx`.
- action-header секции `Блоки сценария` теперь тоже вынесен в `frontend/src/components/ScenarioBlocksHeader.jsx`.
- panel `Все ссылки сценария` теперь тоже живёт отдельно в `frontend/src/components/ScenarioLinksPanel.jsx`, чтобы блок `Блоки сценария` меньше разрастался внутри `App.jsx`.
- group-level heading search panel (`RU/EN query` по заголовку темы) теперь тоже вынесен в `frontend/src/components/ScenarioGroupHeadingSearchPanel.jsx`.
- header каждой группы сегментов теперь тоже вынесен в `frontend/src/components/ScenarioGroupHeader.jsx`: title row, ready toggle, AI/heading/XML actions и expand toggle больше не живут inline в `App.jsx`.
- раскрытое содержимое группы сегментов тоже вынесено в `frontend/src/components/ScenarioGroupContent.jsx`: `LinksCard`, `segments-grid` и footer `Показать ещё`.
- сама одна группа сегментов теперь собирается через `frontend/src/components/ScenarioGroupSection.jsx`, так что `App.jsx` в map по группам держит уже один контейнерный компонент вместо трёх отдельных subblocks.
- grouped-segments derived state тоже больше не живёт целиком в `App.jsx`: `frontend/src/hooks/useScenarioGroups.js` собирает `groupedSegments`, `allScenarioLinks`, `segmentsNeedingVisual`, `headingRuEngines` и синхронизирует group-level UI state (`expanded/render-limits/heading queries`).
- release-side board/view-model тоже частично вынесен из `App.jsx`: `frontend/src/hooks/useReleaseBoardState.js` держит selection sync, filtered release assets, board counts, summary, orphan screenshots и local assistant findings.
- release-side read-state orchestration теперь тоже частично вынесен из `App.jsx`: `frontend/src/hooks/useReleaseWorkspaceData.js` держит selected release detail, assistant/recommendations/draft/checklist/control/briefing/activity loaders и release polling/effect orchestration.
- release-side assistant actions теперь тоже в основном вынесены из `App.jsx`: `frontend/src/hooks/useReleaseAssistantActions.js` держит orphan/recommendation/visual-gap flows, bulk selection actions, item-level prepare/draft/fill и release-level `prepare/air-ready/publish/draft-pack`.
- обычные release mutations теперь тоже частично вынесены из `App.jsx`: `frontend/src/hooks/useReleaseMutations.js` держит `create/attach/detach/update/reorder` и `update release item`.
- внутри `SegmentCard` тоже началась реальная декомпозиция: visual/media editor теперь живёт в `frontend/src/components/SegmentVisualEditor.jsx`, а не целиком inline в `App.jsx`.
- search/research toolbar внутри `SegmentCard` тоже теперь вынесен в `frontend/src/components/SegmentResearchToolbar.jsx`: generate queries, toggle search, `Research` и `Deep`.
- research header/history selector внутри `SegmentCard` тоже вынесен в `frontend/src/components/SegmentResearchHeader.jsx`: summary по run, `Copy Brief` и выбор сохранённого research run.
- linked release / release snapshot block внутри `SegmentCard` теперь тоже вынесен в `frontend/src/components/SegmentLinkedReleasePanel.jsx`: `Linked Release`, `Release Item Snapshot`, pair badges и quick release actions больше не лежат inline в `App.jsx`.
- `Research Brief` внутри `SegmentCard` теперь тоже вынесен в `frontend/src/components/SegmentResearchBrief.jsx`: brief cards, current pair summary, guidance/phase hints и main/backup preset actions.
- ranked research surface внутри `SegmentCard` теперь тоже вынесен в `frontend/src/components/SegmentResearchResultsPanel.jsx`: tabs/filters, quick promote actions, warnings, ranked list и compare view.
- search query editor/list внутри `SegmentCard` теперь тоже вынесен в `frontend/src/components/SegmentSearchQueriesPanel.jsx`: textarea запросов, engine actions, copy и clear-search button.
- служебный UI audit queue/listener block теперь тоже вынесен из `App.jsx` в `frontend/src/hooks/useUiAuditQueue.js`: batching, throttling, visibility/beforeunload flush и DOM event listeners больше не висят inline в основном компоненте.
- media operational block теперь тоже вынесен из `App.jsx` в `frontend/src/hooks/useMediaManager.js`: media state, refresh/polling, queue/download helpers, job-status notifications и `yt-dlp` version/update flow собраны в отдельный hook.
- collaborative session bookkeeping теперь тоже частично вынесен из `App.jsx` в `frontend/src/hooks/useCollaborativeSession.js`: fingerprint/revision tracking, autosave и session-save helper больше не живут inline в основном компоненте.
- `research runs` тоже индексируются в `integration.sqlite`: document preload (`GET /api/documents/:id`) и segment research reads (`GET .../research`, `GET .../research/brief`) теперь идут по SQLite-first path с fallback на `research.json`.
- сам `document.json` теперь тоже зеркалится в SQLite как `doc_documents`; document/media/generation/export hot-path'ы используют mirror-first getter для document state, а document/session/generation updates синхронизируют его после записи.
- document export теперь тоже берёт `segments` и `decisions` через SQLite-first document context helpers, а не через прямой file-first read как основной путь.
- `documents` и `generation` routes теперь тоже читают текущие `segments/decisions` через SQLite-first document context helpers, а прямое file-first чтение там осталось только fallback-путём.
- segment research и document reuse-by-Notion path тоже уже используют тот же mirror-first document getter, а не прямой `document.json` как основной путь.
- Telegram SDVG bot тоже переведён на mirror-first document/media getters: document state и `media_downloads` в нём теперь идут через injected SQLite-first helpers с fallback на файл.
- bot-side current-state reads для `segments/decisions` тоже идут через injected SQLite-first document context helpers; прямой `segments.json` / `decisions.json` там оставлен только как fallback.
- bot-side writes в `segments/decisions` после `/sdvg` действий теперь сразу пересинхронизируют SQLite document context, чтобы mirror не оставался stale.
- запись `media_downloads` после успешной загрузки теперь тоже использует тот же mirror-first document getter перед сохранением, а не прямое file-first чтение `document.json`.
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
- revision/updated_at для `GET /api/documents/:id` и `GET /api/documents/:id/state` теперь тоже считаются через SQLite-first document summary, а file-stat fallback остаётся только запасным путём.
- legacy-inference `needs_segmentation` теперь тоже сначала опирается на поля самого `document/segments` (`updated_at/created_at`) и только потом падает обратно на file stats.
- `document.media_downloads` теперь тоже зеркалятся в `integration.sqlite` как `doc_media_downloads`, а handoff/media routes используют их через SQLite-first getter вместо прямого чтения `document.json` как основного пути.
- Audit note по remaining file paths:
  `writeJson(document.json)` и `saveVersioned(segments/decisions/document)` остаются intentional, потому что JSON-store всё ещё source of truth.
  Чтение `segments.vN.json` / `decisions.vN.json` остаётся intentional historical snapshot path для versioned generation/realign flows.
  `research-store`, `source-memory`, `source-profiles`, `release-outcome-memory`, `integration-store` и `runtime-backups` по дизайну продолжают читать свои JSON/manifest files как source of truth или backup metadata.
  `document-route-loaders`, `integration` loaders и bot-side loaders держат file reads только как last-resort fallback, если SQLite/indexed getter недоступен или пуст.
  `document-state` file stats через `fs.stat` считаются intentional аварийным freshness/revision fallback, а не нормальным hot-path query-layer.
- assistant-heavy release flows тоже двинулись дальше: `assistant pass`, orphan screenshot scan и `release recommendations` теперь получают asset candidates через injected SQLite-first queries, а не через прямой JSON-store.
- `segments` и `decisions` тоже зеркалятся в `integration.sqlite`; document/session/generation routes синхронизируют их в mirror при каждом сохранении.
- `segments_without_visual` внутри `assistant pass` и `release research briefs` теперь уже читают document context через SQLite-first path с fallback на JSON-файлы.
- для `release recommendations` появился отдельный narrowed candidate query: mirror заранее отсекает `archived/failed`, текущий release, неподходящие `kind` и поднимает наверх same-document/recent visual/source candidates ещё на SQL-слое.
- narrowed query для `release recommendations` теперь учитывает и section/domain context выпуска: кандидаты из тех же section/source domain поднимаются ещё на SQL-слое до финального JS ranking.
- item-level `fill visuals / prepare selection / prepare release` теперь тоже используют SQLite-first shortlist под конкретный сюжет: section/domain context и `visual/source` mode сужаются ещё до JS scoring.
- item-level shortlist теперь ещё и `research-aware`: preferred domain/title из `Research Brief` учитываются уже на SQL-слое до финального assistant scoring.
- summary для `assistant pass` (`ready / in progress / missing script / missing visual / needs link / screenshots`) теперь тоже считается через SQLite-first release aggregate; JS оставлен для более сложных списков вроде orphan screenshots и segment visual gaps.
- `assistant pass` теперь отдаёт и indexed diagnostics lists: `items_without_script / items_without_visual / items_without_link` тоже берутся через SQLite-first gap queries с fallback на release JSON.
- `briefing` и `control panel` теперь используют эти diagnostics lists как `diagnostic highlights`: assistant показывает не только counts, но и конкретные проблемные сюжеты/следующие шаги, а markdown export включает этот блок.
- `Prepare Release`, `Prepare Selection`, `Fill Visuals` теперь обрабатывают сначала самые проблемные сюжеты из diagnostics, а в ответах assistant-actions возвращают `prioritized_attachment_ids` для трассировки порядка.
- в `Release Briefing` и `Release Control` diagnostics highlights теперь кликабельны: можно сразу открыть приоритетный сюжет в `Rundown` или перейти в соответствующий `Board` filter.
- diagnostics highlights в `Overview` теперь ещё и actionable: для script gap можно сразу `Draft/Prepare`, для visual gap — `Fill/Screenshot`, не уходя из overview.
- если для проблемного сюжета уже есть сильный `Research Brief`, diagnostics в `Overview` теперь дают и `Use Research`: можно сразу применить research-backed source/visual решение без перехода в inspector.
- diagnostics в `Overview` теперь умеют и раздельные research-actions: `Use Source` и `Use Visual`, чтобы подтягивать отдельно script-side или visual-side часть `Research Brief`.
- если в `Research Brief` есть и source, и visual, diagnostics в `Overview` теперь показывают и явный `Promote Research`: это применяет связку целиком, как в inspector сюжета.
- diagnostics в `Overview` теперь показывают и короткий research-preview рядом с action-кнопками, чтобы заранее видеть, какой `Source` и какой `Visual` будут применены.
- diagnostics в `Overview` теперь показывают и trace/confidence hints (`Research-backed`, `Recommendation-backed`, `Manual override`), чтобы было видно контекст решения ещё до перехода в `Rundown`.
- diagnostics в `Overview` теперь показывают и quality hints вроде `Trusted Domain`, `Worked in Releases`, `Successful Asset Type`, используя `source profiles` и `release outcome memory`.
- в `News Ops` появился `Storage Health`: видно `sqlite` size/WAL, последние backup snapshots и `restore dry-run` diff по выбранному snapshot.
- `Storage Health` теперь показывает и warnings: выключенный auto-backup, старый последний snapshot, большой `WAL` и активную retention policy.
- `Storage Health` вынесен в отдельный компонент `frontend/src/components/NewsOpsStorageHealth.jsx`, чтобы рост reliability UI меньше распухал внутри `App.jsx`.
- `Source Profiles`, `Source Memory` и `Release Outcome Memory` тоже вынесены в отдельный компонент `frontend/src/components/NewsOpsSourceIntelligence.jsx`, чтобы `News Ops` дальше не разрастался в монолит внутри `App.jsx`.
- верхняя обзорная часть `News Ops` тоже вынесена в `frontend/src/components/NewsOpsOverview.jsx`: статистика, последние assets, bot sessions, releases и `Needs Visual`.
- hero/header shell теперь тоже вынесен в `frontend/src/components/AppHeroHeader.jsx`, а lazy-обёртка для всего блока `News Ops` — в `frontend/src/components/AppNewsOpsSection.jsx`.
- раздел `Inbox / Library / Releases` теперь тоже вынесен в `frontend/src/components/NewsroomWorkspace.jsx`, а `Release Workspace` прокидывается туда уже единым `releaseWorkspaceProps`-объектом.
- оболочка сценария вынесена в `frontend/src/components/ScenarioEditorPanel.jsx`, а `История Загрузок` — в `frontend/src/components/MediaHistoryPanel.jsx`, чтобы `App.jsx` меньше держал служебный shell-JSX.
- Рабочая панель `Inbox / Library / Releases`: поиск по asset-памяти, создание выпуска и привязка материалов в выпуск.
- В `Release Builder` есть `rundown`: порядок материалов внутри выпуска можно менять прямо в UI кнопками вверх/вниз.
- У каждого материала внутри выпуска есть свои поля `item_status`, `script_note`, `visual_note`; они редактируются прямо в `Release Builder`.
- В `Release Builder` есть `Release Board`: группировка по `item_status` и быстрые фильтры `No Script / No Visual / No Link`.
- Над `Release Board` есть summary-панель: `Total / Ready / In Progress / No Script / No Visual / Screenshots`.
- В `Release Builder` появился `Release Workspace` с табами `Overview / Board / Rundown / Timeline`, чтобы выпуском было удобнее управлять как отдельным рабочим экраном.
- В `Rundown` есть bulk-режим: можно выбрать несколько release items и массово отметить их `ready / visual_ready`, обновить asset status (`processed / archived`) или снять из выпуска.
- В bulk-режиме есть быстрый выбор `Missing Script / Missing Visual` и шаблоны для массового заполнения `script_note` и `visual_note` по выбранным items.
- В `Rundown` появились server-side selection actions: для выбранных items можно отдельно запускать `Draft Selected` и `Fill Visuals`, не трогая весь выпуск.
- Обычные bulk-операции `Rundown` тоже переведены на backend: статусы item'ов, статусы assets, note templates и массовое снятие из выпуска теперь идут через server-side selection actions.
- В `Rundown` есть workflow preset `Prepare Selected`: он одним действием набрасывает draft notes, пытается закрыть visual gap и переводит item в рабочий статус.
- В `Rundown` у выбранного сюжета есть inspector: там видны asset, notes, trace, confidence, связанный `Research Brief`, последние timeline-события и быстрые действия `Prepare / Draft / Fill Visuals / Screenshot / Mark Ready`.
- Inspector теперь симметричен остальным research-control поверхностям: из него можно делать `Promote Main Pair / Promote Backup Pair`, а также `Use Main Source / Use Main Visual / Use Backup Source / Use Backup Visual`.
- В inspector есть мини-shotcard: `Picked Source / Picked Visual / Fallback`, чтобы по сюжету сразу видеть handoff для монтажа.
- У выпуска появился `Export Shotlist`: компактный монтажный handoff по каждому item с `usage role / on-screen cue / picked source / picked visual / fallback / backup note / notes / confidence`.
- У выпуска появился `Export Media Package`: JSON-manifest для монтажного handoff с items, списком локальных медиа-файлов/путей и приоритизированным `copy_plan`, что тянуть/готовить первым.
- У выпуска появился и `Export Copy Plan`: отдельный markdown-handoff только по шагам подготовки файлов/захватов для монтажки.
- В `media package` и `copy plan` теперь есть явный `ready_state`: `ready / capture_needed / download_needed / backup_only`, чтобы было видно точное состояние подготовки каждого элемента handoff.
- Поверх этого backend теперь пишет и `effective_ready_state`: после refresh `briefing/control/export` уже сами понимают состояния вроде `downloaded` и `captured`, а не зависят только от фронтовых эвристик.
- Когда такой blocker реально закрывается, release activity теперь фиксирует это как отдельное handoff-событие (`handoff_download_resolved` / `handoff_capture_resolved`) и хранит server-side snapshot handoff-состояния.
- В `Release Overview` у `Handoff Queue` и `Copy Plan Highlights` теперь виден и последний resolved handoff event по item, чтобы было понятно, когда именно blocker был закрыт.
- Из `Release Timeline` и этих handoff-блоков теперь можно сразу открыть конкретный resolved item, а не только видеть факт закрытия blocker.
- В inspector сюжета появился отдельный `Handoff Trace`: там видно текущий `ready state`, происхождение `picked source / picked visual` и последний resolved handoff event по item.
- Из этого же `Handoff Trace` теперь можно сразу запустить `Queue Download` или `Screenshot`, если сюжет ещё блокируется именно download/capture handoff-шагом.
- Там же теперь есть `Open Source`, чтобы перед queue/capture можно было быстро открыть оригинальный материал и проверить его вручную.
- В `News Ops` появился `Owner Dashboard`: он коротко показывает фокусный release, давление по визуалам/inbox, надёжность storage/backup и owner-level next actions.
- `Owner Dashboard` теперь ещё и даёт быстрые jump-actions: открыть фокусный release, `Needs Visual`, `Source Intelligence` и `Storage Health`.
- В `Owner Dashboard` теперь есть и `Current Release Summary`: editorial readiness, handoff status, top blocker и last assistant move по текущему выпуску.
- Там же появился `risk strip`: самые важные owner-level сигналы вроде `handoff blocked`, `backups off`, `storage warning`, `visual pressure high` видны без чтения всех карточек.
- `risk strip` теперь ещё и action-aware: критичные owner-сигналы дают быстрые кнопки в `Release Workspace`, `Needs Visual` и `Storage Health`.
- В `Owner Dashboard` появился и `What Changed Recently`: короткая лента последних важных сдвигов по release activity, backup, SQLite sync и handoff status, чтобы легче восстанавливать контекст после паузы.
- В `Owner Dashboard` теперь есть и `Suggested Session`: 3-шаговый owner-маршрут “что делать прямо сейчас” с быстрыми переходами по шагам.
- `Release Control` теперь держит и более строгий `handoff_status_code`: `ready / pending_capture / pending_download / backup_only / no_files`, чтобы монтажная готовность была видна отдельно от editorial readiness.
- `Publish Checklist` и `Release Briefing` теперь тоже различают `editorial_ready` и `handoff_ready`, так что assistant может явно сказать: редакторски выпуск уже готов, но монтажный handoff ещё висит на capture/download.
- В `Release Briefing` появился отдельный `Handoff Queue`: короткая очередь pending `download/capture` шагов с прямыми `Open / Queue Download / Screenshot` действиями по типу блокера.
- В `Overview` есть общий preset `Prepare Release`: он тем же принципом проходит по всему текущему выпуску целиком.
- В `Overview` есть `Publish Checklist` и `Mark Air Ready`: помощник показывает blocking checks и переводит выпуск в `air_ready`, только если gate проходит.
- В `Overview` появился `Release Control`: короткий статус выпуска (`not ready / almost ready / air ready / published`) и действие `Publish Release` после прохождения gate.
- В `Overview` появился `Release Briefing`: короткая сводка выпуска, риски и 3 следующих шага от помощника.
- `Release Briefing` теперь включает и `Copy Plan Highlights`: что копировать, что докачивать/доскринить и что держать как backup в первую очередь.
- `Release Control` теперь показывает и handoff-summary (`ready / capture-download / backup`) и умеет быстро открыть первый pending copy-plan item или отправить его в screenshot flow.
- В `Overview` теперь есть и preflight safety hints перед массовыми assistant-actions: видно, включён ли auto-backup и когда был последний recovery-point.
- После mass assistant-actions `Overview` теперь показывает и последний `auto_backup` с кнопкой `Inspect Snapshot`, чтобы recovery-point можно было открыть сразу из release flow.
- У выпуска есть компактный `Producer View`: отдельный remote-screen для localhost/ngrok с control, briefing, blocking checks, rundown и timeline.
- У выпуска есть отдельный `On Air View`: крупный эфирный экран с главным статусом, следующим действием, блокерами, rundown и fullscreen-режимом.
- В `On Air View` есть live clock, countdown до `air_date`, бегущий ticker и блок `Last Publish Snapshot`.
- В `On Air View` есть hotkeys (`R/P/A/U/F/O/W/H`) и автофокус на экран, чтобы работать почти без мыши.
- В карточке сегмента есть `Research`: он ищет source/visual links по сегменту и даёт действия `Source / Promote / Attach / Screenshot / Download`.
- Сохранённые `research runs` поднимаются повторно при открытии документа, так что сегментный research не теряется после reload.
- В карточке сегмента можно переключаться между последними `research runs`, а ranking теперь учитывает монтажную пригодность: `video / image / screenshot / downloadable / trusted`.
- Для deep-run в карточке сегмента есть `Promote Deep Pair`: одним действием подтягивается лучшая source+visual связка из `Research Brief`, а backend применяет её одним route `POST /api/documents/:id/segments/:segmentId/research/apply-bundle`.
- Эта пара теперь сохраняется в `decisions.json` как `research_bundle_trace`, не теряется при обычном save/reload и показывается в `Research Brief` сегмента как `Promoted Pair`.
- `release research briefs`, `shotlist` и `media package` теперь тоже подхватывают эту закреплённую пару как `Picked Source / Picked Visual`, а не только лучший расчётный research candidate.
- В `shotlist` и `media package` у `Picked Source / Picked Visual` теперь есть явный provenance (`picked_from`): видно, это `research_bundle`, `research_brief` или `assistant_recommendation`.
- Тот же provenance теперь виден и в `Release Overview`: `Copy Plan Highlights` и handoff-подсказки показывают, по какому основанию assistant тащит конкретный source/visual в монтаж.
- `Release Overview` теперь показывает рядом с handoff-подсказками ещё и `Prep state`, чтобы различать, что уже готово, что нужно доскачать, что нужно доскринить и что держится только как backup.
- У выпуска есть `release brief` экспорт в `Markdown` и `JSON` прямо из `Release Builder`.
- В `Release Builder` есть `Release Assistant Pass`: список проблем выпуска с быстрыми действиями (`Show`, `Fix First`, `Attach One`).
- `Release Assistant Pass` теперь считается на backend и доступен через API; orphan screenshot assets можно прикрепить к выпуску bulk-действием.
- У выпуска есть server-side `Recommended Assets`: backend предлагает подходящие материалы в релиз по контексту документа, секций, доменов и уже собранного rundown.
- Рекомендации можно прикреплять по одной кнопкой `Add` или bulk-действием `Attach Top 3`.
- У выпуска есть server-side `Draft Pack`: backend собирает черновые `script_note` и `visual_note` по текущему rundown, а в UI их можно применить режимами `Fill Missing` или `Overwrite`.
- Для `missing_visual` есть server-side action `Fill Visual Gaps`: он подбирает лучшие recommendation-assets, прикрепляет их к release и одновременно проставляет `visual_note` по проблемным items.
- У выпуска есть `Release Timeline`: серверная история изменений по релизу, видимая в UI.
- `Screenshot Lab` manual capture теперь сохраняет кадр как `asset.kind = screenshot` в integration-layer и возвращает `asset id` в UI.
- `Screenshot Lab` понимает `doc_id / release_id / segment_id` через query params, поэтому скрины можно сразу рождать в контексте выпуска или документа.
- В `News Ops` есть `Needs Visual`: список сегментов без визуала с быстрым запуском `Screenshot Lab` по ссылкам конкретного сегмента.
- Отдельная страница для теста превью/скриншотов ссылок: `http://localhost:8787/tools/screenshot-lab`.
- Логи `Screenshot Lab`: `data/screenshot-lab-events.ndjson` и API `GET /api/tools/screenshot-lab/logs?limit=200`.
- `Screenshot Lab` поддерживает `Manual Session` (интерактивный браузер + запись кликов + ручной capture).
- Режим совместной сессии: автосейв + автообновление у всех подключенных клиентов.

Что уже льётся в integration-layer автоматически:
- ссылки из Telegram SDVG;
- обычные текстовые заметки в активном сегменте;
- Telegram media, скачанные ботом;
- медиа, скачанные через `yt-dlp`;
- медиа, выбранные из уже скачанных файлов сегмента.
- manual capture из `Screenshot Lab`.
- manual capture из `Screenshot Lab` с контекстом `doc/release/segment`, если lab открыт из основного UI.

SQLite mirror API:
- `GET /api/integration/sqlite/status`
- `POST /api/integration/sqlite/reindex`
- `GET /api/integration/jobs`
- `GET /api/integration/backups/status`
- `POST /api/integration/backups/create`
- `GET /api/integration/backups/:backupId`
- `POST /api/integration/backups/:backupId/restore-dry-run`
- `POST /api/integration/backups/:backupId/restore`

Safety policy:
- перед `sqlite reindex` и крупными assistant mass-actions backend теперь сам делает `auto_backup`, если `RUNTIME_AUTO_BACKUP_ENABLED` не выключен.
- restore теперь делает и safety snapshot `pre-restore-*`, затем восстанавливает `data/` из выбранного backup и полностью пересинхронизирует SQLite mirror.
- в `News Ops -> Storage Health` у выбранного snapshot теперь есть `Restore Snapshot`, так что recovery можно запускать и из UI.
- у runtime backups теперь есть и `restore history`: backend помнит последние recovery-операции, а `Storage Health` показывает последний restore и недавние restore entries.

## Как устроено

- Frontend (Vite): `http://localhost:5187`
- Backend (Express API): `http://localhost:8787`
- HeadlessNotion bot (опционально): `http://localhost:3131`
- Хранилище документов: `data/` (или `DATA_DIR`)

Producer mode:

```text
http://localhost:5187/?mode=producer&release=<release_id>
```

Этот экран сделан под удалённый просмотр через ngrok и обновляет release-состояние каждые 15 секунд.

On Air mode:

```text
http://localhost:5187/?mode=onair&release=<release_id>
```

Этот режим сделан как эфирный пульт: меньше второстепенного UI, крупнее статус и есть кнопка `Fullscreen`.

Ключевая идея: **все клиенты видят одно и то же состояние, если они работают с одним backend и одним `doc_id`**.

## Требования

- Node.js 18+
- npm
- LLM endpoint в OpenAI-compatible формате (llama.cpp/vLLM/LM Studio/Ollama-wrapper)
- Для медиазагрузок: `yt-dlp` (и желательно `ffmpeg`; для TikTok fallback опционально `gallery-dl`)

## Установка

Из корня проекта:

```powershell
npm install
npm --prefix backend install
npm --prefix frontend install
npm --prefix screenshot-engine install
```

Если используете Notion-бота через `start-dev.cmd`:

```powershell
npm --prefix HeadlessNotion install
```

## Screenshot Engine (portable)

Логика скриншотов ссылок вынесена в отдельную папку: `screenshot-engine/`.

Быстрый запуск вручную:

```powershell
cd screenshot-engine
npm install
node link-screenshot.js --url "https://www.rbc.ru/" --width 2560 --height 1280 --zoom 300 > out.png
```

С cookies (JSON/Netscape):

```powershell
node link-screenshot.js --url "https://x.com/..." --cookies_path "C:\tgbotapi\VBAUT\data\cookies\x.json" > out.png
```

Для backend-роута `/api/link/screenshot` можно задать общий путь:

```powershell
$env:LINK_SCREENSHOT_COOKIES_PATH="C:\tgbotapi\VBAUT\data\cookies\x.json"
```

Для Retina (macOS) используйте большее выходное полотно, например `--width 5120 --height 2560`.

## Screenshot Lab: Manual Session

Откройте:

```text
http://localhost:8787/tools/screenshot-lab
```

Минимальный сценарий:

1. Добавьте ссылку в список.
2. Нажмите `🖱 Start Manual` (или `🖱` у нужной ссылки) - откроется браузер с persistent-профилем (если включен), иначе fallback на обычную сессию.
3. В этом окне вручную кликните cookie-баннер/логин/нужный кадр.
4. Нажмите `📷 Capture` в Screenshot Lab - кадр прикрепится к текущей ссылке.
5. `Stop Manual` завершает сессию.

События кликов и навигации можно посмотреть кнопкой `Events`.

Cookies flow:

1. В manual-окне залогиньтесь на сайт.
2. Нажмите `Save Cookies` (домены берутся из поля `Cookie domains`).
3. Нажмите `Use Globally`, чтобы этот файл сразу применился для `/api/link/screenshot` без перезапуска backend.
4. Путь также сохраняется в `VBAUT/backend/.env` как `LINK_SCREENSHOT_COOKIES_PATH`, чтобы переживать рестарты.

Статус persistent-браузера:

- `GET /api/tools/screenshot-lab/browser/status`

## Защита от кракозябр (включено)

В проекте уже добавлены:

- `.editorconfig` -> принудительный `utf-8`
- `.vscode/settings.json` -> фикс кодировки в VS Code
- `.gitattributes` -> нормализация текстовых файлов
- `encoding-guard` + pre-commit hook
- `ui-utf8-guard` для smoke-проверки ключевых UI-строк
- GitHub Actions workflow `Guard Encoding` (падает при проблемах кодировки)

Проверка вручную:

```powershell
npm run guard:encoding
```

Для staged-файлов (как в pre-commit):

```powershell
npm run guard:encoding:staged
```

Полный CI-набор локально:

```powershell
npm run guard:ci
```

Smoke-тест backend API:

```powershell
npm run test:backend
```

Установка git hooks делается автоматически через `prepare` после `npm install`.
Если нужно руками:

```powershell
npm run hooks:install
```

## Запуск

### Быстрый (2 сервиса: backend + frontend)

```powershell
npm run dev
```

### Только Screenshot Lab (standalone)

```powershell
npm run dev:screenshot-lab
```

### Windows-скрипт (3 окна: backend + frontend + HeadlessNotion)

```bat
start-dev.cmd
```

### Перезапуск с очисткой портов 8787/5187/3131

```bat
restart-dev.cmd
```

## Переменные окружения

### LLM

- `LLAMA_BASE_URL` (default: `http://127.0.0.1:8080`)
- `LLAMA_MODEL` (если пусто, берется первая модель из `/v1/models`)
- `LLAMA_MAX_TOKENS`
- `LLM_DECISION_BATCH`
- `LLM_FETCH_RETRIES`
- `LLM_FETCH_RETRY_DELAY_MS`

### Backend/Data

- `PORT` (default: `8787`)
- `DATA_DIR` (default: `./data`)
- `API_AUDIT_LOG_ENABLED` (default: `1`)
- `API_AUDIT_LOG_INCLUDE_HEALTH` (default: `0`)
- `UI_ACTION_AUDIT_ENABLED` (default: `1`)
- `RESEARCH_SEARXNG_URL` (опционально: URL вашего `SearxNG`; если не задан, research сохранит queries, но web results будут пустыми)

`Promote` в Segment Research делает bridge прямо в решения сегмента: создаёт link asset, сам определяет роль кандидата (`main source / backup / visual candidate`), добавляет запись в `research_sources` и аккуратно заполняет черновые `search_decision / visual_decision`.
- `RESEARCH_RESULTS_PER_QUERY` (default: `8`)
- `RESEARCH_REQUEST_TIMEOUT_MS` (default: `12000`)
- `XML_EXPORT_FPS` (default: `50`)
- `XML_EXPORT_DEFAULT_DURATION_SEC` (default: `5`)
- `XML_SECTION_MARKER_DURATION_SEC` (default: `2`)
- `XML_SECTION_GAP_SEC` (default: `0`)
- `TELEGRAM_SDVG_ENABLED` (default: `0`)
- `TELEGRAM_BOT_TOKEN` (токен Telegram-бота от BotFather)
- `TELEGRAM_SDVG_DOC_ID` (опционально: фиксированный `doc_id` для `/sdvg`)
- `TELEGRAM_SDVG_POLL_TIMEOUT_SEC` (default: `25`)
- `TELEGRAM_BASE_API_URL` (default: `https://api.telegram.org/bot`)
- `TELEGRAM_BASE_FILE_URL` (опционально: base URL для скачивания файлов; если пусто, вычисляется автоматически)
- `TELEGRAM_LOCAL_STORAGE_PREFIX` (default: `/var/lib/telegram-bot-api/`; префикс абсолютного `file_path` от локального Bot API, который надо отрезать)
- `TELEGRAM_DOCKER_COPY_FALLBACK` (default: `1`; при `404` на `/file` пробует `docker cp` из контейнера локального Bot API)
- `TELEGRAM_DOCKER_CONTAINER_NAME` (default: `tgbotapi`; имя контейнера для fallback-копирования)
- `LINK_SCREENSHOT_COOKIES_PATH` (опционально: путь к cookie-файлу для `/api/link/screenshot`)
- `SCREENSHOT_BROWSER_ENABLED` (default: `1`; включает persistent браузер для manual-mode)
- `SCREENSHOT_BROWSER_AUTOSTART` (default: `1`; стартовать браузер вместе с backend)
- `SCREENSHOT_BROWSER_HEADLESS` (default: `0`; для manual обычно `0`)
- `SCREENSHOT_BROWSER_MODE` (default: `launch`; `launch` = backend запускает Chrome, `connect` = подключается к уже запущенному Chrome по CDP)
- `SCREENSHOT_BROWSER_PROFILE_DIR` (путь к профилю Chromium с cookies/login/extensions)
- `SCREENSHOT_BROWSER_DEBUG_PORT` (default: `9223`; remote debugging port)
- `SCREENSHOT_BROWSER_CONNECT_HOST` (default: `127.0.0.1`; host для `connect` mode)
- `SCREENSHOT_BROWSER_CONNECT_PORT` (default: `9223`; порт для `connect` mode)
- `SCREENSHOT_BROWSER_EXECUTABLE_PATH` (опционально: путь к вашему Chrome/Chromium)
- `SCREENSHOT_BROWSER_EXTENSIONS` (опционально: список папок расширений через `;`/`,`/newline)
- `SCREENSHOT_BROWSER_EXTRA_ARGS` (опционально: дополнительные аргументы запуска Chromium)
- `SCREENSHOT_LAB_PORT` (default: `8790`; порт standalone режима `npm run dev:screenshot-lab`)

### Media Downloader

- `MEDIA_DOWNLOAD_ROOT` (default: `C:\Users\Nemifist\YandexDisk\PAMPAM`)
- `MEDIA_MAX_CONCURRENT` (default: `1`)
- `MEDIA_START_DELAY_MS` (default: `2500`)
- `MEDIA_MAX_FILES_LIST` (сколько файлов показывать в списке)
- `MEDIA_YTDLP_PATH` (явный путь к `yt-dlp`, если нужно)
- `MEDIA_FFMPEG_LOCATION` (путь к `ffmpeg` или папке `bin`)
- `MEDIA_COOKIES_PATH` (путь к `cookies.txt`, Netscape format)
- `MEDIA_COOKIES_FROM_BROWSER` (например: `chrome`)
- `MEDIA_YTDLP_PROXY` (прокси для `yt-dlp`, например `socks5h://127.0.0.1:1080`)
- `MEDIA_YTDLP_IMPERSONATE` (например `chrome`)
- `MEDIA_YTDLP_TIKTOK_EXTRACTOR_ARGS` (по умолчанию можно оставить пустым; пример: `app_info=/musical_ly/35.1.3/2023501030/0`)
- `MEDIA_TIKTOK_FALLBACK` (default: `1`; включает fallback на `gallery-dl` для TikTok)
- `MEDIA_GALLERYDL_PATH` (явный путь к `gallery-dl`, опционально)
- `MEDIA_GALLERYDL_PROXY` (прокси только для `gallery-dl`; если пусто, берется `MEDIA_YTDLP_PROXY`)

Пример (PowerShell):

```powershell
$env:LLAMA_BASE_URL="http://127.0.0.1:8080"
$env:LLAMA_MAX_TOKENS="2048"
$env:MEDIA_DOWNLOAD_ROOT="C:\Users\Nemifist\YandexDisk\PAMPAM"
npm run dev
```

## Локальный SearxNG для Segment Research

Для безопасного web-research лучше поднимать локальный `SearxNG`, а не ходить прямым роботом в обычные поисковики.

Быстрый запуск:

```powershell
npm run research:searxng:start
$env:RESEARCH_SEARXNG_URL="http://127.0.0.1:8888"
```

Остановка:

```powershell
npm run research:searxng:stop
```

Что делает стартовый скрипт:

- поднимает контейнер `vbaut-searxng`;
- пробрасывает `http://127.0.0.1:8888`;
- использует тома `data/searxng/config` и `data/searxng/cache`, чтобы настройки и кэш жили между перезапусками.

Это повторяет безопасную container-схему из официальной документации SearXNG:
https://docs.searxng.org/admin/installation-docker.html

## Source Profiles

Trusted/blocked/downloadable правила для research теперь хранятся в:

- `data/source-profiles.json`

Файл создаётся автоматически при старте backend, если его ещё нет.

Посмотреть текущую конфигурацию можно через:

```text
GET /api/source-profiles
```

Сейчас в этом файле лежат:

- `trusted_domains`
- `blocked_domains`
- `video_platform_domains`
- `social_domains`
- `downloadable_domains`
- `screenshot_friendly_domains`
- `domain_profiles`

`domain_profiles` позволяет точечно задавать домену флаги и bias’ы, например `trusted`, `downloadable`, `source_bias`, `visual_bias`, `downloadability_bias`.

Править source profiles теперь можно и из UI:

- `News Ops -> Source Profiles`

Там редактируются основные доменные списки и `domain_profiles` JSON, а сохранение идёт через:

```text
PUT /api/source-profiles
```

## Source Memory

Система теперь ведёт память по реально использованным research results:

- `data/source-memory.json`

Память пополняется, когда ты жмёшь:

- `Source`
- `Attach`
- `Screenshot`
- `Download`

Посмотреть текущую сводку можно через:

```text
GET /api/source-memory
```

В UI это видно в:

- `News Ops -> Source Memory`

Research ranking использует эту память как bonus для доменов и ссылок, которые уже сработали у тебя раньше.
Теперь туда же добавлена и similarity memory: если похожий сегмент уже успешно использовал такой источник, research поднимает его выше.
Поверх этого backend теперь копит и release-level memory:

- `data/release-outcome-memory.json`
- `GET /api/release-outcome-memory`

Туда попадают удачные assistant-выборы в release workflow: какие домены, типы ассетов и роли реально сработали в `attach recommendations / fill visuals / prepare release`. Эти данные теперь тоже участвуют в release recommendations.

В UI у кандидатов теперь есть прозрачные `reason tags`, например `trusted`, `downloadable`, `used_before:*`, `similar_segments:*`.
Также в карточке сегмента есть `compare mode`: можно выбрать до 3 research-кандидатов и сравнить их по score/components/actions рядом.

## Рабочий цикл (обычный)

1. Вставьте сценарий и создайте документ.
2. Нажмите сегментацию.
3. Проверьте темы/сегменты, правьте вручную.
4. Для нужной темы используйте `AI Help`.
5. Добавляйте/проверяйте ссылки в блоках ссылок.
6. Сохраняйте.
7. Экспортируйте `JSONL`/`MD`/`XML`.

## Integration Layer API

Первый слой объединения хранится в `data/_integration/*.json` и не заменяет текущие
`document.json / segments.json / decisions.json`.

Новые эндпоинты:

- `GET /api/integration/overview`
- `GET /api/assets`
- `POST /api/assets`
- `GET /api/assets/:id`
- `PATCH /api/assets/:id`
- `POST /api/assets/:id/attachments`
- `DELETE /api/assets/:id/attachments/:attachmentId`
- `GET /api/releases`
- `POST /api/releases`
- `GET /api/releases/:id`
- `PATCH /api/releases/:id`
- `POST /api/releases/:id/rundown`
- `PATCH /api/assets/:id/attachments/:attachmentId`
- `GET /api/bot/sessions`
- `PUT /api/bot/sessions`

Назначение:

- `assets` -> единый каталог ссылок, Telegram media, скриншотов и скачанных файлов;
- `attachments` -> привязка asset к `segment / release / document`;
- `releases` -> выпуск с `status` и `editor_status`, к которому можно прикреплять assets прямо из UI;
- `releases` -> базовая сущность выпуска;
- `bot sessions` -> контекст единого Telegram-бота.

## Режим совместной сессии

В интерфейсе есть кнопка `Collaborative Session: ON/OFF`.

Когда `ON`:

- Изменения автосохраняются на backend (debounce ~1.2 сек).
- Клиент опрашивает состояние документа (`/api/documents/:id/state`) раз в ~2.5 сек.
- Если на сервере новая ревизия и локально нет несохраненных изменений, клиент тихо подтягивает обновление.

Текущая модель синхронизации:

- **Без CRDT/OT**, режим проще.
- Конфликт-стратегия: **last write wins**.
- Если у клиента есть локальные несохраненные правки, авто-подтягивание удаленной версии не применяется (чтобы не затереть локальные изменения).

Чтобы несколько людей видели один документ:

1. Все открывают один и тот же фронт (локально или через ngrok).
2. Все загружают один и тот же `doc_id`.
3. Включают `Collaborative Session: ON`.

## Медиазагрузки (yt-dlp + TikTok fallback)

- Загрузка ручная, по кнопке у конкретной ссылки.
- Фильтр URL ограничен поддерживаемыми хостами (YouTube, X/Twitter, VK, TikTok, Vimeo и др.).
- Качество: максимально доступное до 1080p.
- Сохранение: `MEDIA_DOWNLOAD_ROOT\<ТЕМА>\...`.
- Основной движок: `yt-dlp`.
- Для TikTok при ошибке `yt-dlp` backend может автоматически попробовать `gallery-dl` (если найден в системе и `MEDIA_TIKTOK_FALLBACK=1`).
- Дубли:
  - проверка предсказанного имени файла;
  - `--download-archive` у `yt-dlp`.
- Защита от перегруза/IP:
  - последовательная очередь по умолчанию (`MEDIA_MAX_CONCURRENT=1`);
  - задержка между стартами (`MEDIA_START_DELAY_MS`);
  - retry/backoff параметры в `yt-dlp`.
- Прогресс: шагами 20%.
- События пишутся в `events.jsonl` документа (`media_download_queued`, `media_download_status` и т.д.).
- В панели загрузок есть:
  - `Версия yt-dlp` (проверка текущей версии),
  - `Обновить yt-dlp` (запуск `yt-dlp -U`).
- Обновление блокируется, если есть активные задания скачивания.

## Telegram SDVG-бот

- Команда `/sdvg` отправляет карточку следующего незавершенного сегмента (`is_done = false`).
- Текст карточки содержит только цитату сегмента.
- Кнопки в карточке показывают дополнительные поля (комментарий/описание визуала, формат, приоритет, тема).
- Кнопка `✅` отмечает текущий сегмент как готовый (`is_done = true`) и сразу присылает следующий незавершенный сегмент.
- Кнопка `Следующий сегмент` отправляет новый сегмент отдельным сообщением.
- Опция случайного порядка: `/sdvg random` или кнопка `Режим: ...` в карточке.
- Пока не нажаты `Следующий сегмент` или `✅`, входящие текст/медиа относятся к текущему активному сегменту.
- Обычный текст из чата добавляется в `visual_decision.description` (в этом режиме это же поле считается комментарием).
- Ссылка в сообщении запускает текущий `yt-dlp` пайплайн backend и показывает прогресс в Telegram.
- Фото/видео/аудио/документы из Telegram скачиваются в папку темы и прикрепляются к `visual_decision.media_file_paths`.
- Для больших файлов можно переключить бота на локальный Bot API (`tgbotapi:8081`), чтобы скачивание шло через локальный `file` endpoint.
- Если локальный `file` endpoint отвечает `404`, backend автоматически попробует достать файл напрямую из контейнера `tgbotapi` через `docker cp`.

Пример включения (PowerShell):

```powershell
$env:TELEGRAM_BOT_TOKEN="7686518888:AAGf1HwSavQS7lsMvzbXq-1Ti7vZ-aNes5U"
$env:TELEGRAM_SDVG_ENABLED="1"
$env:TELEGRAM_BASE_API_URL="http://127.0.0.1:8081/bot"
$env:TELEGRAM_BASE_FILE_URL="http://127.0.0.1:8081/file"
npm run dev
```

Если backend запущен в Docker-сети, используйте хост контейнера:
- `TELEGRAM_BASE_API_URL=http://tgbotapi:8081/bot`
- `TELEGRAM_BASE_FILE_URL=http://tgbotapi:8081/file`

## Cookies для ограниченных источников

Можно передать cookies двумя способами:

1. `MEDIA_COOKIES_PATH` -> путь к `cookies.txt`
2. `MEDIA_COOKIES_FROM_BROWSER` -> например `chrome`

Это помогает скачивать приватный/ограниченный контент, где без авторизации `yt-dlp` дает 403/empty.

Для `Screenshot Lab` / `/api/link/screenshot` используется отдельная переменная:

- `LINK_SCREENSHOT_COOKIES_PATH` -> JSON или Netscape cookies для браузерного скриншота ссылок (X/YouTube и др.).

## Запуск через ngrok

### 1) Один раз: токен

```powershell
ngrok config add-authtoken <ВАШ_NGROK_AUTHTOKEN>
```

### 2) Запустите проект

```powershell
npm run dev
```

или:

```bat
start-dev.cmd
```

### 3) Поднимите туннель на фронт

```powershell
ngrok http 5187
```

Используйте выданный URL вида `https://xxxx.ngrok-free.app`.
API будет работать через этот же домен (`/api/...`) через Vite proxy.

### 4) Проверка

- UI: `https://xxxx.ngrok-free.app`
- Health: `https://xxxx.ngrok-free.app/api/health`
- Локальная инспекция ngrok: `http://127.0.0.1:4040`

### Важно для совместной работы

Если все подключены к **одному и тому же ngrok URL** (а значит к одному backend) и работают с одним `doc_id`, то состояние у всех общее.

## Где лежат данные

Для каждого документа:

- `document.json` - мета + исходный текст
- `document.vN.json` - версия документа на моменты изменения текста (`raw_text`)
- `segments.json` - сегменты
- `decisions.json` - визуал/поиск
- `research.json` - research runs по сегментам
- `events.jsonl` - история событий
- `events.log` - legacy-лог

Версии сегментов/решений также сохраняются (versioned snapshots).

Глобальный audit API (все действия через backend):

- `data/_audit/api-requests-YYYY-MM-DD.jsonl`
- `data/_audit/ui-actions-YYYY-MM-DD.jsonl` (frontend click/input/change/submit, включая действия без API-вызова)
- включен по умолчанию (`API_AUDIT_LOG_ENABLED=1`)
- для исключения health-check шума `/api/health` не логируется (включается через `API_AUDIT_LOG_INCLUDE_HEALTH=1`)
- UI-лог можно отключить через `UI_ACTION_AUDIT_ENABLED=0`

## Экспорт

- `JSONL`: одна строка = один сегмент (для датасетов)
- `MD`: читабельный формат для редакторской работы
- `XML (xmeml)`: таймлайн для монтажки на базе привязанных медиафайлов (`media_file_path`/`media_file_paths`)
  - экспорт всего документа;
  - экспорт отдельной темы;
  - Python не требуется, сборка XML идет в backend (Node.js);
  - секвенция по умолчанию: `1920x960` при `50 fps` (настраивается через env);
  - для Premiere relink используется корректная связка `video/audio` по общему `file id`;
  - встроены базовые motion-шаблоны размеров (включая `1920x960`, `960x960` и др.);
  - правило масштаба: `3840x* -> scale 45`, `3840x3840 -> scale 25`, любые квадраты центрируются как `960x960`;
  - для видео можно задать `Таймкод` для каждого файла (`visual_decision.media_file_timecodes`, формат `HH:MM:SS`);

## Segment Research API

- `POST /api/documents/:id/segments/:segmentId/research`
- `GET /api/documents/:id/segments/:segmentId/research`
- `POST /api/documents/:id/segments/:segmentId/research/apply`

`GET /api/documents/:id/segments/:segmentId/research` возвращает:
- `run` — текущий последний run по сегменту;
- `runs` — последние сохранённые runs по сегменту (по умолчанию до 8).

`apply` поддерживает:
- `use_as_source`
- `attach_asset`
- `screenshot`
- `download`
  - legacy-поле `media_start_timecode` поддерживается как fallback для первого видеофайла сегмента;
  - если у сегмента несколько файлов, они попадут в XML параллельно по видеотрекам (V1/V2/...) и с одинаковой длительностью сегмента;
  - конец (`out`) считается автоматически: `in + длительность сегмента`;
  - сегменты без `media_file_path`/`media_file_paths` учитываются как паузы (gap) по их длительности;
  - в общем XML добавляются маркеры начала тем (для навигации на таймлайне).

## Частые проблемы

- `yt-dlp unavailable`:
  - поставьте `yt-dlp` в PATH или задайте `MEDIA_YTDLP_PATH`.
- Видео не качается с ограниченного источника:
  - добавьте cookies через `MEDIA_COOKIES_PATH` или `MEDIA_COOKIES_FROM_BROWSER`.
- Через ngrok UI есть, API нет:
  - проверьте, что backend запущен на `8787`.
- Другие пользователи не видят ваши изменения:
  - убедитесь, что у всех один `doc_id` и включен `Collaborative Session: ON`.

## License

MIT
