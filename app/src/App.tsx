import { lazy, Suspense, useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { StoreProvider, useStore } from "./lib/store";
import { useRoute } from "./lib/router";
import { Toaster } from "./lib/toast";
import { Loading, TabBar } from "./components/ui";
import { Orb } from "./components/Orb";
import { preloadVoice } from "./lib/tts";
import Login from "./screens/Login";
import Onboarding from "./screens/Onboarding";
import Home from "./screens/Home";

const WordsHub = lazy(() => import("./screens/WordsHub"));
const Session = lazy(() => import("./screens/Session"));
const Dictionary = lazy(() => import("./screens/Dictionary"));
const Lessons = lazy(() => import("./screens/Lessons"));
const LessonView = lazy(() => import("./screens/LessonView"));
const Talk = lazy(() => import("./screens/Talk"));
const More = lazy(() => import("./screens/More"));
const Listen = lazy(() => import("./screens/Listen"));
const Friends = lazy(() => import("./screens/Friends"));
const Settings = lazy(() => import("./screens/Settings"));
const Admin = lazy(() => import("./screens/Admin"));

export default function App() {
  return (
    <StoreProvider>
      <Shell />
      <Toaster />
    </StoreProvider>
  );
}

const FULLSCREEN = ["/words/session", "/lesson/"];

function route(path: string) {
  if (path === "/" || path === "") return <Home />;
  if (path === "/words") return <WordsHub />;
  if (path === "/words/session") return <Session />;
  if (path === "/dict") return <Dictionary />;
  if (path === "/lessons") return <Lessons />;
  if (path.startsWith("/lesson/")) return <LessonView id={decodeURIComponent(path.slice(8))} />;
  if (path === "/talk") return <Talk />;
  if (path === "/more") return <More />;
  if (path === "/listen") return <Listen />;
  if (path === "/friends") return <Friends />;
  if (path === "/settings") return <Settings />;
  if (path === "/admin") return <Admin />;
  return <Home />;
}

function Shell() {
  const { user, authReady, ready, loadError, profile, reload } = useStore();
  const path = useRoute();
  const accent = profile?.accent;
  useEffect(() => {
    if (accent) preloadVoice(accent);
  }, [accent]);

  if (!authReady) return <Loading />;
  if (!user) return <Login />;
  if (loadError) {
    return (
      <div className="frame no-tabs">
        <div className="page-center">
          <div className="stack gap-16 center" style={{ alignItems: "center", maxWidth: 320 }}>
            <Orb size={96} mode="think" />
            <p className="h3">{loadError}</p>
            <button className="btn btn-primary" onClick={() => void reload()}>
              לנסות שוב
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (!ready || !profile) return <Loading label="מכינים את השיעור שלך…" />;
  if (!profile.onboarded) return <Onboarding />;

  const fullscreen = FULLSCREEN.some((p) => path.startsWith(p));
  return (
    <>
      <AnimatePresence mode="wait" initial={false}>
        <motion.main
          key={path}
          className={`frame ${fullscreen ? "no-tabs" : ""}`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        >
          <Suspense fallback={<Loading />}>{route(path)}</Suspense>
        </motion.main>
      </AnimatePresence>
      {!fullscreen && <TabBar path={path} />}
    </>
  );
}
