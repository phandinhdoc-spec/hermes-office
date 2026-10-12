# Hermes Office Extension Specification

## 1. Overview
- Extension Name: `hermes-office`
- Target Applications: Microsoft Word, Excel, PowerPoint (Desktop & Web on macOS/Windows)
- Philosophy: Similar to Copilot/Claude for Office, directly read & edit active document/spreadsheet/presentation.
- Engine: Local Hermes Agent daemon via HTTP/WebSocket.

## 2. Architecture
- **Client Side (Office Add-in)**: 
  - Office Web Add-in using Office.js API.
  - React + TypeScript + Vite + Fluent UI + Tailwind CSS.
  - Communicates via WebSocket (`ws://127.0.0.1:8765/ws`) or HTTP SSE to local Hermes Office Bridge daemon.
- **Host Side (Bridge Daemon)**:
  - Python/FastAPI or Node.js background bridge server (`hermes-office-bridge`).
  - Exposes endpoints to check Hermes status, stream responses, and route tool execution requests back to Office.js.
- **Office.js Toolset (Bi-directional RPC)**:
  - `office_word_get_selection`, `office_word_get_full_text`, `office_word_replace_selection`, `office_word_insert_text`, `office_word_insert_equation`, `office_word_insert_table`
  - `office_excel_get_active_sheet`, `office_excel_get_range`, `office_excel_set_range_values`, `office_excel_set_formula`
  - `office_ppt_get_slides`, `office_ppt_add_slide`, `office_ppt_insert_text_box`
- **Manifest & Sideloading**:
  - `manifest.xml` targeting Word, Excel, and PowerPoint.
  - CLI setup command: automated macOS (`~/Library/Containers/com.microsoft...`) & Windows manifest installation with local self-signed dev SSL certs.
