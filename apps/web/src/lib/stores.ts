"use client";

/**
 * Client-side state kept in localStorage: cart, favourites, orders placed on this device.
 * No server calls, no account; each store is a tiny subscribe/snapshot object for
 * useSyncExternalStore, synced across tabs through the "storage" event.
 */
import { useSyncExternalStore } from "react";
import type { ImageRef } from "@henine/shared";

function createStore<T>(key: string, initial: T) {
  let value: T = initial;
  let loaded = false;
  const listeners = new Set<() => void>();

  const read = () => {
    if (loaded || typeof window === "undefined") return;
    loaded = true;
    try {
      const raw = localStorage.getItem(key);
      if (raw) value = JSON.parse(raw) as T;
    } catch {
      /* private mode / corrupted: start empty */
    }
  };
  const emit = () => listeners.forEach((l) => l());

  if (typeof window !== "undefined") {
    window.addEventListener("storage", (e) => {
      if (e.key !== key) return;
      loaded = false;
      read();
      emit();
    });
  }

  return {
    get(): T {
      read();
      return value;
    },
    set(next: T | ((prev: T) => T)) {
      read();
      value = typeof next === "function" ? (next as (p: T) => T)(value) : next;
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* quota / private mode: keep in memory */
      }
      emit();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    initial,
  };
}

type Store<T> = ReturnType<typeof createStore<T>>;

function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, () => store.initial);
}

/* ── Cart ── */

export interface CartItem {
  variantId: number;
  qty: number;
  productId: number;
  slug: string;
  nameFr: string;
  nameAr: string;
  optionsFr: string;
  optionsAr: string;
  price: number;
  image: ImageRef | null;
  color: string | null;
}

export const cartStore = createStore<CartItem[]>("henine.cart.v1", []);
export const useCart = () => useStore(cartStore);

export const cart = {
  add(item: CartItem) {
    cartStore.set((items) => {
      const existing = items.find((i) => i.variantId === item.variantId);
      if (existing) return items.map((i) => (i.variantId === item.variantId ? { ...i, qty: Math.min(20, i.qty + item.qty) } : i));
      return [...items, item];
    });
  },
  setQty(variantId: number, qty: number) {
    cartStore.set((items) => (qty <= 0 ? items.filter((i) => i.variantId !== variantId) : items.map((i) => (i.variantId === variantId ? { ...i, qty: Math.min(20, qty) } : i))));
  },
  remove(variantId: number) {
    cartStore.set((items) => items.filter((i) => i.variantId !== variantId));
  },
  clear() {
    cartStore.set([]);
  },
};

export const cartCount = (items: CartItem[]) => items.reduce((s, i) => s + i.qty, 0);

/* ── Favourites ── */

export const favoritesStore = createStore<string[]>("henine.favorites.v1", []);
export const useFavorites = () => useStore(favoritesStore);
export function toggleFavorite(slug: string) {
  favoritesStore.set((list) => (list.includes(slug) ? list.filter((s) => s !== slug) : [slug, ...list].slice(0, 100)));
}

/* ── Orders placed on this device (for the header pill and /suivi) ── */

export interface SavedOrder {
  code: string;
  token: string;
  total: number;
  createdAt: number;
}

export const ordersStore = createStore<SavedOrder[]>("henine.orders.v1", []);
export const useSavedOrders = () => useStore(ordersStore);
export function saveOrder(o: SavedOrder) {
  ordersStore.set((list) => [o, ...list.filter((x) => x.code !== o.code)].slice(0, 20));
}

/* ── Checkout form memory (so returning customers don't retype) ── */

export interface CheckoutMemory {
  name: string;
  phone: string;
  wilaya: number | null;
  communeId: number | null;
  address: string;
  deliveryType: "domicile" | "bureau";
}
export const checkoutMemory = createStore<CheckoutMemory | null>("henine.checkout.v1", null);
