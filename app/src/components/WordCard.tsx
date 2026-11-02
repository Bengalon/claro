import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import type { DiffGroup, Word } from "../lib/types";
import { POS_HE } from "../lib/plan";
import { groupsByWord } from "../lib/content";
import { useStore } from "../lib/store";
import { RichText } from "./RichText";
import { articleFor } from "../lib/util";
import { prefetchVoice, speak, ttsAvailable } from "../lib/tts";
import { Emoji3D } from "./Emoji3D";
import { IconSpeaker } from "./Icons";

type Accent = "latam" | "spain";

export function Highlighted({ text, hl }: { text: string; hl: string }) {
  const i = text.indexOf(hl);
  if (!hl || i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="hl">{hl}</mark>
      {text.slice(i + hl.length)}
    </>
  );
}

/** Tracks which clip is playing so buttons can show it. */
export function useSpeaker(accent: Accent) {
  const [playing, setPlaying] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const say = (text: string, id: string, slow = false) => {
    setPlaying(id);
    void speak(text, accent, { slow }).finally(() => {
      if (alive.current) setPlaying((p) => (p === id ? null : p));
    });
  };
  return { playing, say };
}

/** Two clear buttons: normal speed and slow. */
export function SpeakButtons({ text, accent, size = "md" }: { text: string; accent: Accent; size?: "md" | "sm" }) {
  const { playing, say } = useSpeaker(accent);
  if (!ttsAvailable()) return null;
  return (
    <div className={`speak-row ${size}`}>
      <button className={`speak-pill main ${playing === "n" ? "playing" : ""}`} onClick={() => say(text, "n")}>
        <IconSpeaker />
        <span>השמעה</span>
      </button>
      <button className={`speak-pill slow ${playing === "s" ? "playing" : ""}`} onClick={() => say(text, "s", true)}>
        <Emoji3D emoji="🐢" size={22} eager />
        <span>לאט</span>
      </button>
    </div>
  );
}

export function ExampleLine({ ex, accent, id, playing, say }: { ex: Word["ex"][number]; accent: Accent; id: string; playing: string | null; say: (t: string, id: string) => void }) {
  void accent;
  return (
    <button className={`example ${playing === id ? "playing" : ""}`} onClick={() => say(ex.es, id)}>
      <span className="example-es es">
        <Highlighted text={ex.es} hl={ex.hl} />
      </span>
      <span className="example-row">
        <span className="example-he">{ex.he}</span>
        <IconSpeaker className="example-speaker" />
      </span>
      {ex.fm && ex.fw && (
        <span className="form-note">
          <span className="form-note-main">
            <b className="es">{ex.hl}</b> = {ex.fm}
          </span>
          <span className="form-note-why">
            <RichText text={ex.fw} />
          </span>
        </span>
      )}
    </button>
  );
}

/** "What's the difference?" for words with almost the same meaning. */
export function DiffBoxes({ word, accent, collapsible = false }: { word: Word; accent: Accent; collapsible?: boolean }) {
  const groups = groupsByWord.get(word.id) ?? [];
  if (!groups.length) return null;
  return (
    <div className="diff-list">
      {groups.map((grp) => (
        <DiffBox key={grp.id} group={grp} current={word.id} accent={accent} collapsible={collapsible} />
      ))}
    </div>
  );
}

function DiffBox({ group, current, accent, collapsible }: { group: DiffGroup; current: number; accent: Accent; collapsible: boolean }) {
  const { wordsById } = useStore();
  const [open, setOpen] = useState(!collapsible);
  const { playing, say } = useSpeaker(accent);
  return (
    <div className={`diff-box ${open ? "open" : ""}`}>
      <button className="diff-head" onClick={() => collapsible && setOpen((o) => !o)} aria-expanded={open} disabled={!collapsible}>
        <Emoji3D emoji="🤔" size={26} eager />
        <span className="diff-title">
          <RichText text={group.title} />
        </span>
        {collapsible && <span className="diff-chevron" aria-hidden="true">{open ? "−" : "+"}</span>}
      </button>
      {open && (
        <motion.div className="diff-body" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} transition={{ duration: 0.25 }}>
          <p className="diff-rule">
            <RichText text={group.rule} />
          </p>
          {group.items.map((it) => {
            const w = wordsById.get(it.id);
            if (!w) return null;
            return (
              <div key={it.id} className={`diff-item ${it.id === current ? "me" : ""}`}>
                <div className="diff-item-head">
                  <b className="es">{w.es}</b>
                  <span className="diff-use">
                    <RichText text={it.use} />
                  </span>
                </div>
                <button className={`diff-ex ${playing === `d${it.id}` ? "playing" : ""}`} onClick={() => say(it.es, `d${it.id}`)}>
                  <span className="es diff-ex-es">
                    <Highlighted text={it.es} hl={it.hl} />
                  </span>
                  <span className="diff-ex-he">
                    {it.he}
                    <IconSpeaker className="example-speaker" />
                  </span>
                </button>
              </div>
            );
          })}
        </motion.div>
      )}
    </div>
  );
}

/** Word card: picture, word with sound, meaning, example(s), tip. */
export function WordCard({ word, accent, examples = 2, diffCollapsed = false }: { word: Word; accent: Accent; examples?: number; diffCollapsed?: boolean }) {
  const article = word.pos === "noun" ? articleFor(word.gender) : "";
  const { playing, say } = useSpeaker(accent);
  useEffect(() => {
    const texts = [word.es, ...(word.fem ? [word.fem] : []), ...word.ex.map((x) => x.es)];
    for (const g of groupsByWord.get(word.id) ?? []) texts.push(...g.items.map((it) => it.es));
    prefetchVoice(texts, accent);
  }, [word, accent]);
  return (
    <div className="word-card">
      <motion.div
        className="word-art"
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 16 }}
      >
        <div className="word-art-blob" />
        <div className="floaty">
          <Emoji3D emoji={word.emoji} size={120} eager label={word.he} />
        </div>
      </motion.div>

      <div className="word-es es">{word.es}</div>
      <div className="word-meta">
        {article && (
          <span className={`chip ${word.gender === "f" ? "chip-f" : word.gender === "m" ? "chip-m" : "chip-violet"}`}>
            <span className="es">{article}</span> · {word.gender === "f" ? "נקבה" : word.gender === "m" ? "זכר" : "שם עצם"}
          </span>
        )}
        {!article && <span className="chip chip-quiet">{POS_HE[word.pos] ?? word.pos}</span>}
        {word.fem && (
          <span className="chip chip-quiet">
            בנקבה: <span className="es">{word.fem}</span>
          </span>
        )}
      </div>
      <SpeakButtons text={word.es} accent={accent} />

      <div className="word-divider" />
      <motion.div className="word-he" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        {word.he}
      </motion.div>

      <div className="word-examples">
        {word.ex.slice(0, examples).map((x, i) => (
          <ExampleLine key={i} ex={x} accent={accent} id={`ex${i}`} playing={playing} say={say} />
        ))}
      </div>

      {word.note && (
        <div className="word-note">
          <Emoji3D emoji="💡" size={24} eager />
          <span>
            <RichText text={word.note} />
          </span>
        </div>
      )}

      <DiffBoxes word={word} accent={accent} collapsible={diffCollapsed} />
    </div>
  );
}
