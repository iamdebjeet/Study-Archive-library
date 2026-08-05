# The Archive — Study Notes

A topic → chapter → notes organizer: typed/markdown notes, handwritten pages
(images or PDFs), and YouTube links, all filed by topic and chapter.

## Run it

```bash
npm i
npm run dev
```

Then open the local URL Vite prints (usually http://localhost:5173).

## Build for production

```bash
npm run build
npm run preview
```

## Notes

- Data is saved to your browser's `localStorage`, under the key
  `study-archive-data-v1`. It's per-browser, per-device — it won't sync
  across machines and clearing browser data will clear your notes.
- `.docx` uploads are converted to HTML in-browser via `mammoth` (headings,
  bold, tables carry over). `.md` / `.txt` uploads are treated as plain
  markdown and rendered with a small built-in parser.
- Handwritten pages can be an uploaded image, an uploaded PDF, or a pasted
  image/PDF link. PDFs aren't embedded inline (some browser/sandbox setups
  block that) — instead you get "Open in new tab" / "Download" buttons.
