/**
 * Repo Supabase pour les tâches isolées archivées (Session 5, round 1).
 *
 * Symétrique de `repos/campaigns.ts` pour les sollicitations TASK-XXXX.
 */

import { requireServerSupabase } from '@/lib/db/supabase-server';
import type { TaskRow } from '@/lib/db/types';
import type { ArchivedTask } from '@/stores/tasks-store';
import type { CampaignStatus } from '@/types/campaign-status';

const TABLE = 'tasks_archived';

function rowToTask(row: TaskRow): ArchivedTask {
  return {
    id: row.id,
    name: row.name,
    criteria: row.criteria,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function taskToRow(task: ArchivedTask): TaskRow {
  return {
    id: task.id,
    name: task.name,
    status: task.status,
    criteria: task.criteria,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
  };
}

export async function listTasks(): Promise<ArchivedTask[]> {
  const supabase = requireServerSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw new Error(`listTasks: ${error.message}`);
  return (data ?? []).map(rowToTask);
}

export async function upsertTask(task: ArchivedTask): Promise<ArchivedTask> {
  const supabase = requireServerSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .upsert(taskToRow(task), { onConflict: 'id' })
    .select('*')
    .single();
  if (error) throw new Error(`upsertTask: ${error.message}`);
  return rowToTask(data as TaskRow);
}

export async function patchTaskStatus(
  id: string,
  status: CampaignStatus,
): Promise<ArchivedTask | null> {
  const supabase = requireServerSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .update({ status })
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`patchTaskStatus: ${error.message}`);
  return data ? rowToTask(data as TaskRow) : null;
}
