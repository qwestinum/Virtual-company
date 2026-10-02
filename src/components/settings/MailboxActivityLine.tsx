'use client';

/**
 * Ce que la boîte a VU — une ligne sous « dernière relève », lue depuis le
 * journal (`/api/mailboxes/activity`). Fail-soft : si la lecture tombe, la
 * ligne ne s'affiche pas et la liste des boîtes reste intacte.
 */
import { useEffect, useState } from 'react';

import { describeMailboxActivity, type MailboxActivity } from '@/lib/imap/mail-ignored';

type ActivityResponse = { windowDays: number; activity: Record<string, MailboxActivity> };

export function useMailboxActivity(refreshKey: unknown): ActivityResponse | null {
  const [data, setData] = useState<ActivityResponse | null>(null);
  useEffect(() => {
    let alive = true;
    fetch('/api/mailboxes/activity')
      .then((res) => (res.ok ? (res.json() as Promise<ActivityResponse>) : null))
      .then((json) => {
        if (alive) setData(json);
      })
      .catch(() => {
        if (alive) setData(null);
      });
    return () => {
      alive = false;
    };
  }, [refreshKey]);
  return data;
}

export function MailboxActivityLine({
  data,
  mailboxId,
  lastPolledAt,
}: {
  data: ActivityResponse | null;
  mailboxId: string;
  lastPolledAt: string | null;
}) {
  const activity = data?.activity[mailboxId];
  if (!data || !activity) return null;
  return (
    <div className="text-stone-500 text-[11px] mt-0.5" data-testid="mailbox-activity">
      {describeMailboxActivity(activity, lastPolledAt, data.windowDays, new Date())}
    </div>
  );
}
