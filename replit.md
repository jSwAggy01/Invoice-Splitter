# Invoice Splitter

## Overview
A web-based tool for splitting multi-page PDF files into individually named single-page PDFs. Built for invoice processing teams who need to split combined invoice PDFs and name each page based on a text file of names.

## Current State
- v1.0 - Core PDF splitting functionality with web UI
- Users upload a PDF and a names text file, then download a ZIP of split PDFs

## Architecture
- **Backend**: Python/Flask (src/app.py)
- **Frontend**: Vanilla HTML/CSS/JS (src/templates/, src/static/)
- **PDF Processing**: PyPDF2
- **Server**: Runs on port 5000

## Project Structure
```
src/
  app.py              - Flask backend with PDF splitting logic
  templates/
    index.html         - Main page template
  static/
    css/style.css      - Application styles
    js/app.js          - Frontend JavaScript
attached_assets/       - Original script reference
```

## Key Features
- Drag & drop or browse for PDF and names file
- Live preview showing page count, name count, and match status
- Handles encrypted PDFs with password input
- Downloads split PDFs as a ZIP file
- Auto-handles name/page count mismatches gracefully

## Recent Changes
- 2026-02-18: Initial web application created from CLI script

## User Preferences
- Target audience: Non-technical coworkers
- Focus on ease of use and simplicity
- Ongoing project - more invoice processing features planned

## Deployment
- Flask dev server on port 5000
- Production: gunicorn on port 5000
