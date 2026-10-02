import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { useState } from "react";
import { api, ApiError, errorMessage } from "../api";
import { date } from "../lib/format";
import { Button, Empty, ErrorState, ListSkeleton, Sheet, Spinner, useToast } from "../ui";

/**
 * "📸 Depuis Instagram": the shop's posts, carousels opened photo by photo; the ticked photos
 * are downloaded through the Worker and go through the normal photo pipeline (resize, WebP).
 */

interface IgPost {
  id: string;
  caption: string;
  permalink: string;
  takenAt: number | null;
  type: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
  cover: string | null;
  photos: { id: string; src: string }[];
}

export function InstagramButton({ onFiles, disabled, className = "" }: { onFiles: (files: File[], permalink: string) => void; disabled?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" disabled={disabled} className={className} onClick={() => setOpen(true)}>
        📸 Depuis Instagram
      </Button>
      {open && <InstagramPicker onClose={() => setOpen(false)} onFiles={onFiles} />}
    </>
  );
}

function InstagramPicker({ onClose, onFiles }: { onClose: () => void; onFiles: (files: File[], permalink: string) => void }) {
  const toast = useToast();
  const status = useQuery({ queryKey: ["instagram-status"], queryFn: () => api<{ connected: boolean; username: string | null }>("/integrations/instagram") });
  const posts = useInfiniteQuery({
    queryKey: ["instagram-media"],
    enabled: !!status.data?.connected,
    initialPageParam: "",
    queryFn: ({ pageParam }) => api<{ posts: IgPost[]; next: string | null }>(`/instagram/media${pageParam ? `?after=${encodeURIComponent(pageParam)}` : ""}`),
    getNextPageParam: (last) => last.next ?? undefined,
    staleTime: 5 * 60_000,
  });
  const [post, setPost] = useState<IgPost | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function importPhotos() {
    if (!post) return;
    setBusy(true);
    try {
      const files: File[] = [];
      for (const [i, photo] of post.photos.filter((p) => picked.includes(p.id)).entries()) {
        const res = await fetch(photo.src, { credentials: "same-origin" });
        if (!res.ok) throw new Error("download");
        const blob = await res.blob();
        files.push(new File([blob], `instagram-${post.id}-${i + 1}.${blob.type.includes("png") ? "png" : "jpg"}`, { type: blob.type || "image/jpeg" }));
      }
      onFiles(files, post.permalink);
      onClose();
    } catch (e) {
      toast(e instanceof Error && e.message === "download" ? "Photo introuvable sur Instagram, réessayez." : errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  const list = posts.data?.pages.flatMap((p) => p.posts) ?? [];
  const expired = posts.error instanceof ApiError && posts.error.code === "instagram_token_expired";

  return (
    <Sheet
      open
      onClose={onClose}
      wide
      title={post ? "Choisir les photos" : `📸 Instagram${status.data?.username ? ` · @${status.data.username}` : ""}`}
      footer={
        post ? (
          <div className="flex items-center justify-between gap-2">
            <Button onClick={() => { setPost(null); setPicked([]); }}>← Publications</Button>
            <Button variant="primary" disabled={!picked.length} loading={busy} onClick={importPhotos}>
              Importer {picked.length || ""} photo{picked.length > 1 ? "s" : ""}
            </Button>
          </div>
        ) : undefined
      }
    >
      {status.error ? (
        <ErrorState error={status.error} onRetry={status.refetch} />
      ) : !status.data ? (
        <ListSkeleton rows={2} />
      ) : !status.data.connected || expired ? (
        <Empty title={expired ? "La connexion Instagram a expiré" : "Instagram n'est pas encore connecté"} icon="📸">
          Reliez le compte de la boutique une seule fois dans{" "}
          <Link to="/parametres" search={{ tab: "connexions" }} className="font-semibold text-plum-600">Paramètres → Connexions</Link>, puis revenez ici.
        </Empty>
      ) : post ? (
        <div className="space-y-3">
          {post.caption && <p className="line-clamp-3 text-sm text-ink-soft">{post.caption}</p>}
          <div className="flex items-center justify-between text-sm">
            <span>{post.photos.length} photo(s) dans cette publication</span>
            <button type="button" className="font-semibold text-plum-600" onClick={() => setPicked(picked.length === post.photos.length ? [] : post.photos.map((p) => p.id))}>
              {picked.length === post.photos.length ? "Tout décocher" : "Tout cocher"}
            </button>
          </div>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {post.photos.map((p) => {
              const on = picked.includes(p.id);
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => setPicked(on ? picked.filter((x) => x !== p.id) : [...picked, p.id])}
                    className={`relative block w-full overflow-hidden rounded-xl border-2 transition ${on ? "border-plum-600" : "border-transparent"}`}
                  >
                    <img src={p.src} alt="" loading="lazy" className="aspect-[4/5] w-full bg-ivory-deep object-cover" />
                    <span className={`absolute end-2 top-2 grid size-7 place-items-center rounded-full border-2 ${on ? "border-plum-600 bg-plum-600 text-white" : "border-white bg-black/20"}`}>
                      {on && <Check className="size-4" strokeWidth={3} />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : posts.error ? (
        <ErrorState error={posts.error} onRetry={posts.refetch} />
      ) : !posts.data ? (
        <ListSkeleton rows={3} />
      ) : list.length === 0 ? (
        <Empty title="Aucune publication avec des photos" icon="📸" />
      ) : (
        <>
          <p className="mb-3 text-sm text-ink-soft">Touchez une publication pour choisir ses photos (les vidéos ne sont pas proposées).</p>
          <ul className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
            {list.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => { setPost(p); setPicked(p.photos.length === 1 ? [p.photos[0]!.id] : []); }}
                  className="group relative block w-full overflow-hidden rounded-lg"
                  title={p.caption}
                >
                  {p.cover ? <img src={p.cover} alt="" loading="lazy" className="aspect-square w-full bg-ivory-deep object-cover transition group-hover:scale-105" /> : <span className="block aspect-square bg-ivory-deep" />}
                  {p.photos.length > 1 && <span className="absolute end-1 top-1 rounded-full bg-black/55 px-1.5 text-[11px] font-semibold text-white">{p.photos.length}</span>}
                  {p.takenAt && <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 px-1.5 pb-1 pt-4 text-start text-[10px] text-white">{date(p.takenAt)}</span>}
                </button>
              </li>
            ))}
          </ul>
          {posts.hasNextPage && (
            <div className="mt-4 flex justify-center">
              <Button onClick={() => void posts.fetchNextPage()} loading={posts.isFetchingNextPage}>
                Publications plus anciennes
              </Button>
            </div>
          )}
          {posts.isFetching && !posts.isFetchingNextPage && <Spinner className="mx-auto mt-3 size-4" />}
        </>
      )}
    </Sheet>
  );
}
