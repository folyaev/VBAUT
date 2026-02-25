# VBAUT: локальный ассистент визуального брифа

Инструмент для редактора/сценариста: разбивает сценарий на сегменты, помогает с визуалом и поиском, хранит историю и дает совместный режим через один backend (в том числе через ngrok).

## Что умеет сейчас

- Сегментация текста по блокам: `intro/news/ad/selfad/outro`.
- Сохранение и восстановление ручной структуры, включая пользовательские `_01` под-сегменты.
- Отдельные блоки ссылок по теме + общая панель всех ссылок документа.
- AI Help по теме/сегменту (визуал и поисковые запросы).
- Кнопки поиска по сегментам и по заголовкам:
  - RU: `VK`, `VK Video`, `Copy and Perplexity`
  - EN: Reuters / AFP / NY Post / WTHR13 / Independent (YouTube channel search)
- Ручная загрузка медиа (через `yt-dlp`, до 1080p) в папки тем.
- Проверка версии и ручное обновление `yt-dlp` из UI.
- Очередь загрузок, ограничение частоты, проверка дублей, прогресс (0/20/40/60/80/100), журнал событий.
- Экспорт в `JSONL`, `MD` и `XML (xmeml)`.
- Режим совместной сессии: автосейв + автообновление у всех подключенных клиентов.

## Как устроено

- Frontend (Vite): `http://localhost:5173`
- Backend (Express API): `http://localhost:8787`
- HeadlessNotion bot (опционально): `http://localhost:3131`
- Хранилище документов: `data/` (или `DATA_DIR`)

Ключевая идея: **все клиенты видят одно и то же состояние, если они работают с одним backend и одним `doc_id`**.

## Требования

- Node.js 18+
- npm
- LLM endpoint в OpenAI-compatible формате (llama.cpp/vLLM/LM Studio/Ollama-wrapper)
- Для медиазагрузок: `yt-dlp` (и желательно `ffmpeg`)

## Установка

Из корня проекта:

```powershell
npm install
npm --prefix backend install
npm --prefix frontend install
```

Если используете Notion-бота через `start-dev.cmd`:

```powershell
npm --prefix HeadlessNotion install
```

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

### Windows-скрипт (3 окна: backend + frontend + HeadlessNotion)

```bat
start-dev.cmd
```

### Перезапуск с очисткой портов 8787/5173/3131

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
- `XML_EXPORT_FPS` (default: `50`)
- `XML_EXPORT_DEFAULT_DURATION_SEC` (default: `5`)
- `XML_SECTION_MARKER_DURATION_SEC` (default: `2`)
- `XML_SECTION_GAP_SEC` (default: `0`)

### Media Downloader

- `MEDIA_DOWNLOAD_ROOT` (default: `C:\Users\Nemifist\YandexDisk\PAMPAM`)
- `MEDIA_MAX_CONCURRENT` (default: `1`)
- `MEDIA_START_DELAY_MS` (default: `2500`)
- `MEDIA_MAX_FILES_LIST` (сколько файлов показывать в списке)
- `MEDIA_YTDLP_PATH` (явный путь к `yt-dlp`, если нужно)
- `MEDIA_FFMPEG_LOCATION` (путь к `ffmpeg` или папке `bin`)
- `MEDIA_COOKIES_PATH` (путь к `cookies.txt`, Netscape format)
- `MEDIA_COOKIES_FROM_BROWSER` (например: `chrome`)

Пример (PowerShell):

```powershell
$env:LLAMA_BASE_URL="http://127.0.0.1:8080"
$env:LLAMA_MAX_TOKENS="2048"
$env:MEDIA_DOWNLOAD_ROOT="C:\Users\Nemifist\YandexDisk\PAMPAM"
npm run dev
```

## Рабочий цикл (обычный)

1. Вставьте сценарий и создайте документ.
2. Нажмите сегментацию.
3. Проверьте темы/сегменты, правьте вручную.
4. Для нужной темы используйте `AI Help`.
5. Добавляйте/проверяйте ссылки в блоках ссылок.
6. Сохраняйте.
7. Экспортируйте `JSONL`/`MD`/`XML`.

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

## Медиазагрузки (yt-dlp)

- Загрузка ручная, по кнопке у конкретной ссылки.
- Фильтр URL ограничен поддерживаемыми хостами (YouTube, X/Twitter, VK, TikTok, Vimeo и др.).
- Качество: максимально доступное до 1080p.
- Сохранение: `MEDIA_DOWNLOAD_ROOT\<ТЕМА>\...`.
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

## Cookies для ограниченных источников

Можно передать cookies двумя способами:

1. `MEDIA_COOKIES_PATH` -> путь к `cookies.txt`
2. `MEDIA_COOKIES_FROM_BROWSER` -> например `chrome`

Это помогает скачивать приватный/ограниченный контент, где без авторизации `yt-dlp` дает 403/empty.

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
ngrok http 5173
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
- `XML (xmeml)`: таймлайн для монтажки на базе привязанных медиафайлов (`media_file_path`)
  - экспорт всего документа;
  - экспорт отдельной темы;
  - Python не требуется, сборка XML идет в backend (Node.js);
  - секвенция по умолчанию: `1920x960` при `50 fps` (настраивается через env);
  - для Premiere relink используется корректная связка `video/audio` по общему `file id`;
  - встроены базовые motion-шаблоны размеров (включая `1920x960`, `960x960` и др.);
  - правило масштаба: `3840x* -> scale 45`, `3840x3840 -> scale 25`, любые квадраты центрируются как `960x960`;
  - для видео можно задать `Таймкод` в сегменте (`SS`, `MM:SS`, `HH:MM:SS`);
  - конец (`out`) считается автоматически: `in + длительность сегмента`;
  - сегменты без `media_file_path` учитываются как паузы (gap) по их длительности;
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
