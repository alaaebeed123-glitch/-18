import { getSharedTajweedAudioContext } from './tajweedAudio';

export function playTabSwitch(): void {
  try {
    const ctx = getSharedTajweedAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    const now = ctx.currentTime;
    osc.frequency.setValueAtTime(460, now);
    osc.frequency.exponentialRampToValueAtTime(700, now + 0.05);
    gain.gain.setValueAtTime(0.015, now);
    gain.gain.exponentialRampToValueAtTime(0.0003, now + 0.08);
    osc.start(now);
    osc.stop(now + 0.08);
  } catch {
    // Ignore audio error
  }
}

export function playChime(success = true): void {
  try {
    const ctx = getSharedTajweedAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    const now = ctx.currentTime;

    if (success) {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, now); // D5
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.12); // A5
      gain.gain.setValueAtTime(0.038, now);
      gain.gain.exponentialRampToValueAtTime(0.0012, now + 0.22);
      osc.start(now);
      osc.stop(now + 0.22);
    } else {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(220, now); // A3
      osc.frequency.linearRampToValueAtTime(160, now + 0.14);
      gain.gain.setValueAtTime(0.03, now);
      gain.gain.exponentialRampToValueAtTime(0.0012, now + 0.18);
      osc.start(now);
      osc.stop(now + 0.18);
    }
  } catch {
    // Ignore audio error
  }
}

export function triggerConfetti(): void {
  const container = document.createElement('div');
  container.className = 'confetti-container';
  document.body.appendChild(container);
  const colors = ['#C9A227', '#E7C766', '#2E9E63', '#FBF3E3', '#D6483F'];
  for (let i = 0; i < 44; i++) {
    const p = document.createElement('div');
    p.className = 'confetti-piece';
    p.style.left = Math.random() * 100 + 'vw';
    p.style.background = colors[Math.floor(Math.random() * colors.length)];
    p.style.animationDuration = 1.2 + Math.random() * 1.3 + 's';
    p.style.animationDelay = Math.random() * 0.3 + 's';
    const size = 6 + Math.random() * 8 + 'px';
    p.style.width = size;
    p.style.height = size;
    container.appendChild(p);
  }
  setTimeout(() => container.remove(), 2900);
}
