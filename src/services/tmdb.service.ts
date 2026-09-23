import { env } from "../config/env";
import { BadRequestError } from "../utils/errors";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

const getHeaders = () => {
  const headers: Record<string, string> = {
    Accept: "application/json"
  };
  if (env.TMDB_READ_ACCESS_TOKEN) {
    headers.Authorization = `Bearer ${env.TMDB_READ_ACCESS_TOKEN}`;
  }
  return headers;
};

export interface TmdbSearchResultItem {
  id: number;
  title: string;
  original_title?: string;
  name?: string; // For TV
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date?: string;
  first_air_date?: string;
  media_type?: string;
  vote_average: number;
  vote_count: number;
  popularity: number;
}

export interface TmdbMovieDetails {
  id: number;
  title: string;
  tagline?: string;
  overview: string;
  poster: string | null;
  backdrop: string | null;
  releaseYear?: number;
  releaseDate?: string;
  genres: string[];
  duration?: number; // minutes
  rating?: number;
  voteCount?: number;
  cast: { name: string; character?: string; image?: string }[];
  director?: string;
  trailerUrl?: string;
  type: "MOVIE" | "SERIES";
  // TV Specific
  numberOfSeasons?: number;
  numberOfEpisodes?: number;
  seasons?: Array<{
    seasonNumber: number;
    name: string;
    episodeCount: number;
    overview: string;
    posterPath: string | null;
    airDate?: string;
  }>;
}

export class TmdbService {
  /**
   * Search Movies and TV Shows on TMDB
   */
  async search(query: string, type: "movie" | "tv" | "multi" = "multi", page = 1) {
    if (!query || !query.trim()) {
      throw new BadRequestError("Search query is required");
    }

    try {
      const endpoint = type === "movie" ? "/search/movie" : type === "tv" ? "/search/tv" : "/search/multi";
      const params = new URLSearchParams({
        query: query.trim(),
        page: page.toString(),
        api_key: env.TMDB_API_KEY
      });

      const url = `${TMDB_BASE_URL}${endpoint}?${params.toString()}`;
      const response = await fetch(url, {
        method: "GET",
        headers: getHeaders()
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error((errData as any).status_message || `TMDB responded with status ${response.status}`);
      }

      const data: any = await response.json();

      const results = (data.results || []).map((item: TmdbSearchResultItem) => {
        const itemType = item.media_type || (type === "tv" ? "tv" : "movie");
        const title = item.title || item.name || "Untitled";
        const releaseDate = item.release_date || item.first_air_date || "";
        const releaseYear = releaseDate ? new Date(releaseDate).getFullYear() : undefined;

        return {
          id: item.id,
          title,
          type: itemType === "tv" ? "SERIES" : "MOVIE",
          overview: item.overview,
          poster: item.poster_path ? `${TMDB_IMAGE_BASE}/w500${item.poster_path}` : null,
          backdrop: item.backdrop_path ? `${TMDB_IMAGE_BASE}/original${item.backdrop_path}` : null,
          releaseDate,
          releaseYear,
          rating: item.vote_average ? Number(item.vote_average.toFixed(1)) : 0,
          voteCount: item.vote_count
        };
      });

      return {
        page: data.page || 1,
        totalResults: data.total_results || 0,
        totalPages: data.total_pages || 1,
        results
      };
    } catch (error: any) {
      throw new BadRequestError(`TMDB Search Error: ${error.message || "Failed to search TMDB"}`);
    }
  }

  /**
   * Get full details for Movie or TV show
   */
  async getDetails(id: string | number, type: "movie" | "tv" = "movie"): Promise<TmdbMovieDetails> {
    try {
      const endpoint = type === "movie" ? `/movie/${id}` : `/tv/${id}`;
      const params = new URLSearchParams({
        api_key: env.TMDB_API_KEY,
        append_to_response: "credits,videos"
      });

      const url = `${TMDB_BASE_URL}${endpoint}?${params.toString()}`;
      const response = await fetch(url, {
        method: "GET",
        headers: getHeaders()
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error((errData as any).status_message || `TMDB responded with status ${response.status}`);
      }

      const data: any = await response.json();
      const isMovie = type === "movie";

      // Parse trailer (YouTube)
      const videos = data.videos?.results || [];
      const trailer = videos.find(
        (v: any) => v.site === "YouTube" && (v.type === "Trailer" || v.type === "Teaser")
      );
      const trailerUrl = trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : undefined;

      // Parse Cast
      const credits = data.credits || {};
      const castMembers = (credits.cast || []).slice(0, 10).map((c: any) => ({
        name: c.name,
        character: c.character,
        image: c.profile_path ? `${TMDB_IMAGE_BASE}/w185${c.profile_path}` : undefined
      }));

      // Director (for movies) or Creator (for TV)
      let director: string | undefined;
      if (isMovie) {
        const dirObj = (credits.crew || []).find((cr: any) => cr.job === "Director");
        director = dirObj ? dirObj.name : undefined;
      } else if (data.created_by && data.created_by.length > 0) {
        director = data.created_by.map((c: any) => c.name).join(", ");
      }

      // Genres
      const genres = (data.genres || []).map((g: any) => g.name);

      const releaseDate = isMovie ? data.release_date : data.first_air_date;
      const releaseYear = releaseDate ? new Date(releaseDate).getFullYear() : undefined;

      // Result object
      const result: TmdbMovieDetails = {
        id: data.id,
        title: isMovie ? data.title : data.name,
        tagline: data.tagline || undefined,
        overview: data.overview || "",
        poster: data.poster_path ? `${TMDB_IMAGE_BASE}/w780${data.poster_path}` : null,
        backdrop: data.backdrop_path ? `${TMDB_IMAGE_BASE}/original${data.backdrop_path}` : null,
        releaseDate,
        releaseYear,
        genres,
        duration: isMovie ? data.runtime : (data.episode_run_time?.[0] || undefined),
        rating: data.vote_average ? Number(data.vote_average.toFixed(1)) : undefined,
        voteCount: data.vote_count,
        cast: castMembers,
        director,
        trailerUrl,
        type: isMovie ? "MOVIE" : "SERIES"
      };

      // If TV, add seasons info
      if (!isMovie) {
        result.numberOfSeasons = data.number_of_seasons;
        result.numberOfEpisodes = data.number_of_episodes;
        result.seasons = (data.seasons || [])
          .filter((s: any) => s.season_number > 0)
          .map((s: any) => ({
            seasonNumber: s.season_number,
            name: s.name,
            episodeCount: s.episode_count,
            overview: s.overview,
            posterPath: s.poster_path ? `${TMDB_IMAGE_BASE}/w500${s.poster_path}` : null,
            airDate: s.air_date
          }));
      }

      return result;
    } catch (error: any) {
      throw new BadRequestError(`TMDB Details Error: ${error.message || "Failed to fetch TMDB details"}`);
    }
  }

  /**
   * Get Season and Episode details for TV series
   */
  async getSeasonEpisodes(tvId: string | number, seasonNumber: number) {
    try {
      const endpoint = `/tv/${tvId}/season/${seasonNumber}`;
      const params = new URLSearchParams({ api_key: env.TMDB_API_KEY });

      const url = `${TMDB_BASE_URL}${endpoint}?${params.toString()}`;
      const response = await fetch(url, {
        method: "GET",
        headers: getHeaders()
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error((errData as any).status_message || `TMDB responded with status ${response.status}`);
      }

      const data: any = await response.json();
      const episodes = (data.episodes || []).map((ep: any) => ({
        episodeNumber: ep.episode_number,
        title: ep.name,
        overview: ep.overview,
        duration: ep.runtime,
        stillPath: ep.still_path ? `${TMDB_IMAGE_BASE}/w500${ep.still_path}` : null,
        airDate: ep.air_date,
        rating: ep.vote_average ? Number(ep.vote_average.toFixed(1)) : 0
      }));

      return {
        seasonNumber: data.season_number,
        name: data.name,
        overview: data.overview,
        posterPath: data.poster_path ? `${TMDB_IMAGE_BASE}/w500${data.poster_path}` : null,
        episodes
      };
    } catch (error: any) {
      throw new BadRequestError(`TMDB Season Error: ${error.message || "Failed to fetch Season details"}`);
    }
  }
}

export const tmdbService = new TmdbService();
