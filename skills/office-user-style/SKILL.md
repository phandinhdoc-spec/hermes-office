---
name: office-user-style
description: Learn user habits and propose personalized formatting styles in Word, Excel, PowerPoint.
---

# office-user-style

Learn how this user formats Office documents and apply those habits consistently.
The profile lives in `~/.hermes/office_user_style.json` and is injected into every
hermes-office chat prompt by the bridge.

## Tools

| App | Inspect | Apply |
|---|---|---|
| Word | `office_word_get_styles` (`which`: selection/document) | `office_word_apply_format` (fontName, fontSize, bold, italic, color, alignment, lineSpacing, spaceBefore, spaceAfter, firstLineIndent, leftIndent) |
| Excel | `office_excel_get_format` (address), `office_excel_list_tables`, `office_excel_list_sheets` | `office_excel_set_format`, `office_excel_create_table`, `office_excel_add_table_column`, `office_excel_insert_chart`, `office_excel_conditional_format`, `office_excel_sort_filter`, `office_excel_add_sheet` |
| PowerPoint | `office_ppt_get_theme` (slideIndex) | `office_ppt_apply_format` (scope: selection/slide/presentation, fontName, fontSize, bold, italic, fontColor, fillColor), `office_ppt_format_shape` (slideIndex, shapeId), `office_ppt_generate_slide` (title, subtitle, bullets) |
| Profile | `office_style_get_profile` | `office_style_save_profile` (partial object, deep-merged, `null` deletes a key) |

HTTP: `GET /style-profile`, `PUT /style-profile` (merge; `?replace=true` to overwrite).

## Profile shape

```json
{
  "common": {"language": "vi", "notes": ["free-form habits"]},
  "word":  {"font": {"name": "Times New Roman", "size": 13}, "paragraph": {"alignment": "Justified", "lineSpacing": 18, "spaceAfter": 6, "firstLineIndent": 28}, "table": {"headerBold": true}},
  "excel": {"font": {"name": "Arial", "size": 11}, "header": {"fillColor": "#1F4E78", "fontColor": "#FFFFFF", "bold": true}, "numberFormats": {"money": "#,##0", "percent": "0.0%"}, "formulaPatterns": ["SUMIFS over named ranges", "IFERROR wrapper"]},
  "powerpoint": {"font": {"title": "Calibri 36 bold", "body": "Calibri 20"}, "palette": ["#1F4E78", "#F2F2F2", "#FFC000"], "layouts": ["Title and Content"]}
}
```

## Workflow

1. **Read the profile** (already in the prompt). If it has an entry for the current app, apply it to anything you
   insert or edit: set font/size/spacing/alignment right after inserting text, header fill and number formats
   after writing Excel ranges, palette/fonts on new slide shapes.
2. **Inspect when unsure**: for an existing document, call the get tool on the selection (and `which: "document"`
   for Word) to see the document's real conventions. Document formatting beats a stale profile; mention differences.
3. **Learn**:
   - Explicit statements ("luôn dùng Times New Roman 13") → save immediately.
   - Repeated corrections or consistent formatting seen across the same user's documents (seen at least twice)
     → propose first ("Tôi thấy bạn hay dùng X, lưu làm mặc định?") and save once the user agrees.
   - Save only style (fonts, sizes, colors, spacing, number formats, formula idioms, layout names), never document
     content or personal data. Keep the profile small; remove outdated keys with `null`.
4. **Propose, don't impose**: for new content apply the profile and say so in one line; for restyling existing
   content, show what would change and ask before applying wholesale.
5. Colors are `#RRGGBB`; Word sizes/spacing are points; Excel `columnWidth` is in points.
