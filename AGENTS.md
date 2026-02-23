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
- `backend/` — Express API (`http://localhost:8787`)
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
- `data/<doc_id>/segments.json`
- `data/<doc_id>/decisions.json`
- `data/<doc_id>/events.jsonl`
- `data/<doc_id>/*.vN.json` (versioned snapshots)

Ключевые поля:
- в `segments.json`: `segment_id`, `block_type`, `text_quote`, `section_id`, `section_title`, `is_done`
- в `decisions.json`: `visual_decision`, `search_decision`, `search_decision_en`
- для XML-кейса: `visual_decision.media_file_path`

## 5) XML-экспорт (без Python)

Реализован в backend (Node.js), не зависит от `UTCollection.py`.

Эндпоинт:
- `GET /api/documents/:id/export?format=xml` — весь документ
- `GET /api/documents/:id/export?format=xml&scope=section&section_id=...`
- также поддержан `section_title=...` для экспорта одной темы

Как собирается XML:
- формат: `xmeml` (FCP XML);
- берутся не-`links` сегменты с валидным `media_file_path`;
- путь проверяется через safe resolve внутри media root;
- длительность: `duration_hint_sec`, иначе `XML_EXPORT_DEFAULT_DURATION_SEC`;
- FPS: `XML_EXPORT_FPS`;
- размер секвенции: `1920x960`;
- для видео+аудио используется общий `file id` (важно для корректного relink в Premiere);
- перенесены базовые motion templates размеров из `UTCollection.py` (`1920x960`, `960x960` и др.).
- для видео-сегментов поддержан `media_start_timecode` (UI: `Старт файла (таймкод)`).
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
- если у сегмента нет привязанного `media_file_path`, в XML добавляется пауза по длительности сегмента (gap), чтобы тайминг не схлопывался.

Разделение тем в общем XML:
- проставляются sequence markers на старте каждой темы (section), чтобы было удобно прыгать между темами в монтажке.

## 6) Медиазагрузка

- только вручную по кнопке;
- через `yt-dlp` (+ `ffmpeg` при необходимости);
- root-папка: `MEDIA_DOWNLOAD_ROOT` (обычно `C:\Users\Nemifist\YandexDisk\PAMPAM`);
- события и статусы пишутся в `events.jsonl`.

## 7) Кодировка (критично)

Все текстовые файлы должны быть в UTF-8.

Правила:
- предпочтительно использовать `apply_patch` для правок;
- если запись через PowerShell, всегда явно указывать UTF-8;
- не оставлять “кракозябры” в UI-строках и документации.

Проверки:

```powershell
npm run guard:encoding
npm run guard:encoding:staged
```

## 8) Проверки после правок

Frontend:

```powershell
npm --prefix frontend run build
```

Backend:

```powershell
node --check backend/src/index.js
```

## 9) Правила изменения поведения

- не ломать существующий UX без явного запроса;
- делать минимальные целевые правки;
- при добавлении новых кнопок/фич — обновлять `README.md` и этот `AGENTS.md`;
- для новых API обязательно добавлять понятную ошибку и успешный статус.

## 10) Про `UTCollection.py`

`UTCollection.py` оставлен как справочный файл по логике таймлайна.
Текущий прод-путь в проекте — Node.js backend экспорт `XML (xmeml)` без Python-зависимостей.
