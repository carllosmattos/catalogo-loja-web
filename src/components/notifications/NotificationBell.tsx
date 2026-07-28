"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export type AppNotification = {
  id: string;
  audience: "admin" | "customer";
  customer_id?: string | null;
  type: string;
  title: string;
  body: string;
  link: string | null;
  meta?: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};

const PAGE = 20;

export function NotificationBell({
  mode,
  customerId,
  className,
}: {
  mode: "admin" | "customer";
  customerId?: string | null;
  className?: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const disabled = mode === "customer" && !customerId;

  const refreshUnread = useCallback(async () => {
    if (disabled) {
      setUnread(0);
      return;
    }
    try {
      if (mode === "admin") {
        const { data, error } = await supabase.rpc(
          "count_unread_admin_notifications"
        );
        if (!error) setUnread(Number(data) || 0);
      } else {
        const { data, error } = await supabase.rpc(
          "count_unread_customer_notifications",
          { p_customer_id: customerId }
        );
        if (!error) setUnread(Number(data) || 0);
      }
    } catch {
      // migration ainda não aplicada
    }
  }, [customerId, disabled, mode, supabase]);

  const loadPage = useCallback(
    async (offset: number, append: boolean) => {
      if (disabled) return;
      if (append) setLoadingMore(true);
      else setLoading(true);
      try {
        if (mode === "admin") {
          const { data, error } = await supabase.rpc(
            "list_admin_notifications",
            { p_limit: PAGE, p_offset: offset }
          );
          if (error) throw error;
          const rows = (data as AppNotification[]) || [];
          setItems((prev) => (append ? [...prev, ...rows] : rows));
          setHasMore(rows.length >= PAGE);
        } else {
          const { data, error } = await supabase.rpc(
            "list_customer_notifications",
            {
              p_customer_id: customerId,
              p_limit: PAGE,
              p_offset: offset,
            }
          );
          if (error) throw error;
          const rows = (data as AppNotification[]) || [];
          setItems((prev) => (append ? [...prev, ...rows] : rows));
          setHasMore(rows.length >= PAGE);
        }
      } catch {
        if (!append) setItems([]);
        setHasMore(false);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [customerId, disabled, mode, supabase]
  );

  useEffect(() => {
    void refreshUnread();
    const t = setInterval(() => void refreshUnread(), 45000);
    return () => clearInterval(t);
  }, [refreshUnread]);

  useEffect(() => {
    if (!open) return;
    void loadPage(0, false);
    void refreshUnread();
  }, [open, loadPage, refreshUnread]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!panelRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  async function markRead(n: AppNotification) {
    try {
      if (mode === "admin") {
        await supabase.rpc("mark_admin_notification_read", {
          p_notification_id: n.id,
        });
      } else if (customerId) {
        await supabase.rpc("mark_customer_notification_read", {
          p_notification_id: n.id,
          p_customer_id: customerId,
        });
      }
    } catch {
      // ignore
    }
    setItems((prev) =>
      prev.map((x) =>
        x.id === n.id ? { ...x, read_at: x.read_at || new Date().toISOString() } : x
      )
    );
    setUnread((u) => Math.max(0, u - (n.read_at ? 0 : 1)));
  }

  async function markAllRead() {
    try {
      if (mode === "admin") {
        await supabase.rpc("mark_all_admin_notifications_read");
      } else if (customerId) {
        await supabase.rpc("mark_all_customer_notifications_read", {
          p_customer_id: customerId,
        });
      }
    } catch {
      // ignore
    }
    setItems((prev) =>
      prev.map((x) => ({
        ...x,
        read_at: x.read_at || new Date().toISOString(),
      }))
    );
    setUnread(0);
  }

  async function onItemClick(n: AppNotification) {
    await markRead(n);
    setOpen(false);
    if (n.link) router.push(n.link);
  }

  function onScroll() {
    const el = listRef.current;
    if (!el || loadingMore || !hasMore) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) {
      void loadPage(items.length, true);
    }
  }

  return (
    <div className={cn("relative", className)} ref={panelRef}>
      <button
        type="button"
        onClick={() => {
          if (disabled) return;
          setOpen((o) => !o);
        }}
        className={cn(
          "relative rounded-full p-2 text-[var(--color-primary)] hover:bg-[var(--color-accent)]",
          disabled && "cursor-not-allowed opacity-40"
        )}
        aria-label="Notificações"
        title={
          disabled
            ? "Entre na conta para ver notificações"
            : "Notificações"
        }
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(100vw-2rem,22rem)] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <p className="text-sm font-semibold text-gray-800">Notificações</p>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => void markAllRead()}
                className="text-xs text-[var(--color-primary)] hover:underline"
              >
                Marcar todas
              </button>
            )}
          </div>
          <div
            ref={listRef}
            onScroll={onScroll}
            className="max-h-80 overflow-y-auto"
          >
            {loading ? (
              <p className="p-4 text-center text-sm text-gray-400">
                Carregando…
              </p>
            ) : items.length === 0 ? (
              <p className="p-4 text-center text-sm text-gray-400">
                Nenhuma notificação.
              </p>
            ) : (
              <ul>
                {items.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => void onItemClick(n)}
                      className={cn(
                        "w-full border-b border-gray-50 px-3 py-2.5 text-left hover:bg-gray-50",
                        !n.read_at && "bg-[var(--color-accent)]/40"
                      )}
                    >
                      <p className="text-sm font-medium text-gray-900">
                        {!n.read_at && (
                          <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-primary)]" />
                        )}
                        {n.title}
                      </p>
                      {n.body && (
                        <p className="mt-0.5 line-clamp-2 whitespace-pre-line text-xs text-gray-500">
                          {n.body}
                        </p>
                      )}
                      <p className="mt-1 text-[10px] text-gray-400">
                        {new Date(n.created_at).toLocaleString("pt-BR")}
                      </p>
                    </button>
                  </li>
                ))}
                {loadingMore && (
                  <li className="p-2 text-center text-xs text-gray-400">
                    Carregando mais…
                  </li>
                )}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
