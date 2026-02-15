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
- Очередь загрузок, ограничение частоты, проверка дублей, прогресс (0/20/40/60/80/100), журнал событий.
- Экспорт в `JSONL` и `MD`.
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

Проверка вручную:

```powershell
npm run guard:encoding
```

Для staged-файлов (как в pre-commit):

```powershell
npm run guard:encoding:staged
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
7. Экспортируйте `JSONL`/`MD`.

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
- `segments.json` - сегменты
- `decisions.json` - визуал/поиск
- `events.jsonl` - история событий
- `events.log` - legacy-лог

Версии сегментов/решений также сохраняются (versioned snapshots).

## Экспорт

- `JSONL`: одна строка = один сегмент (для датасетов)
- `MD`: читабельный формат для редакторской работы

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
