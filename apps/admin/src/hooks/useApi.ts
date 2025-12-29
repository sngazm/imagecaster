import { useMemo } from "react";
import { usePodcast } from "../contexts/PodcastContext";
import { createApi } from "../lib/api";

export function useApi() {
  const { currentPodcast } = usePodcast();

  const api = useMemo(() => {
    if (!currentPodcast) {
      return null;
    }
    return createApi(currentPodcast.id);
  }, [currentPodcast]);

  return api;
}
