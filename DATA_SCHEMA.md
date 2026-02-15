# DATA_SCHEMA.md

## document.json
{
  "id": "doc_001",
  "raw_text": "...",
  "created_at": "ISO",
  "updated_at": "ISO",
  "notion_url": "https://www.notion.so/..."
}

## segment
{
  "segment_id": "news_01",
  "block_type": "news",
  "text_quote": "...",
  "section_id": "section_01",
  "section_title": "Интро",
  "section_index": 1,
  "links": [{ "url": "https://example.com", "raw": "1. example.com" }],
  "segment_status": "same|changed|new",
  "version": 1
}

## visual_decision
{
  "type": "video",
  "description": "Коллаж или графика: BMW X5 — цена до и после (10 млн vs 13 млн).",
  "format_hint": "Документ",
  "priority": "рекомендуется",
  "duration_hint_sec": null
}

## search_decision
{
  "keywords": ["..."] ,
  "queries": ["..."]
}

## search_decision_en
{
  "keywords": ["..."] ,
  "queries": ["..."]
}
