"use client";

import {useEffect} from "react";
import {useRouter} from "next/navigation";

export function ConversationActivity({conversationId}: {conversationId: string}) {
  const router = useRouter();

  useEffect(() => {
    let disposed = false;
    async function markRead() {
      try {
        await fetch("/api/messages/read", {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({conversationId}),
        });
      } catch {
        // A later refresh retries silently.
      }
    }
    void markRead();

    const refreshConversation = async () => {
      if (disposed || document.visibilityState !== "visible") return;
      await markRead();
      if (!disposed) router.refresh();
    };
    const timer = window.setInterval(() => void refreshConversation(), 10000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refreshConversation();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [conversationId, router]);

  return null;
}
