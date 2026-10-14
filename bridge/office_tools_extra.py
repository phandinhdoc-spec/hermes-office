"""Specs of the Office tools added for the skill set (implemented in addin/src/office/*_extra.ts).

Same shape as the TOOLS table of the bridge: {"host": ..., "args": {name: description}}.
Naming rule (the bridge treats a tool as "changes the document" unless its name has `_get_` or `_list_`):
read-only tools are therefore `office_ppt_list_shapes`, `office_ppt_get_lint`, `office_word_get_outline`, ...
`imageId` arguments are resolved by the bridge into base64 before the call reaches the taskpane.
"""
from __future__ import annotations

from typing import Any, Dict

HEX = "#RRGGBB"
THEME = (
    "object (optional) from office_design_palette.colors + office_design_font_pair: "
    "{background, surface, text, primary, accent, muted, fontHeading, fontBody}"
)


QUERY_HELP = (
    "words to find, ignoring case and accents. Space = every word must appear; \"a b\" = phrase; a|b = either word (synonyms, e.g. học|hs sinh); "
    "-word = exclude. Example: học|hs giỏi -lớp"
)
MODE_HELP = "all|any|phrase|regex (default all: every word; any: at least one; phrase: whole query as one phrase; regex: regular expression)"
COLOR_HELP = "vàng|xanh lá|xanh dương|hồng|đỏ|cam|xám or #RRGGBB (default: yellow); none removes the marking"
GROUPS_HELP = (
    "colour-coded sets instead of one query: [{\"query\": ..., \"color\": ..., \"label\": \"short name\", \"comment\": ...}, ...] (max 8; "
    "each may override mode/fuzzy/matchCase/wholeWord). Use it to colour categories differently"
)

EXTRA_TOOLS: Dict[str, Dict[str, Any]] = {
    # ---------------------------------------------------------------- PowerPoint
    "office_ppt_build_slide": {"host": "powerpoint", "args": {
        "layout": "title|section|bullets|image-right|image-left|full-image|two-column|quote|quiz|closing (default bullets)",
        "title": "string (<= 8 words)", "subtitle": "string (optional)",
        "bullets": "string[] (max 6 lines, <= 12 words each)", "right": "string[] second column (two-column / quiz options)",
        "imageId": "from office_web_fetch_image (optional)", "imageAlt": "alt text for the image (required when an image is used)",
        "credit": "image credit line, saved in the slide's note box (optional)", "notes": "speaker notes (optional)",
        "theme": THEME, "titleSize": "pt, 36-60 (default 40)", "bodySize": "pt, 24-36 (default 28)",
        "index": "0-based position to move the new slide to (optional, default end)"}},
    "office_ppt_insert_image": {"host": "powerpoint", "args": {
        "slideIndex": "number (optional, default selected slide)", "imageId": "from office_web_fetch_image", "base64": "raw base64 (alternative to imageId)",
        "left": "pt", "top": "pt", "width": "pt", "height": "pt (all optional, default full slide)",
        "fit": "contain|cover (default contain)", "altText": "string (required)", "name": "string (optional)"}},
    "office_ppt_set_background": {"host": "powerpoint", "args": {
        "scope": "slide|presentation (default slide)", "slideIndex": "number (optional)", "color": HEX, "imageId": "alternative to color", "base64": "alternative to color"}},
    "office_ppt_set_notes": {"host": "powerpoint", "args": {
        "slideIndex": "number", "text": "speaker notes", "append": "bool (default false)"}},
    "office_ppt_list_shapes": {"host": "powerpoint", "args": {
        "slideIndex": "number (optional, default selected slide)"}},
    "office_ppt_move_shape": {"host": "powerpoint", "args": {"slideIndex": "number", "shapeId": "string", "left": "pt", "top": "pt"}},
    "office_ppt_resize_shape": {"host": "powerpoint", "args": {
        "slideIndex": "number", "shapeId": "string", "width": "pt", "height": "pt", "left": "pt (optional)", "top": "pt (optional)"}},
    "office_ppt_delete_shape": {"host": "powerpoint", "args": {"slideIndex": "number", "shapeId": "string"}},
    "office_ppt_set_shape_text": {"host": "powerpoint", "args": {
        "slideIndex": "number", "shapeId": "string (from office_ppt_list_shapes)", "text": "new text; keeps the shape's font, size and colour; use \\n between lines"}},
    "office_ppt_delete_slide": {"host": "powerpoint", "args": {"slideIndex": "0-based index of the slide to delete"}},
    "office_ppt_reorder_slide": {"host": "powerpoint", "args": {"from": "0-based index", "to": "0-based index"}},
    "office_ppt_set_alt_text": {"host": "powerpoint", "args": {"slideIndex": "number", "shapeId": "string", "text": "alt text"}},
    "office_ppt_get_lint": {"host": "powerpoint", "args": {
        "scope": "presentation|slide (default presentation)", "slideIndex": "number (with scope=slide)",
        "minTitle": "pt (default 36)", "minBody": "pt (default 24)", "maxLines": "number (default 6)"}},
    # ---------------------------------------------------------------- Word
    "office_word_insert_image": {"host": "word", "args": {
        "imageId": "from office_web_fetch_image", "base64": "raw base64 (alternative)", "width": "pt (default 380, never wider than the page)",
        "altText": "string (required)", "location": "Start|End|Replace (default End; Replace = selection)", "caption": "text under the picture (optional)"}},
    "office_word_set_header_footer": {"host": "word", "args": {
        "header": "text (optional)", "footer": "text (optional)", "pageNumber": "none|footer-center|footer-right|header-right (default none)",
        "firstPageDifferent": "bool (optional)", "alignment": "Left|Centered|Right (for header/footer text, default Centered)"}},
    "office_word_insert_toc": {"host": "word", "args": {
        "location": "Start|End|Selection (default Start)", "levels": "1-3 (default 3)", "title": "heading above the table of contents, e.g. MỤC LỤC (optional)"}},
    "office_word_add_comment": {"host": "word", "args": {
        "text": "comment text", "quote": "exact short text to attach the comment to (optional; default the selection)"}},
    "office_word_find_replace": {"host": "word", "args": {
        "find": "plain text (not a regular expression)", "replace": "string (may be empty)", "matchCase": "bool (default false)",
        "wholeWord": "bool (default false)", "which": "document|selection (default document)", "max": "number (default 500)"}},
    "office_word_highlight": {"host": "word", "args": {
        "texts": "[\"exact phrase or sentence\", ...] (max 60; each up to 255 characters; only these are marked, the rest of the text is untouched)",
        "color": "Yellow|BrightGreen|Turquoise|Pink|Red|Blue|none (default Yellow; none removes the highlight)",
        "bold": "bool (optional)", "fontColor": HEX + " (optional)", "matchCase": "bool (default false)", "which": "document|selection (default document)"}},
    "office_word_set_numbering": {"host": "word", "args": {
        "style": "bullet|number|none", "indices": "paragraph numbers from office_word_get_outline (optional, default the selection)"}},
    "office_word_get_outline": {"host": "word", "args": {
        "mode": "headings|all (default headings)", "from": "first paragraph index (default 0)", "count": "max paragraphs (default 150, max 400)"}},
    "office_word_apply_style_by_index": {"host": "word", "args": {
        "items": "[{\"index\": paragraph number from office_word_get_outline, \"style\": \"Heading 1\"}] (max 80 per call)"}},
    "office_word_set_paragraph_text": {"host": "word", "args": {
        "items": "[{\"index\": paragraph number, \"text\": new text}] (max 40 per call; keeps the paragraph's formatting)"}},
    "office_word_format_table": {"host": "word", "args": {
        "tableIndex": "0-based (default the last table)", "style": "Table Grid|Grid Table 4 - Accent 1|... (optional)", "headerFill": HEX,
        "headerFontColor": HEX, "headerBold": "bool (default true)", "fontSize": "pt (optional)", "alignment": "Left|Centered|Right (optional)"}},
    "office_word_get_lint": {"host": "word", "args": {}},
    # ---------------------------------------------------------------- Excel
    "office_excel_set_validation": {"host": "excel", "args": {
        "address": "A2:A100", "type": "list|whole|decimal|date|textLength", "values": "string[] for a list", "source": "=Sheet2!$A$2:$A$20 for a list from cells",
        "operator": "Between|GreaterThan|GreaterThanOrEqualTo|LessThan|LessThanOrEqualTo|EqualTo (default Between)", "min": "number or date", "max": "number or date",
        "prompt": "hint shown when the cell is selected (optional)", "error": "message for wrong input (optional)"}},
    "office_excel_freeze_panes": {"host": "excel", "args": {"rows": "number of top rows to freeze (0 = none)", "columns": "number of left columns to freeze (0 = none)", "sheet": "name (optional)"}},
    "office_excel_remove_duplicates": {"host": "excel", "args": {
        "address": "A1:F200", "columns": "0-based column numbers inside the range that define a duplicate (default all)", "hasHeaders": "bool (default true)"}},
    "office_excel_find_replace": {"host": "excel", "args": {
        "find": "plain text", "replace": "string", "address": "limit to a range (optional)", "sheet": "name or all (default active sheet)", "matchCase": "bool", "wholeCell": "bool"}},
    "office_excel_clean_range": {"host": "excel", "args": {
        "address": "A1:F200 (optional, default the used range)", "trim": "bool (default true)", "collapseSpaces": "bool (default true)",
        "textToNumber": "bool: text like \"1.234,5\" or \"12\" becomes a number (default true)", "removeLineBreaks": "bool (default false)"}},
    "office_excel_get_lint": {"host": "excel", "args": {"address": "A1:F200 (optional, default the used range)"}},
    "office_excel_get_diff": {"host": "excel", "args": {
        "sheetA": "name", "rangeA": "A1:F100 (optional, default used range)", "sheetB": "name", "rangeB": "(optional)",
        "keyColumn": "0-based column that identifies a row (optional; without it rows are compared by position)", "limit": "max differences listed (default 100)"}},
    "office_excel_highlight_cells": {"host": "excel", "args": {
        "addresses": "string[] e.g. [\"B3\", \"D7:E7\"] (max 300)", "sheet": "name (optional)", "fillColor": HEX, "fontColor": HEX}},

    # ---------------------------------------------------------------- smart search, colour marking, comments (annot_extra.ts)
    "office_word_list_matches": {"host": "word", "args": {
        "query": QUERY_HELP, "mode": MODE_HELP, "fuzzy": "bool: forgive typos in words of 5+ letters (default true)",
        "matchCase": "bool (default false)", "wholeWord": "bool (default false)", "top_k": "1-100 (default 20)", "order": "score|document (default score)"}},
    "office_word_mark_matches": {"host": "word", "args": {
        "query": QUERY_HELP, "color": COLOR_HELP, "comment": "comment attached to the first match of every marked paragraph; {match} = the matched text (optional)",
        "groups": GROUPS_HELP, "mode": MODE_HELP, "fuzzy": "bool (default true)", "matchCase": "bool", "wholeWord": "bool",
        "bold": "bool (optional)", "fontColor": HEX + " (optional)", "max": "max paragraphs marked per group (default 50, max 200)", "commentMax": "max comments in total per group (default 20, max 60)"}},
    "office_word_list_comments": {"host": "word", "args": {"contains": "filter by text (optional)", "author": "filter (optional)", "unresolvedOnly": "bool (optional)"}},
    "office_word_delete_comments": {"host": "word", "args": {
        "ids": "comment ids from office_word_list_comments", "contains": "text filter", "author": "author filter", "all": "bool: every comment", "action": "delete|resolve (default delete)"}},
    "office_excel_list_matches": {"host": "excel", "args": {
        "query": QUERY_HELP, "mode": MODE_HELP, "scope": "cell|row (default cell; row = the words may sit in different cells of the same row)",
        "sheet": "name | all (default active sheet)", "address": "limit to a range (optional)", "inFormulas": "bool: also search formulas (default false)",
        "fuzzy": "bool (default true)", "matchCase": "bool", "wholeWord": "bool", "top_k": "1-100 (default 30)", "order": "score|sheet (default score)"}},
    "office_excel_mark_matches": {"host": "excel", "args": {
        "query": QUERY_HELP, "color": COLOR_HELP, "comment": "comment/note put on every marked cell; {match} = the cell text (optional)", "kind": "comment|note (default comment)",
        "groups": GROUPS_HELP, "scope": "cell|row (default cell)", "wholeRow": "bool: with scope=row, colour the whole row (default false)", "sheet": "name | all", "address": "limit to a range",
        "mode": MODE_HELP, "fuzzy": "bool", "matchCase": "bool", "wholeWord": "bool", "bold": "bool", "fontColor": HEX, "max": "max cells per group (default 300, max 1000)", "commentMax": "max comments in total (default 20, max 100)"}},
    "office_excel_add_comment": {"host": "excel", "args": {
        "address": "one cell, e.g. B3", "addresses": "string[] of single cells (max 100; alternative to address)", "text": "comment text", "kind": "comment|note (default comment)",
        "fill": COLOR_HELP + " (optional: also colour the cell)", "sheet": "name (optional)"}},
    "office_excel_list_comments": {"host": "excel", "args": {"sheet": "name | all (default active sheet)", "contains": "text filter (optional)"}},
    "office_excel_delete_comments": {"host": "excel", "args": {"address": "one cell", "contains": "text filter", "all": "bool", "kind": "comment|note (optional)", "sheet": "name | all"}},
    "office_ppt_list_matches": {"host": "powerpoint", "args": {
        "query": QUERY_HELP, "mode": MODE_HELP, "where": "all|slides|notes (default all)", "slideIndex": "number (optional, default every slide)",
        "fuzzy": "bool", "matchCase": "bool", "wholeWord": "bool", "top_k": "1-100 (default 20)", "order": "score|slide (default score)"}},
    "office_ppt_mark_matches": {"host": "powerpoint", "args": {
        "query": QUERY_HELP, "color": COLOR_HELP.replace("; none removes the marking", "; none is not possible in PowerPoint"),
        "how": "text|outline|fill|both (default text: matched words in the colour + bold; outline = the box border; fill = the box background; both = text + outline)",
        "comment": "sticky note beside each marked box; {match} = matched text (optional)", "placement": "margin|onslide (default margin = off the slide, not shown or printed)",
        "groups": GROUPS_HELP, "slideIndex": "number (optional)", "mode": MODE_HELP, "fuzzy": "bool", "matchCase": "bool", "wholeWord": "bool",
        "fontColor": HEX + " (optional, overrides the text colour)", "max": "max boxes per group (default 60)", "author": "name shown in the note data (default Hermes)"}},
    "office_ppt_add_comment": {"host": "powerpoint", "args": {
        "text": "comment text", "slideIndex": "number (optional, default selected slide)", "shapeId": "string from office_ppt_list_shapes (optional: the note sits beside it and its border is coloured)",
        "color": COLOR_HELP.replace("; none removes the marking", ""), "placement": "margin|onslide (default margin)", "markAnchor": "bool (default true)", "author": "string (optional)"}},
    "office_ppt_list_comments": {"host": "powerpoint", "args": {"slideIndex": "number (optional)", "contains": "text filter (optional)"}},
    "office_ppt_delete_comments": {"host": "powerpoint", "args": {"ids": "note ids from office_ppt_list_comments", "slideIndex": "number: every note on this slide", "contains": "text filter", "all": "bool"}},
}
