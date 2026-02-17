# AGENTS.md

Документ для разработчиков и код-агентов: как устроен проект `VBAUT`, как его запускать и как безопасно вносить изменения.

## 1. Что это за проект

`VBAUT` — локальный инструмент для редактора/сценариста:
- загружает сценарий (ручной текст или Notion),
- сегментирует по темам и подпунктам,
- хранит ссылки по темам,
- генерирует визуальные и поисковые подсказки,
- умеет ручные медиа-загрузки через `yt-dlp`,
- сохраняет всё в локальные JSON-файлы документа.

## 2. Компоненты

- `frontend/` — React + Vite UI (`http://localhost:5173`)
- `backend/` — Express API (`http://localhost:8787`)
- `HeadlessNotion/` — опциональный парсер Notion
- `data/` — хранилище документов
- `MediaDownloaderQt6-5.4.2/` — локальные бинарники `yt-dlp`/`ffmpeg` (если используются)

## 3. Быстрый запуск

Из корня проекта:

```powershell
npm install
npm --prefix backend install
npm --prefix frontend install
npm run dev
```

Если нужен Notion bot в отдельном окне:

```powershell
npm --prefix HeadlessNotion install
.\start-dev.cmd
```

## 4. Типовой рабочий поток

1. Создать документ из текста сценария (`POST /api/documents`).
2. Загрузить/обновить текст из Notion (через UI -> `POST /api/notion/raw`).
3. Нажать `Сегментировать` (`POST /api/documents/:id/segments:generate`).
4. Проверить темы, сегменты и блоки ссылок.
5. При необходимости использовать `AI Help` и генерацию поиска.
6. Сохранить (`PUT /api/documents/:id/session`), затем экспорт (`JSONL`/`MD`).

## 5. Где какие данные

Для каждого `doc_id`:

- `data/<doc_id>/document.json` — мета и исходный текст
- `data/<doc_id>/segments.json` — сегменты (включая `links`-сегменты)
- `data/<doc_id>/decisions.json` — visual/search решения
- `data/<doc_id>/events.jsonl` — события
- `*.vN.json` — versioned snapshots

В `document.json` важны поля:
- `raw_text`
- `notion_url`
- `needs_segmentation`
- `last_segmented_text_hash`

## 6. Ключевые UX-механики

- Бейдж `NEW` у кнопки сегментации зависит от `document.needs_segmentation`.
- `Ссылки` хранятся отдельными сегментами `block_type="links"` и привязаны к теме (`section_*`).
- `For Figma` копирует список тем столбиком из `###` заголовков.

## 7. Медиа-загрузка

- Только вручную, по кнопке.
- Используется `yt-dlp` (+ `ffmpeg` при необходимости).
- Путь по умолчанию: `C:\Users\Nemifist\YandexDisk\PAMPAM`.
- События статусов пишутся в `events.jsonl`.
- Дубликаты отсекаются через архив/проверки.

## 8. Частые проблемы

- `ECONNREFUSED` в Vite при старте — обычно frontend поднялся раньше backend (race condition).
- Если UI показывает "кракозябры", сначала проверять кодировку файлов и ответов API.
- Если после пересегментации появились дубли тем с одними ссылками:
  - смотреть merge логики links-сегментов (section key/title normalization).

## 9. Кодировка (критично)

- Все текстовые файлы проекта — только UTF-8.
- Предпочитать `apply_patch` для изменений.
- Если запись через PowerShell, обязательно указывать кодировку UTF-8:
  - `Set-Content -Encoding utf8`
  - `Out-File -Encoding utf8`

Не использовать команды записи без явной кодировки для текстовых файлов.

## 10. Анти-кракозябры workflow

Перед завершением любых правок запускать:

```powershell
npm run guard:encoding
```

Для staged-файлов (pre-commit):

```powershell
npm run guard:encoding:staged
```

Если guard нашёл проблему:
- сначала исправить кодировку/символы,
- затем повторить проверку.

## 11. Git hooks

Pre-commit hook должен быть установлен (`npm run hooks:install`) и запускать encoding guard.

## 12. Правила изменения кода

- Не ломать существующий UX без запроса.
- Вносить минимальные целевые правки.
- После правок на фронте прогонять сборку:

```powershell
npm --prefix frontend run build
```

- После правок на backend проверять синтаксис:

```powershell
node --check backend/src/index.js
```

