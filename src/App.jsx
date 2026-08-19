import React, { useState, useEffect, useRef } from "react";
import { Plus, X, Trash2, ArrowLeft, FileText, PenLine, Youtube, ChevronRight, Upload, Link as LinkIcon, BookMarked, Eye, Pencil, FileUp, Volume2, Pause, Play, Square } from "lucide-react";
import * as mammoth from "mammoth";

// Backed by the study-archive-server API (Postgres), with a localStorage
// mirror so the app keeps working — and nothing typed is lost — if the
// network drops or the server is briefly unreachable.
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8787";
const API_KEY = import.meta.env.VITE_API_KEY || "";
const LOCAL_CACHE_KEY = "study-archive-data-v1";
const TTS_VOICE_KEY = "study-archive-tts-voice";

const storage = {
  async get(key) {
    try {
      const res = await fetch(`${API_URL}/api/data`, {
        headers: { "x-api-key": API_KEY },
      });
      if (res.status === 404) throw new Error("not found");
      if (!res.ok) throw new Error(`server responded ${res.status}`);
      const data = await res.json();
      const value = JSON.stringify(data);
      window.localStorage.setItem(LOCAL_CACHE_KEY, value);
      return { key, value };
    } catch (e) {
      const cached = window.localStorage.getItem(LOCAL_CACHE_KEY);
      if (cached) {
        console.warn("Could not reach the server, using local cache:", e.message);
        return { key, value: cached };
      }
      throw e;
    }
  },
  async set(key, value) {
    window.localStorage.setItem(LOCAL_CACHE_KEY, value);
    const res = await fetch(`${API_URL}/api/data`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-api-key": API_KEY },
      body: value,
    });
    if (!res.ok) throw new Error(`server save failed: ${res.status}`);
    return { key, value };
  },
};

const STORAGE_KEY = "study-archive-data-v1";

const ACCENTS = {
  notes: { name: "notes", color: "#2F7A6C", bg: "#E1EEEA", label: "Notes" },
  hand: { name: "hand", color: "#C98A3E", bg: "#F3E7D3", label: "Handwritten" },
  video: { name: "video", color: "#B14B32", bg: "#F2E0D9", label: "Watch" },
};

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function defaultData() {
  return {
    topics: [
      {
        id: uid(),
        name: "Angular",
        chapters: [
          "Angular Basics",
          "Component Communication",
          "Services & Dependency Injection",
          "Routing",
          "Forms",
          "HTTP & Backend Communication",
          "Angular Signals",
          "RxJS",
          "State Management",
          "Change Detection & Performance",
          "Angular Testing",
          "Advanced Topics",
        ].map((name) => ({ id: uid(), name, notes: [], hand: [], video: [] })),
      },
      { id: uid(), name: "TypeScript", chapters: [] },
      { id: uid(), name: "JavaScript", chapters: [] },
    ],
  };
}

function getYoutubeId(url) {
  const m = url.match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

// ---------- Minimal markdown renderer (headings, tables, code fences, lists, quotes, bold/italic/code/links) ----------
function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inlineMd(text) {
  let t = escapeHtml(text);
  t = t.replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>');
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  t = t.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  t = t.replace(/(^|[^\w])_([^_]+)_/g, "$1<em>$2</em>");
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return t;
}

function splitTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((s) => s.trim());
}

function markdownToHtml(md) {
  if (!md) return "";
  const codeBlocks = [];
  const withPlaceholders = md.replace(/```([a-zA-Z0-9]*)\n?([\s\S]*?)```/g, (m, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push({ lang, code });
    return `\u0000CODE${idx}\u0000`;
  });

  const lines = withPlaceholders.split("\n");
  let html = "";
  let i = 0;
  let inList = null;
  let paraBuffer = [];

  const flushPara = () => {
    if (paraBuffer.length) {
      html += `<p>${inlineMd(paraBuffer.join(" "))}</p>`;
      paraBuffer = [];
    }
  };
  const closeList = () => {
    if (inList) {
      html += `</${inList}>`;
      inList = null;
    }
  };

  while (i < lines.length) {
    const line = lines[i];
    const codeMatch = line.match(/^\u0000CODE(\d+)\u0000$/);
    if (codeMatch) {
      flushPara();
      closeList();
      const block = codeBlocks[Number(codeMatch[1])];
      html += `<pre class="md-code"><code>${escapeHtml(block.code.replace(/\n$/, ""))}</code></pre>`;
      i++;
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushPara();
      closeList();
      const level = h[1].length;
      html += `<h${level} class="md-h${level}">${inlineMd(h[2])}</h${level}>`;
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
      flushPara();
      closeList();
      html += `<hr class="md-hr"/>`;
      i++;
      continue;
    }
    if (line.includes("|") && lines[i + 1] && /^\s*\|?[\s:-]+\|[\s:|-]*$/.test(lines[i + 1])) {
      flushPara();
      closeList();
      const headerCells = splitTableRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      html +=
        '<div class="md-table-wrap"><table class="md-table"><thead><tr>' +
        headerCells.map((c) => `<th>${inlineMd(c)}</th>`).join("") +
        "</tr></thead><tbody>" +
        rows.map((r) => `<tr>${r.map((c) => `<td>${inlineMd(c)}</td>`).join("")}</tr>`).join("") +
        "</tbody></table></div>";
      continue;
    }
    if (/^>\s?/.test(line)) {
      flushPara();
      closeList();
      const bq = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        bq.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      html += `<blockquote class="md-quote">${inlineMd(bq.join(" "))}</blockquote>`;
      continue;
    }
    const ulm = line.match(/^\s*[-*+]\s+(.*)$/);
    if (ulm) {
      flushPara();
      if (inList !== "ul") {
        closeList();
        html += '<ul class="md-list">';
        inList = "ul";
      }
      html += `<li>${inlineMd(ulm[1])}</li>`;
      i++;
      continue;
    }
    const olm = line.match(/^\s*\d+\.\s+(.*)$/);
    if (olm) {
      flushPara();
      if (inList !== "ol") {
        closeList();
        html += '<ol class="md-list">';
        inList = "ol";
      }
      html += `<li>${inlineMd(olm[1])}</li>`;
      i++;
      continue;
    }
    if (line.trim() === "") {
      flushPara();
      closeList();
      i++;
      continue;
    }
    paraBuffer.push(line.trim());
    i++;
  }
  flushPara();
  closeList();
  return html;
}

function stripMarkdownPreview(md) {
  if (!md) return "";
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`|-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function MarkdownView({ content, format }) {
  const html = format === "html" ? content : markdownToHtml(content);
  return <div className="md-content" dangerouslySetInnerHTML={{ __html: html }} />;
}

function extractPlainText(content, format) {
  if (!content) return "";
  const html = format === "html" ? content : markdownToHtml(content);
  const div = document.createElement("div");
  div.innerHTML = html;
  return (div.textContent || div.innerText || "").replace(/\s+/g, " ").trim();
}

function splitIntoSpeechChunks(text, maxLen = 200) {
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
  const chunks = [];
  let current = "";
  for (const s of sentences) {
    if (current && (current + s).length > maxLen) {
      chunks.push(current.trim());
      current = s;
    } else {
      current += s;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

function pickIndianVoice(voices) {
  if (!voices.length) return null;
  function score(v) {
    let s = 0;
    if (v.lang === "en-IN") s += 100;
    else if (v.lang?.toLowerCase().startsWith("en-in")) s += 90;
    else if (/india/i.test(v.name)) s += 70;
    else if (v.lang?.toLowerCase().startsWith("en")) s += 30;
    // Network ("cloud") voices are generally far more natural-sounding
    // than the robotic offline/local voices bundled with the OS.
    if (!v.localService) s += 20;
    return s;
  }
  return voices.slice().sort((a, b) => score(b) - score(a))[0] || null;
}

function getPreferredVoice(voices) {
  const savedName = localStorage.getItem(TTS_VOICE_KEY);
  if (savedName) {
    const saved = voices.find((v) => v.name === savedName);
    if (saved) return saved;
  }
  return pickIndianVoice(voices);
}

// Speaks chunks back to back with a short breathing pause and slight pitch
// drift between sentences, since a single flat pitch/rate across a whole
// utterance is what makes browser TTS sound robotic. Returns a stop() fn.
function speakChunkSequence(chunks, voice, onDone) {
  let stopped = false;
  function next(i) {
    if (stopped) return;
    if (i >= chunks.length) {
      onDone?.();
      return;
    }
    const utter = new SpeechSynthesisUtterance(chunks[i]);
    if (voice) utter.voice = voice;
    utter.lang = voice?.lang || "en-IN";
    utter.rate = 0.95;
    utter.pitch = 1 + (Math.random() * 0.05 - 0.025);
    utter.onend = () => {
      if (stopped) return;
      setTimeout(() => next(i + 1), 180);
    };
    utter.onerror = () => onDone?.();
    window.speechSynthesis.speak(utter);
  }
  next(0);
  return () => {
    stopped = true;
  };
}

function SelectionReadButton() {
  const [sel, setSel] = useState(null); // {x, y, text}
  const voiceRef = useRef(null);
  const stopRef = useRef(null);

  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    function refreshVoice() {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length) voiceRef.current = getPreferredVoice(voices);
    }
    refreshVoice();
    window.speechSynthesis.addEventListener("voiceschanged", refreshVoice);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", refreshVoice);
  }, []);

  useEffect(() => {
    if (!("speechSynthesis" in window)) return;

    function handleSelectionUp(e) {
      if (e.target?.closest?.("[data-selection-read-btn]")) return;
      const selection = window.getSelection();
      const text = selection ? selection.toString().trim() : "";
      if (!text || text.length < 2) {
        setSel(null);
        return;
      }
      const anchorNode = selection.anchorNode;
      const anchorEl = anchorNode?.nodeType === 3 ? anchorNode.parentElement : anchorNode;
      if (anchorEl?.closest?.("input, textarea, [contenteditable]")) {
        setSel(null);
        return;
      }
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) {
        setSel(null);
        return;
      }
      setSel({ x: rect.right, y: rect.top, text });
    }
    function handleScroll() {
      setSel(null);
    }
    document.addEventListener("mouseup", handleSelectionUp);
    document.addEventListener("keyup", handleSelectionUp);
    document.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("mouseup", handleSelectionUp);
      document.removeEventListener("keyup", handleSelectionUp);
      document.removeEventListener("scroll", handleScroll, true);
    };
  }, []);

  useEffect(() => {
    return () => {
      stopRef.current?.();
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  if (!("speechSynthesis" in window) || !sel) return null;

  function handleClick() {
    stopRef.current?.();
    window.speechSynthesis.cancel();
    const chunks = splitIntoSpeechChunks(sel.text);
    stopRef.current = speakChunkSequence(chunks, voiceRef.current);
    setSel(null);
  }

  return (
    <button
      data-selection-read-btn
      onClick={handleClick}
      title="Read selected text aloud"
      style={{
        position: "fixed",
        left: Math.min(sel.x + 6, window.innerWidth - 38),
        top: Math.max(sel.y - 38, 8),
        zIndex: 100,
        background: "#2F7A6C",
        color: "#FBF8F0",
        border: "none",
        borderRadius: "50%",
        width: 30,
        height: 30,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
      }}
    >
      <Volume2 size={15} />
    </button>
  );
}

function ReadAloud({ text }) {
  const [status, setStatus] = useState("idle"); // 'idle' | 'playing' | 'paused'
  const [voices, setVoices] = useState([]);
  const [voiceName, setVoiceName] = useState("");
  const voiceRef = useRef(null);
  const stopRef = useRef(null);

  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    function refreshVoice() {
      const all = window.speechSynthesis.getVoices();
      if (!all.length) return;
      setVoices(all);
      const voice = getPreferredVoice(all);
      voiceRef.current = voice;
      setVoiceName(voice ? voice.name : "");
    }
    refreshVoice();
    window.speechSynthesis.addEventListener("voiceschanged", refreshVoice);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", refreshVoice);
  }, []);

  useEffect(() => {
    return () => {
      stopRef.current?.();
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  if (!("speechSynthesis" in window)) return null;
  if (!text) return null;

  function handleVoiceChange(e) {
    const name = e.target.value;
    setVoiceName(name);
    voiceRef.current = voices.find((v) => v.name === name) || null;
    localStorage.setItem(TTS_VOICE_KEY, name);
    if (status !== "idle") {
      stopRef.current?.();
      window.speechSynthesis.cancel();
      setStatus("idle");
    }
  }

  function handlePlay() {
    if (status === "paused") {
      window.speechSynthesis.resume();
      setStatus("playing");
      return;
    }
    stopRef.current?.();
    window.speechSynthesis.cancel();
    const chunks = splitIntoSpeechChunks(text);
    setStatus("playing");
    stopRef.current = speakChunkSequence(chunks, voiceRef.current, () => setStatus("idle"));
  }
  function handlePause() {
    window.speechSynthesis.pause();
    setStatus("paused");
  }
  function handleStop() {
    stopRef.current?.();
    window.speechSynthesis.cancel();
    setStatus("idle");
  }

  const iconBtn = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    background: "#EDE6D3",
    border: "1px solid #D8CEB0",
    borderRadius: 6,
    padding: "7px 12px",
    fontSize: 12.5,
    fontWeight: 600,
    cursor: "pointer",
    color: "#26241B",
    fontFamily: "'Inter', sans-serif",
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
      {status !== "playing" && (
        <button style={iconBtn} onClick={handlePlay}>
          <Play size={14} /> {status === "paused" ? "Resume" : "Read aloud"}
        </button>
      )}
      {status === "playing" && (
        <button style={iconBtn} onClick={handlePause}>
          <Pause size={14} /> Pause
        </button>
      )}
      {status !== "idle" && (
        <button style={iconBtn} onClick={handleStop}>
          <Square size={14} /> Stop
        </button>
      )}
      {voices.length > 0 && (
        <select
          value={voiceName}
          onChange={handleVoiceChange}
          title="If this voice sounds robotic, try another one installed on your device"
          style={{
            fontSize: 11.5,
            color: "#26241B",
            background: "#FBF8F0",
            border: "1px solid #D8CEB0",
            borderRadius: 6,
            padding: "6px 8px",
            fontFamily: "'Inter', sans-serif",
            maxWidth: 220,
          }}
        >
          {voices.map((v) => (
            <option key={v.name} value={v.name}>
              {v.name} ({v.lang}){v.localService ? "" : " ★"}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function Tab({ accent, children, style }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 11,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: accent.color,
        background: accent.bg,
        padding: "3px 9px",
        borderRadius: 3,
        fontWeight: 600,
        ...style,
      }}
    >
      {children}
    </span>
  );
}

function FolderCard({ onClick, title, subtitle, count, tabColor, onDelete }) {
  return (
    <div
      onClick={onClick}
      style={{
        position: "relative",
        background: "#EDE6D3",
        border: "1px solid #D8CEB0",
        borderRadius: "2px 10px 10px 10px",
        padding: "22px 20px 18px",
        cursor: "pointer",
        transition: "transform 0.15s ease, box-shadow 0.15s ease",
        boxShadow: "0 1px 0 rgba(38,36,27,0.04)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.boxShadow = "0 8px 20px rgba(38,36,27,0.12)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "0 1px 0 rgba(38,36,27,0.04)";
      }}
    >
      <div
        style={{
          position: "absolute",
          top: -9,
          left: 0,
          width: 46,
          height: 9,
          background: tabColor,
          borderRadius: "4px 4px 0 0",
        }}
      />
      {onDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Delete"
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            background: "none",
            border: "none",
            color: "#B3A98A",
            cursor: "pointer",
            padding: 4,
          }}
        >
          <Trash2 size={14} />
        </button>
      )}
      <div
        style={{
          fontFamily: "'Fraunces', serif",
          fontSize: 20,
          fontWeight: 600,
          color: "#26241B",
          marginBottom: 6,
          paddingRight: 20,
        }}
      >
        {title}
      </div>
      <div style={{ fontSize: 12.5, color: "#7A7259", fontFamily: "'IBM Plex Mono', monospace" }}>
        {subtitle}
      </div>
      {typeof count === "number" && (
        <div
          style={{
            marginTop: 14,
            fontSize: 11,
            color: "#9B9276",
            fontFamily: "'IBM Plex Mono', monospace",
          }}
        >
          {count} {count === 1 ? "chapter" : "chapters"}
        </div>
      )}
    </div>
  );
}

function Modal({ title, onClose, children, width }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(23,34,44,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#F5F1E4",
          borderRadius: 10,
          padding: "24px 26px",
          width: width || 440,
          maxWidth: "100%",
          maxHeight: "85vh",
          overflowY: "auto",
          border: "1px solid #D8CEB0",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <div style={{ fontFamily: "'Fraunces', serif", fontSize: 18, fontWeight: 600, color: "#26241B" }}>
            {title}
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#7A7259" }}>
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const inputStyle = {
  width: "100%",
  padding: "9px 11px",
  borderRadius: 6,
  border: "1px solid #D8CEB0",
  background: "#FBF8F0",
  fontSize: 14,
  color: "#26241B",
  fontFamily: "'Inter', sans-serif",
  marginBottom: 14,
  boxSizing: "border-box",
};

const btnPrimary = (color) => ({
  background: color,
  color: "#FBF8F0",
  border: "none",
  borderRadius: 6,
  padding: "9px 18px",
  fontSize: 13.5,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "'Inter', sans-serif",
});

const DELETE_PASSWORD = "Arc@Del@123";

function PasswordConfirmModal({ message, onConfirm, onClose }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  function trySubmit() {
    if (password === DELETE_PASSWORD) {
      onConfirm();
    } else {
      setError("Incorrect password");
      setPassword("");
    }
  }

  return (
    <Modal title="Confirm delete" onClose={onClose}>
      <div style={{ fontSize: 14, color: "#26241B", marginBottom: 14, fontFamily: "'Inter', sans-serif" }}>
        {message}
      </div>
      <input
        autoFocus
        type="password"
        style={inputStyle}
        placeholder="Enter password"
        value={password}
        onChange={(e) => {
          setPassword(e.target.value);
          setError("");
        }}
        onKeyDown={(e) => e.key === "Enter" && trySubmit()}
      />
      {error && (
        <div style={{ fontSize: 12.5, color: "#B14B32", marginTop: -8, marginBottom: 14, fontFamily: "'Inter', sans-serif" }}>
          {error}
        </div>
      )}
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "1px solid #D8CEB0",
            borderRadius: 6,
            padding: "9px 18px",
            fontSize: 13.5,
            fontWeight: 600,
            cursor: "pointer",
            color: "#7A7259",
            fontFamily: "'Inter', sans-serif",
          }}
        >
          Cancel
        </button>
        <button style={btnPrimary("#B14B32")} onClick={trySubmit}>
          Delete
        </button>
      </div>
    </Modal>
  );
}

export default function App() {
  const [data, setData] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState({ level: "topics", topicId: null, chapterId: null });
  const [modal, setModal] = useState(null); // {type: 'addTopic'|'addChapter'|'addNote'|'addHand'|'addVideo'}
  const [reading, setReading] = useState(null); // {kind, item}
  const [confirmDelete, setConfirmDelete] = useState(null); // {message, action}
  const [syncStatus, setSyncStatus] = useState("synced"); // 'synced' | 'saving' | 'offline'
  const skipSave = useRef(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await storage.get(STORAGE_KEY);
        if (res && res.value) {
          setData(JSON.parse(res.value));
        } else {
          const d = defaultData();
          setData(d);
          await storage.set(STORAGE_KEY, JSON.stringify(d));
        }
      } catch (e) {
        const d = defaultData();
        setData(d);
        try {
          await storage.set(STORAGE_KEY, JSON.stringify(d));
        } catch (_) {}
      }
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    (async () => {
      setSyncStatus("saving");
      try {
        await storage.set(STORAGE_KEY, JSON.stringify(data));
        setSyncStatus("synced");
      } catch (e) {
        console.error("save failed", e);
        setSyncStatus("offline");
      }
    })();
  }, [data, loaded]);

  if (!loaded || !data) {
    return (
      <div style={{ padding: 60, textAlign: "center", color: "#7A7259", fontFamily: "'IBM Plex Mono', monospace" }}>
        opening the archive…
      </div>
    );
  }

  const topic = data.topics.find((t) => t.id === view.topicId) || null;
  const chapter = topic ? topic.chapters.find((c) => c.id === view.chapterId) : null;

  function updateTopics(fn) {
    setData((prev) => {
      const next = { ...prev, topics: fn(prev.topics.map((t) => ({ ...t, chapters: t.chapters.map((c) => ({ ...c })) }))) };
      return next;
    });
  }

  function addTopic(name) {
    updateTopics((topics) => [...topics, { id: uid(), name, chapters: [] }]);
  }
  function deleteTopic(id) {
    updateTopics((topics) => topics.filter((t) => t.id !== id));
  }
  function addChapter(topicId, name) {
    updateTopics((topics) =>
      topics.map((t) => (t.id === topicId ? { ...t, chapters: [...t.chapters, { id: uid(), name, notes: [], hand: [], video: [] }] } : t))
    );
  }
  function deleteChapter(topicId, chapterId) {
    updateTopics((topics) =>
      topics.map((t) => (t.id === topicId ? { ...t, chapters: t.chapters.filter((c) => c.id !== chapterId) } : t))
    );
  }
  function addItem(topicId, chapterId, kind, item) {
    updateTopics((topics) =>
      topics.map((t) =>
        t.id === topicId
          ? {
              ...t,
              chapters: t.chapters.map((c) =>
                c.id === chapterId ? { ...c, [kind]: [...c[kind], { id: uid(), ...item }] } : c
              ),
            }
          : t
      )
    );
  }
  function deleteItem(topicId, chapterId, kind, itemId) {
    updateTopics((topics) =>
      topics.map((t) =>
        t.id === topicId
          ? {
              ...t,
              chapters: t.chapters.map((c) =>
                c.id === chapterId ? { ...c, [kind]: c[kind].filter((i) => i.id !== itemId) } : c
              ),
            }
          : t
      )
    );
  }

  function Breadcrumb() {
    const parts = [{ label: "Archive", onClick: () => setView({ level: "topics", topicId: null, chapterId: null }) }];
    if (topic) parts.push({ label: topic.name, onClick: () => setView({ level: "chapters", topicId: topic.id, chapterId: null }) });
    if (chapter) parts.push({ label: chapter.name, onClick: () => {} });
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 22, flexWrap: "wrap" }}>
        {parts.map((p, i) => (
          <span key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span
              onClick={p.onClick}
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 12.5,
                color: i === parts.length - 1 ? "#26241B" : "#8C8367",
                cursor: i === parts.length - 1 ? "default" : "pointer",
                fontWeight: i === parts.length - 1 ? 600 : 500,
                textDecoration: i === parts.length - 1 ? "none" : "underline",
                textUnderlineOffset: 3,
              }}
            >
              {p.label}
            </span>
            {i < parts.length - 1 && <ChevronRight size={12} color="#B3A98A" />}
          </span>
        ))}
      </div>
    );
  }

  function Section({ kind, items, icon: Icon }) {
    const accent = ACCENTS[kind];
    return (
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <Tab accent={accent}>
            <Icon size={12} /> {accent.label}
          </Tab>
          <button
            onClick={() => setModal({ type: "add" + kind })}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              background: "none",
              border: `1px solid ${accent.color}`,
              color: accent.color,
              borderRadius: 5,
              padding: "4px 9px",
              fontSize: 12,
              cursor: "pointer",
              fontFamily: "'Inter', sans-serif",
              fontWeight: 600,
            }}
          >
            <Plus size={12} /> add
          </button>
        </div>
        {items.length === 0 ? (
          <div style={{ fontSize: 13, color: "#9B9276", fontStyle: "italic", padding: "4px 2px" }}>
            Nothing filed here yet.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {items.map((item) => (
              <div
                key={item.id}
                onClick={() => {
                  if (kind === "video") {
                    window.open(item.url, "_blank");
                  } else {
                    setReading({ kind, item });
                  }
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  background: "#EDE6D3",
                  border: "1px solid #D8CEB0",
                  borderRadius: 7,
                  padding: "10px 12px",
                  cursor: "pointer",
                }}
              >
                {kind === "video" && getYoutubeId(item.url) && (
                  <img
                    src={`https://img.youtube.com/vi/${getYoutubeId(item.url)}/default.jpg`}
                    alt=""
                    style={{ width: 60, height: 45, objectFit: "cover", borderRadius: 4, flexShrink: 0 }}
                  />
                )}
                {kind === "hand" && item.image && item.kind !== "pdf" && (
                  <img src={item.image} alt="" style={{ width: 45, height: 45, objectFit: "cover", borderRadius: 4, flexShrink: 0 }} />
                )}
                {kind === "hand" && item.kind === "pdf" && (
                  <div
                    style={{
                      width: 45,
                      height: 45,
                      borderRadius: 4,
                      flexShrink: 0,
                      background: "#C98A3E",
                      color: "#FBF8F0",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 10.5,
                      fontWeight: 700,
                      fontFamily: "'IBM Plex Mono', monospace",
                      letterSpacing: "0.02em",
                    }}
                  >
                    PDF
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#26241B", fontFamily: "'Inter', sans-serif" }}>
                    {item.title}
                  </div>
                  {kind === "notes" && (
                    <div style={{ fontSize: 12, color: "#8C8367", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {stripMarkdownPreview(item.content).slice(0, 70) || "Empty note"}
                    </div>
                  )}
                  {kind === "video" && (
                    <div style={{ fontSize: 12, color: "#8C8367" }}>{item.url}</div>
                  )}
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmDelete({
                      message: `Delete "${item.title}"?`,
                      action: () => deleteItem(topic.id, chapter.id, kind, item.id),
                    });
                  }}
                  style={{ background: "none", border: "none", color: "#B3A98A", cursor: "pointer" }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      style={{
        background: "#17222C",
        minHeight: "100vh",
        padding: "32px 28px",
        fontFamily: "'Inter', sans-serif",
        boxSizing: "border-box",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:wght@500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@500;600&display=swap');
        .md-content { font-family: 'Inter', sans-serif; font-size: 14.5px; line-height: 1.7; color: #26241B; }
        .md-content .md-h1 { font-family: 'Fraunces', serif; font-size: 24px; font-weight: 700; margin: 0 0 12px; color: #26241B; }
        .md-content .md-h2 { font-family: 'Fraunces', serif; font-size: 19px; font-weight: 600; margin: 22px 0 10px; color: #26241B; border-top: 1px solid #D8CEB0; padding-top: 16px; }
        .md-content .md-h3 { font-family: 'Fraunces', serif; font-size: 16px; font-weight: 600; margin: 18px 0 8px; color: #26241B; }
        .md-content .md-h4, .md-content .md-h5, .md-content .md-h6 { font-size: 14.5px; font-weight: 600; margin: 14px 0 6px; color: #4A4636; }
        .md-content p { margin: 0 0 12px; }
        .md-content .md-hr { border: none; border-top: 1px solid #D8CEB0; margin: 18px 0; }
        .md-content .md-inline-code { background: #E3DAC0; color: #7A3E1D; padding: 1px 5px; border-radius: 3px; font-family: 'IBM Plex Mono', monospace; font-size: 0.9em; }
        .md-content .md-code { background: #26241B; color: #EDE6D3; padding: 12px 14px; border-radius: 6px; overflow-x: auto; margin: 0 0 14px; font-family: 'IBM Plex Mono', monospace; font-size: 12.5px; line-height: 1.6; }
        .md-content .md-code code { background: none; color: inherit; padding: 0; }
        .md-content .md-quote { border-left: 3px solid #C98A3E; margin: 0 0 14px; padding: 4px 14px; color: #6B6350; font-style: italic; }
        .md-content .md-list { margin: 0 0 14px; padding-left: 22px; }
        .md-content .md-list li { margin-bottom: 4px; }
        .md-content .md-table-wrap { overflow-x: auto; margin: 0 0 16px; }
        .md-content .md-table { border-collapse: collapse; width: 100%; font-size: 13.5px; }
        .md-content .md-table th, .md-content .md-table td { border: 1px solid #D8CEB0; padding: 7px 10px; text-align: left; }
        .md-content .md-table th { background: #E3DAC0; font-weight: 600; }
        .md-content a { color: #2F7A6C; }
        .md-content strong { font-weight: 600; }
      `}</style>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <BookMarked size={20} color="#EDE6D3" />
          <div style={{ fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 700, color: "#EDE6D3" }}>
            The Archive
          </div>
        </div>
        <div
          title={syncStatus === "offline" ? "Couldn't reach the server — your latest changes are only saved locally in this browser." : undefined}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            color: syncStatus === "offline" ? "#E0A458" : "#6E9B8C",
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: syncStatus === "offline" ? "#E0A458" : syncStatus === "saving" ? "#8A9199" : "#6E9B8C",
              display: "inline-block",
            }}
          />
          {syncStatus === "offline" ? "saved locally only" : syncStatus === "saving" ? "saving…" : "synced"}
        </div>
      </div>
      <div style={{ fontSize: 12.5, color: "#8A9199", marginBottom: 26, fontFamily: "'IBM Plex Mono', monospace" }}>
        everything, filed topic by topic
      </div>

      <div style={{ background: "transparent" }}>
        <div style={{ color: "#EDE6D3" }}>
          <Breadcrumb />
        </div>

        {view.level === "topics" && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16 }}>
              {data.topics.map((t) => (
                <FolderCard
                  key={t.id}
                  title={t.name}
                  subtitle={`TOPIC · ${String(t.chapters.length).padStart(2, "0")}`}
                  count={t.chapters.length}
                  tabColor="#2F7A6C"
                  onClick={() => setView({ level: "chapters", topicId: t.id, chapterId: null })}
                  onDelete={() => {
                    setConfirmDelete({
                      message: `Delete "${t.name}" and everything in it?`,
                      action: () => deleteTopic(t.id),
                    });
                  }}
                />
              ))}
              <div
                onClick={() => setModal({ type: "addTopic" })}
                style={{
                  border: "1.5px dashed #3A4753",
                  borderRadius: 10,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  color: "#8A9199",
                  cursor: "pointer",
                  minHeight: 100,
                  fontFamily: "'Inter', sans-serif",
                  fontWeight: 600,
                  fontSize: 14,
                }}
              >
                <Plus size={16} /> New topic
              </div>
            </div>
          </div>
        )}

        {view.level === "chapters" && topic && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16 }}>
              {topic.chapters.map((c, idx) => (
                <FolderCard
                  key={c.id}
                  title={c.name}
                  subtitle={`NO. ${String(idx + 1).padStart(2, "0")}`}
                  tabColor="#C98A3E"
                  onClick={() => setView({ level: "chapter", topicId: topic.id, chapterId: c.id })}
                  onDelete={() => {
                    setConfirmDelete({
                      message: `Delete chapter "${c.name}"?`,
                      action: () => deleteChapter(topic.id, c.id),
                    });
                  }}
                />
              ))}
              <div
                onClick={() => setModal({ type: "addChapter" })}
                style={{
                  border: "1.5px dashed #3A4753",
                  borderRadius: 10,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  color: "#8A9199",
                  cursor: "pointer",
                  minHeight: 90,
                  fontWeight: 600,
                  fontSize: 14,
                }}
              >
                <Plus size={16} /> New chapter
              </div>
            </div>
          </div>
        )}

        {view.level === "chapter" && topic && chapter && (
          <div style={{ background: "#1D2933", borderRadius: 10, padding: "20px 22px" }}>
            <div style={{ fontFamily: "'Fraunces', serif", fontSize: 19, fontWeight: 600, color: "#EDE6D3", marginBottom: 18 }}>
              {chapter.name}
            </div>
            <Section kind="notes" items={chapter.notes} icon={FileText} />
            <Section kind="hand" items={chapter.hand} icon={PenLine} />
            <Section kind="video" items={chapter.video} icon={Youtube} />
          </div>
        )}
      </div>

      {modal?.type === "addTopic" && (
        <Modal title="New topic" onClose={() => setModal(null)}>
          <TopicForm
            onSubmit={(name) => {
              addTopic(name);
              setModal(null);
            }}
          />
        </Modal>
      )}

      {modal?.type === "addChapter" && (
        <Modal title="New chapter" onClose={() => setModal(null)}>
          <TopicForm
            placeholder="e.g. Signals & Zoneless CD"
            onSubmit={(name) => {
              addChapter(topic.id, name);
              setModal(null);
            }}
          />
        </Modal>
      )}

      {modal?.type === "addnotes" && (
        <Modal title="New note" onClose={() => setModal(null)}>
          <NoteForm
            onSubmit={({ title, content, format }) => {
              addItem(topic.id, chapter.id, "notes", { title, content, format });
              setModal(null);
            }}
          />
        </Modal>
      )}

      {modal?.type === "addhand" && (
        <Modal title="New handwritten page" onClose={() => setModal(null)}>
          <HandForm
            onSubmit={({ title, image, kind }) => {
              addItem(topic.id, chapter.id, "hand", { title, image, kind });
              setModal(null);
            }}
          />
        </Modal>
      )}

      {modal?.type === "addvideo" && (
        <Modal title="New video link" onClose={() => setModal(null)}>
          <VideoForm
            onSubmit={({ title, url }) => {
              addItem(topic.id, chapter.id, "video", { title, url });
              setModal(null);
            }}
          />
        </Modal>
      )}

      {confirmDelete && (
        <PasswordConfirmModal
          message={confirmDelete.message}
          onConfirm={() => {
            confirmDelete.action();
            setConfirmDelete(null);
          }}
          onClose={() => setConfirmDelete(null)}
        />
      )}

      {reading && (
        <Modal
          title={reading.item.title}
          onClose={() => setReading(null)}
          width={reading.kind === "notes" || (reading.kind === "hand" && reading.item.kind === "pdf") ? 720 : 480}
        >
          {reading.kind === "notes" &&
            (reading.item.content ? (
              <>
                <ReadAloud text={extractPlainText(reading.item.content, reading.item.format)} />
                <MarkdownView content={reading.item.content} format={reading.item.format} />
              </>
            ) : (
              <div style={{ color: "#8C8367", fontStyle: "italic" }}>This note is empty.</div>
            ))}
          {reading.kind === "hand" && reading.item.image && reading.item.kind === "pdf" && (
            <PdfViewer src={reading.item.image} title={reading.item.title} />
          )}
          {reading.kind === "hand" && reading.item.image && reading.item.kind !== "pdf" && (
            <img src={reading.item.image} alt={reading.item.title} style={{ width: "100%", borderRadius: 6 }} />
          )}
        </Modal>
      )}

      <SelectionReadButton />
    </div>
  );
}

function TopicForm({ onSubmit, placeholder }) {
  const [name, setName] = useState("");
  return (
    <div>
      <input
        autoFocus
        style={inputStyle}
        placeholder={placeholder || "e.g. Angular"}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && name.trim() && onSubmit(name.trim())}
      />
      <button style={btnPrimary("#2F7A6C")} onClick={() => name.trim() && onSubmit(name.trim())}>
        Save
      </button>
    </div>
  );
}

function NoteForm({ onSubmit }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [format, setFormat] = useState("markdown"); // 'markdown' | 'html' (html = imported from .docx)
  const [tab, setTab] = useState("write"); // 'write' | 'upload'
  const [showPreview, setShowPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fileError, setFileError] = useState("");
  const [fileName, setFileName] = useState("");

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileError("");
    const ext = file.name.split(".").pop().toLowerCase();

    if (ext === "md" || ext === "txt" || ext === "markdown") {
      const reader = new FileReader();
      reader.onload = () => {
        setContent(reader.result);
        setFormat("markdown");
        setFileName(file.name);
        if (!title.trim()) setTitle(file.name.replace(/\.(md|txt|markdown)$/i, ""));
        setTab("write");
        setShowPreview(true);
      };
      reader.onerror = () => setFileError("Couldn't read that file.");
      reader.readAsText(file);
    } else if (ext === "docx") {
      setBusy(true);
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const result = await mammoth.convertToHtml({ arrayBuffer: reader.result });
          setContent(result.value);
          setFormat("html");
          setFileName(file.name);
          if (!title.trim()) setTitle(file.name.replace(/\.docx$/i, ""));
        } catch (err) {
          console.error(err);
          setFileError("Couldn't read that .docx file.");
        }
        setBusy(false);
      };
      reader.onerror = () => {
        setFileError("Couldn't read that file.");
        setBusy(false);
      };
      reader.readAsArrayBuffer(file);
    } else {
      setFileError("Please upload a .md, .txt, or .docx file.");
    }
  }

  return (
    <div>
      <input style={inputStyle} placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button
          onClick={() => setTab("write")}
          style={{
            ...btnPrimary(tab === "write" ? "#2F7A6C" : "transparent"),
            color: tab === "write" ? "#FBF8F0" : "#2F7A6C",
            border: "1px solid #2F7A6C",
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
          }}
        >
          <Pencil size={13} /> Write
        </button>
        <button
          onClick={() => setTab("upload")}
          style={{
            ...btnPrimary(tab === "upload" ? "#2F7A6C" : "transparent"),
            color: tab === "upload" ? "#FBF8F0" : "#2F7A6C",
            border: "1px solid #2F7A6C",
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
          }}
        >
          <FileUp size={13} /> Upload file
        </button>
      </div>

      {tab === "upload" && (
        <div style={{ marginBottom: 14 }}>
          <input type="file" accept=".md,.txt,.markdown,.docx" onChange={handleFile} style={{ fontSize: 13, color: "#26241B" }} />
          <div style={{ fontSize: 11.5, color: "#8C8367", marginTop: 6 }}>
            .md / .txt keep full markdown formatting. .docx headings, bold, and tables carry over automatically.
          </div>
          {busy && <div style={{ fontSize: 12.5, color: "#7A7259", marginTop: 8 }}>Reading {fileName}…</div>}
          {fileError && <div style={{ fontSize: 12.5, color: "#B14B32", marginTop: 8 }}>{fileError}</div>}
        </div>
      )}

      {format === "markdown" && (
        <>
          {tab === "write" && (
            <textarea
              style={{ ...inputStyle, minHeight: 180, resize: "vertical", fontFamily: "'IBM Plex Mono', monospace", fontSize: 13 }}
              placeholder="Write or paste your notes here — headings with #, tables with |, code with ``` fences…"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          )}
          <button
            onClick={() => setShowPreview((s) => !s)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: "none",
              border: "none",
              color: "#7A7259",
              cursor: "pointer",
              fontSize: 12.5,
              fontFamily: "'Inter', sans-serif",
              fontWeight: 600,
              padding: "0 0 12px",
            }}
          >
            <Eye size={13} /> {showPreview ? "Hide preview" : "Show preview"}
          </button>
          {showPreview && (
            <div style={{ background: "#FBF8F0", border: "1px solid #D8CEB0", borderRadius: 6, padding: "12px 16px", marginBottom: 14, maxHeight: 260, overflowY: "auto" }}>
              {content.trim() ? <MarkdownView content={content} format="markdown" /> : <span style={{ color: "#9B9276", fontStyle: "italic", fontSize: 13 }}>Nothing to preview yet.</span>}
            </div>
          )}
        </>
      )}

      {format === "html" && content && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11.5, color: "#8C8367", marginBottom: 6, fontFamily: "'IBM Plex Mono', monospace", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            imported from word · preview
          </div>
          <div style={{ background: "#FBF8F0", border: "1px solid #D8CEB0", borderRadius: 6, padding: "12px 16px", maxHeight: 260, overflowY: "auto" }}>
            <MarkdownView content={content} format="html" />
          </div>
        </div>
      )}

      <button
        style={btnPrimary("#2F7A6C")}
        onClick={() => title.trim() && onSubmit({ title: title.trim(), content, format })}
      >
        Save note
      </button>
    </div>
  );
}

function isPdfFile(nameOrUrl, mimeType) {
  if (mimeType && mimeType.includes("pdf")) return true;
  return /\.pdf($|\?)/i.test(nameOrUrl || "");
}

function dataUrlToBlobUrl(dataUrl) {
  const commaIdx = dataUrl.indexOf(",");
  const header = dataUrl.slice(0, commaIdx);
  const base64 = dataUrl.slice(commaIdx + 1);
  const mimeMatch = header.match(/data:([^;]+)/);
  const mime = mimeMatch ? mimeMatch[1] : "application/pdf";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: mime });
  return URL.createObjectURL(blob);
}

// Deliberately simple: open/download rather than embed. Inline PDF embedding (iframe or
// worker-based canvas rendering) proved unreliable inside this sandboxed environment -
// some setups block framed data:/blob: content, others block the Worker that PDF.js needs.
// Opening a real browser tab or saving the file always works.
function PdfViewer({ src, title, height }) {
  const [blobUrl, setBlobUrl] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let url = null;
    setFailed(false);
    setBlobUrl(null);
    if (!src) return;
    if (src.startsWith("data:")) {
      try {
        url = dataUrlToBlobUrl(src);
        setBlobUrl(url);
      } catch (e) {
        console.error(e);
        setFailed(true);
      }
    } else {
      setBlobUrl(src);
    }
    return () => {
      if (url && url.startsWith("blob:")) URL.revokeObjectURL(url);
    };
  }, [src]);

  return (
    <div
      style={{
        textAlign: "center",
        padding: "28px 16px",
        background: "#FBF8F0",
        border: "1px solid #D8CEB0",
        borderRadius: 8,
        minHeight: height || undefined,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <FileText size={34} color="#C98A3E" style={{ marginBottom: 10 }} />
      <div style={{ fontFamily: "'Fraunces', serif", fontSize: 16.5, fontWeight: 600, color: "#26241B", marginBottom: 4 }}>
        {title || "PDF document"}
      </div>
      <div style={{ fontSize: 12.5, color: "#8C8367", marginBottom: 18, maxWidth: 320 }}>
        {failed
          ? "Couldn't prepare this file. Try re-uploading it."
          : "Open it in a new tab to read, or save a copy."}
      </div>
      {!failed && (
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          <button
            disabled={!blobUrl}
            onClick={() => blobUrl && window.open(blobUrl, "_blank", "noopener")}
            style={{ ...btnPrimary("#2F7A6C"), opacity: blobUrl ? 1 : 0.5 }}
          >
            Open in new tab
          </button>
          {blobUrl && (
            <a
              href={blobUrl}
              download={`${(title || "note").replace(/[^\w.-]+/g, "_")}.pdf`}
              style={{ ...btnPrimary("#C98A3E"), textDecoration: "none", display: "inline-flex", alignItems: "center" }}
            >
              Download
            </a>
          )}
        </div>
      )}
    </div>
  );
}



function HandForm({ onSubmit }) {
  const [title, setTitle] = useState("");
  const [image, setImage] = useState("");
  const [fileKind, setFileKind] = useState("image"); // 'image' | 'pdf'
  const [tab, setTab] = useState("upload");
  const [fileError, setFileError] = useState("");

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileError("");
    const pdf = isPdfFile(file.name, file.type);
    const reader = new FileReader();
    reader.onload = () => {
      setImage(reader.result);
      setFileKind(pdf ? "pdf" : "image");
      if (!title.trim()) setTitle(file.name.replace(/\.(pdf|jpe?g|png|gif|webp)$/i, ""));
    };
    reader.onerror = () => setFileError("Couldn't read that file.");
    reader.readAsDataURL(file);
  }

  function handleUrlChange(e) {
    const url = e.target.value;
    setImage(url);
    setFileKind(isPdfFile(url) ? "pdf" : "image");
  }

  return (
    <div>
      <input style={inputStyle} placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button
          onClick={() => setTab("upload")}
          style={{
            ...btnPrimary(tab === "upload" ? "#C98A3E" : "transparent"),
            color: tab === "upload" ? "#FBF8F0" : "#C98A3E",
            border: "1px solid #C98A3E",
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
          }}
        >
          <Upload size={13} /> Upload
        </button>
        <button
          onClick={() => setTab("url")}
          style={{
            ...btnPrimary(tab === "url" ? "#C98A3E" : "transparent"),
            color: tab === "url" ? "#FBF8F0" : "#C98A3E",
            border: "1px solid #C98A3E",
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
          }}
        >
          <LinkIcon size={13} /> File link
        </button>
      </div>
      {tab === "upload" ? (
        <div style={{ marginBottom: 14 }}>
          <input type="file" accept="image/*,.pdf,application/pdf" onChange={handleFile} style={{ fontSize: 13, color: "#26241B" }} />
          <div style={{ fontSize: 11.5, color: "#8C8367", marginTop: 6 }}>
            Photos of handwritten pages, or a scanned PDF. Keep files reasonably small — very large scans use up storage fast.
          </div>
          {fileError && <div style={{ fontSize: 12.5, color: "#B14B32", marginTop: 6 }}>{fileError}</div>}
        </div>
      ) : (
        <input
          style={inputStyle}
          placeholder="https://…/scan.jpg or https://…/notes.pdf"
          value={image.startsWith("data:") ? "" : image}
          onChange={handleUrlChange}
        />
      )}
      {image && fileKind === "image" && (
        <img src={image} alt="preview" style={{ width: "100%", borderRadius: 6, marginBottom: 14, maxHeight: 200, objectFit: "cover" }} />
      )}
      {image && fileKind === "pdf" && (
        <div style={{ marginBottom: 14 }}>
          <PdfViewer src={image} title={title} height={180} />
        </div>
      )}
      <button
        style={btnPrimary("#C98A3E")}
        onClick={() => title.trim() && image && onSubmit({ title: title.trim(), image, kind: fileKind })}
      >
        Save page
      </button>
    </div>
  );
}

function VideoForm({ onSubmit }) {
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  return (
    <div>
      <input style={inputStyle} placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <input style={inputStyle} placeholder="https://youtube.com/watch?v=…" value={url} onChange={(e) => setUrl(e.target.value)} />
      <button
        style={btnPrimary("#B14B32")}
        onClick={() => title.trim() && url.trim() && onSubmit({ title: title.trim(), url: url.trim() })}
      >
        Save link
      </button>
    </div>
  );
}
