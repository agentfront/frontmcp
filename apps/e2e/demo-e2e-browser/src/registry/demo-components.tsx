import React from 'react';
import type { ComponentType } from 'react';

function InfoCard(props: Record<string, unknown>) {
  const { title, children } = props;
  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '1rem',
        marginBottom: '0.75rem',
        background: 'var(--bg-secondary)',
      }}
    >
      {title ? <h4 style={{ color: 'var(--accent)', marginBottom: '0.5rem' }}>{String(title)}</h4> : null}
      <div style={{ color: 'var(--text)', fontSize: '0.85rem' }}>{children as React.ReactNode}</div>
    </div>
  );
}

function Badge({ label, color }: Record<string, unknown>) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '0.2rem 0.6rem',
        borderRadius: 999,
        fontSize: '0.75rem',
        fontWeight: 600,
        background: String(color ?? 'var(--accent-dim)'),
        color: '#fff',
      }}
    >
      {String(label ?? '')}
    </span>
  );
}

function StatBox({ label, value }: Record<string, unknown>) {
  return (
    <div
      style={{ textAlign: 'center', padding: '1rem', background: 'var(--bg-tertiary)', borderRadius: 8, minWidth: 100 }}
    >
      <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--accent)' }}>{String(value ?? 0)}</div>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>{String(label ?? '')}</div>
    </div>
  );
}

function Alert({ variant, children }: Record<string, unknown>) {
  const colors: Record<string, { bg: string; border: string; text: string }> = {
    info: { bg: 'rgba(0, 212, 255, 0.1)', border: 'var(--accent)', text: 'var(--accent)' },
    success: { bg: 'rgba(0, 230, 118, 0.1)', border: 'var(--success)', text: 'var(--success)' },
    warning: { bg: 'rgba(255, 171, 64, 0.1)', border: 'var(--warning)', text: 'var(--warning)' },
    error: { bg: 'rgba(255, 82, 82, 0.1)', border: 'var(--error)', text: 'var(--error)' },
  };
  const c = colors[String(variant ?? 'info')] ?? colors.info;
  return (
    <div
      style={{
        padding: '0.75rem 1rem',
        borderLeft: `3px solid ${c.border}`,
        background: c.bg,
        borderRadius: 4,
        color: c.text,
        fontSize: '0.85rem',
        marginBottom: '0.75rem',
      }}
    >
      {children as React.ReactNode}
    </div>
  );
}

export const demoComponents: Record<string, ComponentType<Record<string, unknown>>> = {
  'component://InfoCard': InfoCard,
  'component://Badge': Badge,
  'component://StatBox': StatBox,
  'component://Alert': Alert,
};
