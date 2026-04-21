export const RESEARCH_CATEGORY_ORDER = ["video", "preview", "quotes", "images", "other"];

export const RESEARCH_CATEGORY_LABELS = {
  all: "Все",
  video: "Видео",
  preview: "Превью",
  quotes: "Цитаты и заголовки",
  images: "Изображения",
  other: "Другое"
};

function normalizeCategoryId(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return RESEARCH_CATEGORY_ORDER.includes(normalized) ? normalized : "other";
}

export function getResearchCategoryId(ranked = {}) {
  return normalizeCategoryId(ranked?.category_id);
}

export function getResearchCategoryLabel(ranked = {}) {
  const categoryId = getResearchCategoryId(ranked);
  return RESEARCH_CATEGORY_LABELS[categoryId] ?? RESEARCH_CATEGORY_LABELS.other;
}

export function sortResearchItemsByCategoryAndScore(items = []) {
  const orderIndex = new Map(RESEARCH_CATEGORY_ORDER.map((item, index) => [item, index]));
  return [...(Array.isArray(items) ? items : [])].sort((left, right) => {
    const leftCategory = getResearchCategoryId(left?.ranked);
    const rightCategory = getResearchCategoryId(right?.ranked);
    const categoryDelta = Number(orderIndex.get(leftCategory) ?? 999) - Number(orderIndex.get(rightCategory) ?? 999);
    if (categoryDelta !== 0) return categoryDelta;
    return Number(right?.ranked?.total_score ?? 0) - Number(left?.ranked?.total_score ?? 0);
  });
}

export function buildResearchCategoryBuckets(items = []) {
  const sorted = sortResearchItemsByCategoryAndScore(items);
  const buckets = {
    all: sorted,
    video: [],
    preview: [],
    quotes: [],
    images: [],
    other: []
  };
  sorted.forEach((item) => {
    const categoryId = getResearchCategoryId(item?.ranked);
    buckets[categoryId].push(item);
  });
  return buckets;
}
