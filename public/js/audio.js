// Web Audio API procedural sound synthesizer
// Zero external files, ultra-responsive, works in all modern browsers

class TactileSound {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    // Restore sound preference from localStorage
    const saved = localStorage.getItem('tenant_sound_enabled');
    if (saved !== null) {
      this.enabled = saved === 'true';
    }
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  toggle() {
    this.enabled = !this.enabled;
    localStorage.setItem('tenant_sound_enabled', this.enabled ? 'true' : 'false');
    if (this.enabled) {
      this.playPushIn();
    }
    return this.enabled;
  }

  // Deep satisfying mechanical push-in click
  playPushIn() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;

    // Oscillator 1: low thud
    const osc1 = this.ctx.createOscillator();
    const gain1 = this.ctx.createGain();
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(140, t);
    osc1.frequency.exponentialRampToValueAtTime(40, t + 0.08);

    gain1.gain.setValueAtTime(0.4, t);
    gain1.gain.exponentialRampToValueAtTime(0.001, t + 0.08);

    osc1.connect(gain1);
    gain1.connect(this.ctx.destination);

    osc1.start(t);
    osc1.stop(t + 0.09);

    // Oscillator 2: metallic tactile snap
    const osc2 = this.ctx.createOscillator();
    const gain2 = this.ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(800, t);
    osc2.frequency.exponentialRampToValueAtTime(200, t + 0.04);

    gain2.gain.setValueAtTime(0.3, t);
    gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.04);

    osc2.connect(gain2);
    gain2.connect(this.ctx.destination);

    osc2.start(t);
    osc2.stop(t + 0.05);
  }

  // Lighter crisp spring pop-out click
  playPopOut() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(320, t);
    osc.frequency.exponentialRampToValueAtTime(640, t + 0.06);

    gain.gain.setValueAtTime(0.35, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(t);
    osc.stop(t + 0.07);
  }

  // Soft notification chime
  playChime() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const notes = [523.25, 659.25]; // C5, E5
    notes.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t + idx * 0.08);

      gain.gain.setValueAtTime(0.18, t + idx * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, t + idx * 0.08 + 0.25);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(t + idx * 0.08);
      osc.stop(t + idx * 0.08 + 0.26);
    });
  }
}

window.soundEngine = new TactileSound();
