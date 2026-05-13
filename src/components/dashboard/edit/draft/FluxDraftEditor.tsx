'use client';

/**
 * Éditeur de flux (sources CV) pour un brouillon de campagne
 * (Session 6 v3).
 *
 * Symétrique de `FluxEditBlock` sans store : le parent détient la
 * liste sélectionnée et reçoit chaque toggle via onChange.
 *
 * Cas particulier — flux email : si activé, on déplie le MailboxPicker
 * pour que le DRH associe au moins une boîte mail (cf. spec). La
 * sélection est aussi remontée au parent via `onMailboxesChange`.
 */

import {
  CV_SOURCES,
  CV_SOURCE_HINTS,
  CV_SOURCE_LABELS,
  CV_SOURCE_OPERATIONAL,
  type CVSource,
} from '@/types/cv-source';

import { MailboxPicker } from '../MailboxPicker';

export type FluxDraftEditorProps = {
  selected: CVSource[];
  onChange: (next: CVSource[]) => void;
  mailboxIds: string[];
  onMailboxesChange: (next: string[]) => void;
};

export function FluxDraftEditor({
  selected,
  onChange,
  mailboxIds,
  onMailboxesChange,
}: FluxDraftEditorProps) {
  const toggle = (source: CVSource) => {
    if (selected.includes(source)) {
      onChange(selected.filter((s) => s !== source));
    } else {
      onChange([...selected, source]);
    }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {CV_SOURCES.map((source) => {
        const enabled = selected.includes(source);
        const operational = CV_SOURCE_OPERATIONAL[source];
        return (
          <div key={source}>
            <button
              type="button"
              onClick={() => toggle(source)}
              aria-pressed={enabled}
              className="font-body"
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 14px',
                borderRadius: 10,
                border: `1px solid ${enabled ? 'var(--dash-green)' : 'var(--dash-border)'}`,
                background: enabled
                  ? 'var(--dash-green-light)'
                  : 'var(--dash-warm)',
                color: enabled
                  ? 'var(--dash-green)'
                  : 'var(--dash-text-secondary)',
                fontWeight: 600,
                fontSize: 13,
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span>
                  {CV_SOURCE_LABELS[source]}
                  {!operational ? (
                    <span
                      style={{
                        marginLeft: 8,
                        fontSize: 10,
                        color: 'var(--dash-text-tertiary)',
                        fontWeight: 600,
                        letterSpacing: '0.04em',
                        textTransform: 'uppercase',
                      }}
                    >
                      à brancher
                    </span>
                  ) : null}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 400,
                    color: enabled
                      ? 'var(--dash-green)'
                      : 'var(--dash-text-tertiary)',
                  }}
                >
                  {CV_SOURCE_HINTS[source]}
                </span>
              </span>
              <ToggleSwitch on={enabled} />
            </button>
            {source === 'email' && enabled ? (
              <div
                style={{
                  margin: '8px 0 4px',
                  padding: '12px 14px',
                  borderRadius: 10,
                  border: '1px dashed var(--dash-border-strong)',
                  background: 'var(--dash-surface)',
                }}
              >
                <p
                  className="font-body"
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: 'var(--dash-text-secondary)',
                    margin: '0 0 8px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}
                >
                  Boîtes mail à associer
                </p>
                <MailboxPicker
                  selectedIds={mailboxIds}
                  onChange={onMailboxesChange}
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function ToggleSwitch({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        position: 'relative',
        width: 34,
        height: 18,
        borderRadius: 999,
        background: on ? 'var(--dash-green)' : 'var(--dash-border-strong)',
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: on ? 18 : 2,
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: '#fff',
          transition: 'left 0.15s',
          boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
        }}
      />
    </span>
  );
}
