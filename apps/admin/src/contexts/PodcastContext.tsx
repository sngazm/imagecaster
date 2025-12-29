import { createContext, useContext, useState, useEffect, ReactNode } from "react";

export interface Podcast {
  id: string;
  title: string;
  createdAt: string;
}

interface PodcastContextType {
  podcasts: Podcast[];
  currentPodcast: Podcast | null;
  isLoading: boolean;
  error: string | null;
  selectPodcast: (id: string) => void;
  refreshPodcasts: () => Promise<void>;
}

const PodcastContext = createContext<PodcastContextType | null>(null);

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8787";
const STORAGE_KEY = "selectedPodcastId";

export function PodcastProvider({ children }: { children: ReactNode }) {
  const [podcasts, setPodcasts] = useState<Podcast[]>([]);
  const [currentPodcastId, setCurrentPodcastId] = useState<string | null>(() => {
    return localStorage.getItem(STORAGE_KEY);
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPodcasts = async () => {
    try {
      setError(null);
      const res = await fetch(`${API_BASE}/api/podcasts`, {
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });

      if (!res.ok) {
        throw new Error("Failed to fetch podcasts");
      }

      const data = await res.json();
      setPodcasts(data.podcasts);

      // If no podcast selected or selected podcast doesn't exist, select the first one
      if (data.podcasts.length > 0) {
        const exists = data.podcasts.some((p: Podcast) => p.id === currentPodcastId);
        if (!exists) {
          setCurrentPodcastId(data.podcasts[0].id);
          localStorage.setItem(STORAGE_KEY, data.podcasts[0].id);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchPodcasts();
  }, []);

  const selectPodcast = (id: string) => {
    setCurrentPodcastId(id);
    localStorage.setItem(STORAGE_KEY, id);
  };

  const currentPodcast = podcasts.find((p) => p.id === currentPodcastId) || null;

  return (
    <PodcastContext.Provider
      value={{
        podcasts,
        currentPodcast,
        isLoading,
        error,
        selectPodcast,
        refreshPodcasts: fetchPodcasts,
      }}
    >
      {children}
    </PodcastContext.Provider>
  );
}

export function usePodcast() {
  const context = useContext(PodcastContext);
  if (!context) {
    throw new Error("usePodcast must be used within a PodcastProvider");
  }
  return context;
}
