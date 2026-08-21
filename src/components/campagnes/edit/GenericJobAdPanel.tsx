'use client';

/**
 * Panneau du canal « Annonce générique » — pré-rédaction, ajustement,
 * publication sur le jobboard de démonstration.
 *
 * Deux gestes, deux natures, qu'on ne mélange pas : RÉDIGER appelle le Job
 * Writer et remplit le champ sans rien enregistrer ; PUBLIER fige le texte tel
 * qu'il est à l'écran. C'est le geste humain qui fait foi, exactement comme le
 * preview d'un mail HITL — ce qui a été relu part tel quel, et aucune
 * génération ultérieure ne le réécrit.
 *
 * Le panneau se rend invisible tout seul quand la surface n'existe pas :
 * `GET …/job-post` répond 404 sans le flag de démonstration, et on retourne
 * `null`. Le flag n'a donc jamais besoin de voyager jusqu'au navigateur.
 */
import { useCallback, useEffect, useState } from 'react';

import {
  generateJobAd,
  loadJobPost,
  publishJobAd,
  unpublishJobAd,
} from '@/lib/jobboard/job-post-client';
import type { DemoJobPost } from '@/types/job-post';

import {
  errorStyle,
  formatPublishedAt,
  ghostBtn,
  headerStyle,
  inputStyle,
  labelStyle,
  panelStyle,
  primaryBtn,
  tagsStyle,
} from './job-ad-panel-styles';

type Phase = 'loading' | 'absent' | 'ready';

export function GenericJobAdPanel({ campaignId }: { campaignId: string }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [post, setPost] = useState<DemoJobPost | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [busy, setBusy] = useState<null | 'generate' | 'publish' | 'unpublish'>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback((p: DemoJobPost) => {
    setPost(p);
    setTitle(p.title);
    setBody(p.body);
    setTags(p.tags);
  }, []);

  const generate = useCallback(async () => {
    setBusy('generate');
    setError(null);
    try {
      const draft = await generateJobAd(campaignId);
      setTitle(draft.title);
      setBody(draft.body);
      setTags(draft.tags);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rédaction impossible.');
    } finally {
      setBusy(null);
    }
  }, [campaignId]);

  // Au déploiement du panneau : on charge l'annonce existante ; s'il n'y en a
  // pas, on lance la pré-rédaction sans rien demander (c'est le service rendu
  // par l'activation du canal). Une seule fois — d'où la garde sur `phase`.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const outcome = await loadJobPost(campaignId).catch(() => null);
      if (!alive) return;
      if (!outcome || outcome.unavailable) return setPhase('absent');
      setPhase('ready');
      if (outcome.post) apply(outcome.post);
      else void generate();
    })();
    return () => {
      alive = false;
    };
  }, [campaignId, apply, generate]);

  if (phase !== 'ready') return null;

  const publish = async () => {
    setBusy('publish');
    setError(null);
    try {
      apply(
        await publishJobAd(campaignId, {
          title: title.trim(),
          body: body.trim(),
          tags,
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Publication impossible.');
    } finally {
      setBusy(null);
    }
  };

  const unpublish = async () => {
    setBusy('unpublish');
    setError(null);
    try {
      const updated = await unpublishJobAd(campaignId);
      if (updated) apply(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Dépublication impossible.');
    } finally {
      setBusy(null);
    }
  };

  const live = post?.isVisible === true;
  // « Republier » n'apparaît qu'après une édition : proposer de republier un
  // texte identique à celui déjà en ligne ne veut rien dire.
  const edited = post !== null && (title !== post.title || body !== post.body);
  const canPublish = title.trim().length > 0 && body.trim().length > 0;

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>
        <span style={{ fontFamily: 'var(--font-jetbrains-mono)', fontSize: 12 }}>
          Réf. {campaignId}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600 }}>
          {live ? (
            <span style={{ color: 'var(--dash-green)' }}>
              ● Publiée{formatPublishedAt(post?.publishedAt)}
            </span>
          ) : (
            <span style={{ color: 'var(--dash-text-secondary)' }}>
              ○ Brouillon — pré-rédigée depuis la fiche de poste
            </span>
          )}
        </span>
      </div>

      {error && <p style={errorStyle}>{error}</p>}

      <label style={labelStyle}>Titre</label>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        style={inputStyle}
        placeholder={busy === 'generate' ? 'Rédaction en cours…' : ''}
      />

      <label style={labelStyle}>Texte de l’annonce</label>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={12}
        style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.55 }}
        placeholder={
          busy === 'generate' ? 'Le Job Writer rédige l’annonce…' : ''
        }
      />

      {tags.length > 0 && <p style={tagsStyle}>{tags.join(' · ')}</p>}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
        <button type="button" onClick={generate} disabled={busy !== null} style={ghostBtn}>
          {busy === 'generate' ? 'Rédaction…' : 'Re-rédiger'}
        </button>
        {live && (
          <a href={`/jobs/${encodeURIComponent(campaignId)}`} target="_blank" rel="noreferrer" style={ghostBtn}>
            Voir l’annonce ↗
          </a>
        )}
        {live && (
          <button type="button" onClick={unpublish} disabled={busy !== null} style={ghostBtn}>
            {busy === 'unpublish' ? 'Dépublication…' : 'Dépublier'}
          </button>
        )}
        {(!live || edited) && (
          <button
            type="button"
            onClick={publish}
            disabled={busy !== null || !canPublish}
            style={{ ...primaryBtn, opacity: canPublish ? 1 : 0.5 }}
          >
            {busy === 'publish' ? 'Publication…' : live ? 'Republier' : 'Publier'}
          </button>
        )}
      </div>
    </div>
  );
}
