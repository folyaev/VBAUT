export const SDVG_MESSAGES = {
  documentUnavailable: "Документ недоступен.",
  segmentNotFound: "Сегмент не найден.",
  linkExpired: "Ссылка устарела.",
  noDownloadedFiles: "Скачанных файлов пока нет.",
  staleCard: "Карточка устарела. Запусти /sdvg заново.",
  staleHint: "Подсказка устарела. Нажми 🔎 снова.",
  stalePreview: "Превью устарело. Пришли ссылку снова.",
  staleList: "Список устарел. Нажми 📂 снова.",
  linksSearchInProgress: "Ищу ссылки...",
  linkSavedToInboxNoDownloader: "Ссылка сохранена в Inbox, но yt-dlp сейчас недоступен для скачивания.",
  downloadModeAuto: "Режим /download включен автоматически. Отправляй скачиваемые ссылки.",
  downloadModeEnabled:
    "Режим /download включен. Если привязка к сегменту не выбрана, скачиваемые ссылки будут уходить прямо в UNSORTED. Для привязки к сценарию снова запусти /sdvg.",
  noActiveSegmentRunSdvg: "Нет активного сегмента. Запусти /sdvg.",
  fileNotSentBack: (filePath) => `Файл скачан, но не получилось отправить обратно из media storage. Проверь путь: ${filePath}`,
  archiveTarget: (docId) => `Сохраню в <code>ARCHIVE_PROJECTS/${docId}</code>.`,
  fileCount: (count) => `Файлов: ${count}`,
  inboxSavedAutoDownload: (count) => `Сохранил в Inbox: ${count}. Режим /download включен автоматически.`,
  notionUpdateTitle: "📝 Обновление из Notion",
  notionUpdateFailed: (docId, errorText) => `📝 Обновление из Notion не удалось.\nДокумент: ${docId}\nОшибка: ${errorText}`,
  notionStatusUnchanged: "Статус: без изменений.",
  notionStatusEmpty: "Статус: Notion вернул пустой текст.",
  notionStatusUpdated: "Статус: обновлено.",
  notionDocumentLine: (docId) => `Документ: ${docId}`,
  notionLinesDelta: (before, after, delta) => `Строки: ${before} → ${after} (${delta})`,
  notionCharsDelta: (before, after, delta) => `Символы: ${before} → ${after} (${delta})`,
  notionStageLine: (label) => `Этап: ${label}`
};

export function buildSdvgHelpText() {
  return [
    "SDVG-режим включен.",
    "Команды:",
    "• /sdvg — открыть текущий документ",
    "• /sdvg <doc_id> — открыть конкретный документ",
    "• /sdvg random — случайный следующий сегмент",
    "• /sdvg order — следующий сегмент по порядку",
    "Кнопка ✅ отмечает текущий сегмент как готовый и сразу открывает следующий сегмент.",
    "Поддерживаются ссылки и медиафайлы в Telegram."
  ].join("\n");
}
