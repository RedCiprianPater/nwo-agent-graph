/**
 * ActorBadge.jsx
 * Visual badge showing which actor type created a node or post.
 */

const ACTOR_CONFIG = {
  human:  { label: 'Human',  bg: '#1D9E7522', color: '#1D9E75', icon: '👤' },
  agent:  { label: 'Agent',  bg: '#7F77DD22', color: '#7F77DD', icon: '✦' },
  robot:  { label: 'Robot',  bg: '#D85A3022', color: '#D85A30', icon: '⬡' },
  cron:   { label: 'Auto',   bg: '#BA751722', color: '#BA7517', icon: '⏱' },
};

export default function ActorBadge({ actorType, agentName, compact = false }) {
  const cfg = ACTOR_CONFIG[actorType] || ACTOR_CONFIG.human;

  if (compact) {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 3,
        padding: '1px 6px', borderRadius: 4,
        fontSize: 10, fontWeight: 600,
        background: cfg.bg, color: cfg.color,
        letterSpacing: 0.5,
      }}>
        <span style={{ fontSize: 9 }}>{cfg.icon}</span>
        {agentName || cfg.label}
      </span>
    );
  }

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 5,
      fontSize: 11, fontWeight: 500,
      background: cfg.bg, color: cfg.color,
      border: `1px solid ${cfg.color}33`,
    }}>
      <span>{cfg.icon}</span>
      {agentName || cfg.label}
    </span>
  );
}

export function RobotAvatar({ name, color, label }) {
  return (
    <div style={{
      width: 32, height: 32, borderRadius: '50%',
      background: `${color || '#D85A30'}22`,
      border: `1.5px solid ${color || '#D85A30'}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 11, fontWeight: 600, color: color || '#D85A30',
      flexShrink: 0,
    }}>
      {label || name?.slice(0, 2).toUpperCase() || 'R?'}
    </div>
  );
}

export function CategoryPill({ category }) {
  const colors = {
    topic:       '#1D9E75',
    event:       '#D85A30',
    observation: '#0F6E56',
    task:        '#7F77DD',
    inference:   '#534AB7',
    sensor:      '#639922',
    swarm:       '#7F77DD',
    iot:         '#0F6E56',
    telemetry:   '#BA7517',
  };
  const color = colors[category] || '#888780';
  return (
    <span style={{
      display: 'inline-block', padding: '1px 6px', borderRadius: 3,
      fontSize: 10, color, background: `${color}18`,
      fontWeight: 500,
    }}>
      {category}
    </span>
  );
}
